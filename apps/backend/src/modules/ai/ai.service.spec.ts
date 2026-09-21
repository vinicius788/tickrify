import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AiService } from './ai.service';
import { getAiQueue, getAiQueueReadiness } from './ai.queue';

// Mocka a fila para isolar o gate de acesso do processamento real da análise.
jest.mock('./ai.queue', () => ({
  getAiQueue: jest.fn(),
  getAiQueueReadiness: jest.fn(),
}));

const QUEUE_OFFLINE = {
  required: false,
  configured: false,
  connected: false,
  workersCount: 0,
  hasWorkers: false,
  ready: false,
  reason: 'queue_unavailable' as const,
};

const QUEUE_ONLINE = {
  required: false,
  configured: true,
  connected: true,
  workersCount: 1,
  hasWorkers: true,
  ready: true,
  reason: 'ok' as const,
};

const VALID_PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]).toString('base64')}`;

describe('AiService access enforcement', () => {
  let service: AiService;
  let prisma: any;
  let ticksService: any;
  let promptBuilder: any;
  let mailService: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_STORAGE_BUCKET;

    prisma = {
      user: {
        // Sem stripeCustomerId → hasPaidAccess() retorna false (usuário free) por padrão.
        // Com e-mail para que o caminho do e-mail de recuperação chegue até o fim
        // sem precisar consultar a API do Clerk.
        findUnique: jest.fn().mockResolvedValue({ id: 'usr_1', email: 'trader@example.com' }),
        update: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      },
      // O e-mail de recuperação faz dedup permanente aqui. Sem este mock o
      // caminho inteiro morre silenciosamente no try/catch e o teste passaria
      // sem testar nada.
      adminAudit: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'aud_1' }),
      },
      analysisUsage: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      analysis: {
        create: jest.fn().mockResolvedValue({
          id: 'an_1',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        update: jest.fn(),
        // Contagem de análises demo "consumidas" (status != failed). 0 por padrão.
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'an_123' }),
      },
      promptConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    // Transação interativa: executa o callback usando o próprio mock como `tx`,
    // assim os testes controlam o gate via prisma.analysis.count.
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

    // Por padrão a fila está offline; testes que precisam do caminho assíncrono
    // sobrescrevem para QUEUE_ONLINE.
    (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_OFFLINE);
    (getAiQueue as jest.Mock).mockReturnValue(null);

    const aiAdapter = {
      analyzeImage: jest.fn(),
      streamAnalyzeImage: jest.fn(),
    };

    ticksService = {
      getBalance: jest.fn().mockResolvedValue(0),
      debitTicks: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            JSON.stringify({
              code: 'INSUFFICIENT_TICKS',
              message: 'Ticks insuficientes',
            }),
          ),
        ),
    };

    promptBuilder = {
      buildPrompt: jest.fn().mockResolvedValue('test prompt'),
      buildPromptByVersion: jest.fn().mockResolvedValue('test prompt'),
      composePromptParts: jest.fn((parts: string[]) => parts.join('\n\n---\n\n')),
    };

    const stripeService = {
      ensureTicksForActiveSubscriber: jest.fn().mockResolvedValue(undefined),
      syncActiveSubscriptionFromStripe: jest.fn().mockResolvedValue(false),
    };

    mailService = {
      sendRecovery: jest.fn().mockResolvedValue(undefined),
      sendWelcome: jest.fn().mockResolvedValue(undefined),
    };

    service = new AiService(prisma, aiAdapter as any, ticksService as any, promptBuilder as any, stripeService as any, mailService as any);
  });

  it('bloqueia a 4ª análise grátis: já usou as 3 demos → DEMO_LIMIT_REACHED', async () => {
    // 3 demos já consumidas (status != failed)
    prisma.analysis.count.mockResolvedValue(3);

    try {
      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);
      throw new Error('Expected DEMO_LIMIT_REACHED exception');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as { code?: string };
      expect(response?.code).toBe('DEMO_LIMIT_REACHED');
    }

    // Gate atômico: contagem + criação dentro da MESMA transação.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Não deve criar a análise quando o limite foi atingido.
    expect(prisma.analysis.create).not.toHaveBeenCalled();
  });

  it('reserva a análise grátis dentro da transação quando ainda há cota', async () => {
    // 2 demos usadas → a 3ª é permitida.
    prisma.analysis.count.mockResolvedValue(2);
    // Fila online: createAnalysis enfileira e retorna sem rodar o processamento.
    (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
    (getAiQueue as jest.Mock).mockReturnValue({ add: jest.fn().mockResolvedValue(undefined) });

    await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.analysis.create).toHaveBeenCalledTimes(1);
    // A análise é marcada como demo (isDemo=true).
    expect(prisma.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDemo: true, userId: 'usr_1' }),
      }),
    );
  });

  it('não conta análises que falharam (status != failed) ao verificar a cota grátis', async () => {
    prisma.analysis.count.mockResolvedValue(1);

    await expect(service.checkDemoEligibility('usr_1')).resolves.toBe(true);
    expect(prisma.analysis.count).toHaveBeenCalledWith({
      where: { userId: 'usr_1', isDemo: true, status: { not: 'failed' } },
    });
  });

  it('checkDemoEligibility retorna false quando as 3 demos já foram usadas', async () => {
    prisma.analysis.count.mockResolvedValue(3);
    await expect(service.checkDemoEligibility('usr_1')).resolves.toBe(false);
  });

  it('assinante sem ticks suficientes: bloqueia com INSUFFICIENT_TICKS (não cria a análise)', async () => {
    // Assinatura ativa → caminho pago (debita ticks, que falham).
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: null });

    try {
      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);
      throw new Error('Expected INSUFFICIENT_TICKS exception');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as { message?: string };
      expect(String(response?.message || '')).toContain('INSUFFICIENT_TICKS');
    }

    expect(ticksService.debitTicks).toHaveBeenCalledTimes(1);
    expect(prisma.analysis.create).not.toHaveBeenCalled();
  });

  // ── listAnalyses: paginacao ──────────────────────────────────────────────────
  // Existe porque ate 03/09/2026 nao havia paginacao NENHUMA: o backend limitava
  // a 100 por requisicao e nao aceitava cursor, entao numa conta com 403
  // analises as outras 363 eram inalcancaveis por qualquer tela.
  describe('listAnalyses: paginacao por cursor', () => {
    it('sem cursor, busca a primeira pagina e NAO manda cursor ao prisma', async () => {
      await service.listAnalyses('usr_1', 40);
      const args = prisma.analysis.findMany.mock.calls[0][0];
      expect(args.take).toBe(40);
      expect(args.cursor).toBeUndefined();
      expect(args.skip).toBeUndefined();
    });

    it('com cursor, pula a propria linha do cursor', async () => {
      await service.listAnalyses('usr_1', 40, 'an_123');
      const args = prisma.analysis.findMany.mock.calls[0][0];
      expect(args.cursor).toEqual({ id: 'an_123' });
      // Sem skip:1 a pagina seguinte repetiria a ultima linha da anterior.
      expect(args.skip).toBe(1);
    });

    it('ordena por data E por id, para o cursor nao pular linha na fronteira', async () => {
      await service.listAnalyses('usr_1', 40);
      const args = prisma.analysis.findMany.mock.calls[0][0];
      // Duas analises podem ter o mesmo createdAt. Sem o desempate por id a
      // ordem nao e total e o cursor fica ambiguo.
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('confirma que o cursor e do proprio usuario antes de usar como ancora', async () => {
      await service.listAnalyses('usr_1', 40, 'an_123');
      expect(prisma.analysis.findFirst).toHaveBeenCalledWith({
        where: { id: 'an_123', userId: 'usr_1' },
        select: { id: true },
      });
    });

    it('cursor que nao e do usuario encerra a paginacao em vez de vazar ou estourar', async () => {
      // Cobre os dois casos de uma vez: id inexistente (que faria o Prisma
      // lancar e virar 500) e id de analise de outra conta (oraculo de
      // existencia). Devolver [] encerra; devolver a primeira pagina duplicaria
      // linhas na tela, porque o front concatena.
      prisma.analysis.findFirst.mockResolvedValue(null);

      const out = await service.listAnalyses('usr_1', 40, 'an_de_outro');

      expect(out).toEqual([]);
      expect(prisma.analysis.findMany).not.toHaveBeenCalled();
    });

    it('busca so as colunas usadas: nunca o fullResponse (texto bruto da IA)', async () => {
      await service.listAnalyses('usr_1', 40);
      const args = prisma.analysis.findMany.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.select.fullResponse).toBeUndefined();
      expect(args.select).toMatchObject({ id: true, result: true, imageUrl: true, status: true });
    });

    it('assina as imagens da pagina em UM lote e reaproveita na abertura seguinte', async () => {
      process.env.SUPABASE_URL = 'https://x.supabase.co';
      process.env.SUPABASE_SERVICE_KEY = 'service';
      const createSignedUrls = jest.fn(async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
        error: null,
      }));
      const createSignedUrl = jest.fn();
      (service as any).getStorageClient = () => ({
        storage: { from: () => ({ createSignedUrls, createSignedUrl }) },
      });
      prisma.analysis.findMany.mockResolvedValue([
        { id: 'a1', imageUrl: 'u/1.png', status: 'completed', result: {}, createdAt: new Date() },
        { id: 'a2', imageUrl: 'u/2.png', status: 'completed', result: {}, createdAt: new Date() },
      ]);

      const first = await service.listAnalyses('usr_1', 40);
      await service.listAnalyses('usr_1', 40);

      expect(first.map((a: any) => a.imageUrl)).toEqual(['https://signed/u/1.png', 'https://signed/u/2.png']);
      expect(createSignedUrls).toHaveBeenCalledTimes(1); // segunda abertura saiu do cache
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it('ignora cursor vazio ou so com espaco, em vez de mandar lixo ao prisma', async () => {
      await service.listAnalyses('usr_1', 40, '   ');
      const args = prisma.analysis.findMany.mock.calls[0][0];
      expect(args.cursor).toBeUndefined();
    });
  });

  // ── getUsage ────────────────────────────────────────────────────────────────
  // Estes testes estavam VERMELHOS no CI (corrigidos em 12/08/2026). Eles ainda
  // descreviam o contrato antigo, de quando assinante era "ilimitado" e o
  // contador do free vinha de analysisUsage. Duas mudanças deliberadas de
  // produto passaram por cima disso e o spec nunca foi atualizado:
  //
  //   1. O contador do FREE passou a ler as linhas Analysis isDemo=true — a
  //      MESMA fonte que o paywall usa. Antes lia analysisUsage, que só é
  //      escrita por assinante, então o free ficava eternamente em 0/3.
  //   2. Assinante deixou de ser "ilimitado" na prática: continua isUnlimited
  //      (não há teto de análises), mas `canAnalyze` depende de ter tick para
  //      gastar. Saldo zero = não pode analisar.
  //
  // Como o job `build` do ci.yml depende do job `test`, o CI vermelho significa
  // que o build nunca rodou. Testes que ninguém conserta são pior que teste
  // nenhum: ensinam a ignorar o vermelho.

  it('getUsage free: conta as DEMOS, não a tabela analysisUsage', async () => {
    // analysisUsage com 2 é ruído de propósito: para o free ela não é a fonte
    // de verdade. Se alguém reverter a origem do contador, este teste pega.
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 2 });
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.analysis.count.mockResolvedValue(2);

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('free');
    expect(usage.period).toBe('monthly');
    expect(usage.total).toBe(3);
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(1);
    expect(usage.canAnalyze).toBe(true);
    expect(usage.isUnlimited).toBe(false);
  });

  // Este teste existe por causa de um bug que o dono viu na tela: o KPI de
  // análises do painel contava a LISTA CARREGADA (useAnalyses(40)) e rotulava o
  // número como "all time". Uma conta com 403 análises exibia 38, para sempre.
  // A correção foi devolver uma contagem REAL daqui. Se alguém trocar este
  // count() por algo derivado de uma lista com take, este teste pega.
  it('getUsage devolve analysesAllTime a partir de um count() real, sem teto', async () => {
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 2 });
    prisma.subscription.findFirst.mockResolvedValue(null);
    // Duas contagens diferentes no mesmo método: a do histórico completo e a das
    // demos. Distinguidas pela cláusula, não pela ordem da chamada.
    prisma.analysis.count.mockImplementation((args: { where?: Record<string, unknown> }) =>
      Promise.resolve(args?.where?.status === 'completed' ? 403 : 2),
    );

    const usage = await service.getUsage('usr_1');

    expect(usage.analysesAllTime).toBe(403);
    // O contador do período continua sendo outra coisa, e não pode se misturar.
    expect(usage.used).toBe(2);
    expect(prisma.analysis.count).toHaveBeenCalledWith({
      where: { userId: 'usr_1', status: 'completed' },
    });
  });

  it('getUsage free: com as 3 demos usadas, bloqueia (mesma régua do paywall)', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.analysis.count.mockResolvedValue(3);

    const usage = await service.getUsage('usr_1');

    expect(usage.total).toBe(3);
    expect(usage.used).toBe(3);
    expect(usage.remaining).toBe(0);
    expect(usage.canAnalyze).toBe(false);
  });

  it('getUsage assinante: sem análise limitada, mas SEM tick não pode analisar', async () => {
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 99 });
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: null });
    ticksService.getBalance.mockResolvedValue(0);

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('pro'); // priceId nulo → cai no rótulo genérico
    expect(usage.total).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.used).toBe(99);
    expect(usage.isUnlimited).toBe(true);
    expect(usage.tickBalance).toBe(0);
    // O ponto do teste: isUnlimited não implica canAnalyze. Saldo zero bloqueia.
    expect(usage.canAnalyze).toBe(false);
  });

  it('getUsage assinante: com saldo suficiente, pode analisar', async () => {
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 4 });
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: null });
    ticksService.getBalance.mockResolvedValue(10);

    const usage = await service.getUsage('usr_1');

    expect(usage.isUnlimited).toBe(true);
    expect(usage.tickBalance).toBe(10);
    expect(usage.canAnalyze).toBe(true);
  });

  /**
   * Regressão de 15/09/2026. O e-mail de recuperação existia e estava ligado,
   * mas SÓ no ForbiddenException da quarta tentativa. Quem usava as 3 análises
   * e fechava a aba nunca tentava a quarta, então nunca recebia nada, e o
   * painel do Resend confirmava: zero e-mails de recuperação enviados.
   */
  describe('e-mail de recuperação quando a cota grátis esgota', () => {
    it('envia quando a ÚLTIMA análise grátis é concluída, sem precisar de uma 4ª tentativa', async () => {
      prisma.analysis.count.mockResolvedValue(3);

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).toHaveBeenCalledTimes(1);
      expect(mailService.sendRecovery).toHaveBeenCalledWith('trader@example.com');
    });

    it('não envia enquanto ainda sobra cota', async () => {
      prisma.analysis.count.mockResolvedValue(2);

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
    });

    it('não envia para análise de assinante (isDemo=false)', async () => {
      prisma.analysis.count.mockResolvedValue(3);

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', false);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
      expect(prisma.analysis.count).not.toHaveBeenCalled();
    });

    it('não envia para quem já assinou, mesmo com a cota grátis esgotada', async () => {
      prisma.analysis.count.mockResolvedValue(3);
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: 'price_1' });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
    });

    it('não envia duas vezes: a dedup por AdminAudit vale para os dois gatilhos', async () => {
      prisma.analysis.count.mockResolvedValue(3);
      prisma.adminAudit.findFirst.mockResolvedValue({ id: 'aud_ja_enviado' });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
      expect(prisma.adminAudit.create).not.toHaveBeenCalled();
    });
  });
});

describe('AiService pipeline hooks', () => {
  it('validateImageHook blocks invalid mime types', async () => {
    const { validateImageHook, runPreHooks } = await import('./analysis-pipeline');

    const hook = validateImageHook();
    const ctx = {
      userId: 'usr_1',
      imageUrl: 'data:application/pdf;base64,abc123',
      analysisType: 'quick' as const,
      tickBalance: 10,
    };

    await expect(runPreHooks(ctx, [hook])).rejects.toThrow('Unsupported image type');
  });

  it('validateImageHook allows valid PNG data URL', async () => {
    const { validateImageHook, runPreHooks } = await import('./analysis-pipeline');

    const hook = validateImageHook();
    const ctx = {
      userId: 'usr_1',
      imageUrl: VALID_PNG_DATA_URL,
      analysisType: 'quick' as const,
      tickBalance: 10,
    };

    await expect(runPreHooks(ctx, [hook])).resolves.toBeUndefined();
  });

  it('validateImageHook blocks empty imageUrl', async () => {
    const { validateImageHook, runPreHooks } = await import('./analysis-pipeline');

    const hook = validateImageHook();
    const ctx = {
      userId: 'usr_1',
      imageUrl: '',
      analysisType: 'quick' as const,
      tickBalance: 10,
    };

    await expect(runPreHooks(ctx, [hook])).rejects.toThrow('Image URL is empty');
  });

  it('runPostHooks swallows errors from post-hooks', async () => {
    const { runPostHooks } = await import('./analysis-pipeline');

    const failingHook = jest.fn().mockRejectedValue(new Error('post-hook failure'));
    const ctx = {
      userId: 'usr_1',
      imageUrl: VALID_PNG_DATA_URL,
      analysisType: 'quick' as const,
      tickBalance: 10,
    };
    const fakeResult = { recommendation: 'BUY' as const, confidence: 80, bias: 'bullish' as const, reasoning: 'test' };

    await expect(runPostHooks(ctx, fakeResult as any, [failingHook])).resolves.toBeUndefined();
    expect(failingHook).toHaveBeenCalledTimes(1);
  });

  it('multiple pre-hooks run in sequence and first blocker wins', async () => {
    const { runPreHooks } = await import('./analysis-pipeline');

    const passingHook = jest.fn().mockResolvedValue(undefined);
    const blockingHook = jest.fn().mockResolvedValue({ block: true as const, reason: 'blocked by hook 2' });
    const neverHook = jest.fn().mockResolvedValue(undefined);

    const ctx = {
      userId: 'usr_1',
      imageUrl: VALID_PNG_DATA_URL,
      analysisType: 'quick' as const,
      tickBalance: 10,
    };

    await expect(runPreHooks(ctx, [passingHook, blockingHook, neverHook])).rejects.toThrow('blocked by hook 2');
    expect(passingHook).toHaveBeenCalledTimes(1);
    expect(blockingHook).toHaveBeenCalledTimes(1);
    expect(neverHook).not.toHaveBeenCalled();
  });
});

describe('PromptBuilderService', () => {
  it('uses override directly without DB lookup', async () => {
    const { PromptBuilderService } = await import('../prompt/prompt-builder.service');

    const prisma = { promptConfig: { findFirst: jest.fn(), findUnique: jest.fn() } };
    const builder = new PromptBuilderService(prisma as any);

    const result = await builder.buildPrompt('quick', 'custom override prompt');

    expect(result).toContain('custom override prompt');
    expect(result).toContain('Seja determinístico');
    expect(prisma.promptConfig.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to TRADING_SYSTEM_PROMPT when no active config', async () => {
    const { PromptBuilderService } = await import('../prompt/prompt-builder.service');
    const { TRADING_SYSTEM_PROMPT } = await import('../../common/prompts/trading-system-prompt');

    const prisma = {
      promptConfig: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    };
    const builder = new PromptBuilderService(prisma as any);

    const result = await builder.buildPrompt('quick');

    // buildPrompt normaliza (trim) o prompt base, então comparamos sem o espaço inicial.
    expect(result).toContain(TRADING_SYSTEM_PROMPT.trim().slice(0, 40));
    expect(result).toContain('Seja determinístico');
  });

  it('does not double-append consistency instruction', async () => {
    const { PromptBuilderService } = await import('../prompt/prompt-builder.service');

    const prisma = { promptConfig: { findFirst: jest.fn(), findUnique: jest.fn() } };
    const builder = new PromptBuilderService(prisma as any);

    const alreadyHasInstruction =
      'My prompt\n\nSeja determinístico. Para o mesmo gráfico, sempre gere a mesma análise.';
    const result = await builder.buildPrompt('quick', alreadyHasInstruction);

    const occurrences = (result.match(/Seja determinístico/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('composePromptParts joins parts with separator', async () => {
    const { PromptBuilderService } = await import('../prompt/prompt-builder.service');

    const prisma = { promptConfig: { findFirst: jest.fn(), findUnique: jest.fn() } };
    const builder = new PromptBuilderService(prisma as any);

    const result = builder.composePromptParts(['Part A', 'Part B', 'Part C']);
    expect(result).toBe('Part A\n\n---\n\nPart B\n\n---\n\nPart C');
  });
});

describe('AIAnalysisError static helpers', () => {
  it('isRetryable returns true only for rate_limit + retriable=true', async () => {
    const { AIAnalysisError } = await import('./ai.adapter');

    const retryable = new AIAnalysisError({
      code: 'openai_rate_limit',
      message: 'rate limited',
      retriable: true,
    });
    expect(AIAnalysisError.isRetryable(retryable)).toBe(true);

    const notRetryable = new AIAnalysisError({
      code: 'openai_rate_limit',
      message: 'rate limited',
      retriable: false,
    });
    expect(AIAnalysisError.isRetryable(notRetryable)).toBe(false);

    const billing = new AIAnalysisError({
      code: 'openai_billing',
      message: 'billing error',
      retriable: false,
    });
    expect(AIAnalysisError.isRetryable(billing)).toBe(false);

    expect(AIAnalysisError.isRetryable(new Error('generic'))).toBe(false);
    expect(AIAnalysisError.isRetryable(null)).toBe(false);
  });

  it('toUserMessage maps known codes to English messages', async () => {
    const { AIAnalysisError } = await import('./ai.adapter');

    const cases: Array<[import('./ai.adapter').AIAnalysisErrorCode, string]> = [
      ['openai_billing', 'temporarily unavailable'],
      ['openai_rate_limit', 'overloaded'],
      ['openai_truncated_response', 'simpler chart'],
      ['openai_empty_content', 'could not read'],
      ['openai_request_failed', 'took too long'],
    ];

    for (const [code, expectedSubstring] of cases) {
      const error = new AIAnalysisError({ code, message: 'raw', retriable: false });
      expect(AIAnalysisError.toUserMessage(error).toLowerCase()).toContain(
        expectedSubstring.toLowerCase(),
      );
    }

    expect(AIAnalysisError.toUserMessage(new Error('generic'))).toBe(
      'Analysis failed. Please try again.',
    );
  });

});
