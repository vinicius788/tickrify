import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AiService, buildClientContext, sanitizeTradeNote } from './ai.service';
import { getAiQueue, getAiQueueReadiness } from './ai.queue';
import { captureServer as captureServerMock } from '../../common/analytics/posthog';
import { recordSetupVersion } from './setups.service';

const captureServer = captureServerMock as jest.Mock;

// Mocka a fila para isolar o gate de acesso do processamento real da análise.
jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));

// Conclusao de versao de setup: o teste confere que o caminho sincrono chama.
jest.mock('./setups.service', () => ({
  ...jest.requireActual('./setups.service'),
  recordSetupVersion: jest.fn().mockResolvedValue(undefined),
}));

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

/**
 * Cota gratis no mock: `analysis.count` responde pela clausula, na mesma forma
 * que `getFreeQuota` pergunta. Sem `isDemo` na clausula e a contagem de todos
 * os tempos do /usage.
 */
function setFreeQuota(
  prisma: any,
  q: { signals: number; total?: number; inFlight?: number; allTime?: number },
) {
  const inFlight = q.inFlight ?? 0;
  const total = q.total ?? q.signals + inFlight;
  prisma.analysis.count.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
    if (where?.isDemo === undefined) return q.allTime ?? 0;
    if (where.status === 'completed') return q.signals;
    if (where.status && typeof where.status === 'object' && 'notIn' in where.status) return inFlight;
    return total;
  });
}

describe('AiService access enforcement', () => {
  let service: AiService;
  let prisma: any;
  let ticksService: any;
  let promptBuilder: any;
  let mailService: any;
  let setups: any;

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
      getFoundingOffer: jest.fn().mockResolvedValue({ active: true, code: 'EARLY35', percentOff: 35 }),
    };

    mailService = {
      sendRecovery: jest.fn().mockResolvedValue(undefined),
      sendWelcome: jest.fn().mockResolvedValue(undefined),
    };

    setups = {
      assertUpdatable: jest.fn().mockResolvedValue(undefined),
      linkAnalysis: jest.fn().mockResolvedValue(undefined),
    };

    service = new AiService(prisma, aiAdapter as any, ticksService as any, promptBuilder as any, stripeService as any, mailService as any, setups);
  });

  // ── Atualizar um setup acompanhado (12/10/2026) ─────────────────────────────
  describe('atualizacao de setup', () => {
    const flushAll = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
      setFreeQuota(prisma, { signals: 0 });
    });

    it('confere o setup ANTES de cobrar: alheio ou largado nao cria analise nem vincula', async () => {
      const { NotFoundException } = jest.requireActual('@nestjs/common');
      setups.assertUpdatable.mockRejectedValueOnce(new NotFoundException({ code: 'setup_not_found' }));

      await expect(
        service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL, undefined, 'quick', 'en', [], null, 'setup-of-someone-else'),
      ).rejects.toMatchObject({ status: 404 });

      expect(setups.assertUpdatable).toHaveBeenCalledWith('usr_1', 'setup-of-someone-else');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.analysis.create).not.toHaveBeenCalled();
      expect(setups.linkAnalysis).not.toHaveBeenCalled();
    });

    it('fila: cobra igual a uma analise normal, vincula a analise criada e manda o setupId no job', async () => {
      (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
      const add = jest.fn().mockResolvedValue(undefined);
      (getAiQueue as jest.Mock).mockReturnValue({ add });

      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL, undefined, 'quick', 'en', [], null, 'setup-123456');

      // Mesma reserva da cota gratis (transacao serializavel), nada de preco novo.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.analysis.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDemo: true, userId: 'usr_1' }) }),
      );
      expect(setups.linkAnalysis).toHaveBeenCalledWith('usr_1', 'an_1', 'setup-123456');
      expect(add).toHaveBeenCalledWith('process-analysis', expect.objectContaining({ analysisId: 'an_1', setupId: 'setup-123456' }), expect.anything());
    });

    it('sem setupId: nem confere nem vincula (analise normal intocada)', async () => {
      (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
      const add = jest.fn().mockResolvedValue(undefined);
      (getAiQueue as jest.Mock).mockReturnValue({ add });

      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);

      expect(setups.assertUpdatable).not.toHaveBeenCalled();
      expect(setups.linkAnalysis).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledWith('process-analysis', expect.objectContaining({ setupId: null }), expect.anything());
    });

    it('caminho sincrono: grava a analise concluida sem tocar no setupId e registra a versao', async () => {
      (recordSetupVersion as jest.Mock).mockClear();
      (service as any).aiAdapter.analyzeImage = jest.fn().mockResolvedValue({
        recommendation: 'WAIT', bias: 'neutral', confidence: 40, reasoning: 'No trigger yet.',
        analysis: { symbol: 'EURUSD', timeframe: '1H', entryCondition: 'Close above 1.0950' },
        rawResponse: {}, rawContent: '{}',
      });
      prisma.analysis.update
        .mockResolvedValueOnce({ id: 'an_9', status: 'processing' })
        .mockResolvedValueOnce({ id: 'an_9', status: 'completed', isDemo: true, createdAt: new Date(), updatedAt: new Date() });
      (service as any).serializeAnalysis = jest.fn().mockResolvedValue({ id: 'an_9' });

      await (service as any).processSynchronously({
        analysisId: 'an_9', imageUrl: VALID_PNG_DATA_URL, userId: 'usr_1',
        analysisType: 'quick', isDemo: true, setupId: 'setup-123456',
        intake: { receivedAt: Date.now() - 500, imagePrepMs: 120, intakeMs: 300 },
      });
      await flushAll();

      const completed = prisma.analysis.update.mock.calls.find(([args]: any[]) => args.data.status === 'completed');
      expect(completed).toBeDefined();
      expect(completed[0].data).not.toHaveProperty('setupId');
      // Contrato v2 e tempos gravados junto da analise, igual ao worker.
      expect(completed[0].data.result.engine).toMatchObject({
        version: '2.0.0',
        data_mode: 'print',
        validator_action: 'none',
        timings: { image_prep_ms: 120, intake_ms: 300, queue_ms: null },
        contract: { verdict: 'NEUTRAL', asset: 'EURUSD', timeframe: '1H', engine_version: '2.0.0' },
      });
      expect(completed[0].data.result.engine.timings.server_total_ms).toBeGreaterThanOrEqual(500);
      // O motor nao recebeu nada do setup: os mesmos 5 argumentos de sempre.
      expect((service as any).aiAdapter.analyzeImage.mock.calls[0]).toHaveLength(5);
      expect(recordSetupVersion).toHaveBeenCalledWith(
        prisma,
        { analysisId: 'an_9', userId: 'usr_1', setupId: 'setup-123456', analysisType: 'quick', isDemo: true },
        expect.any(Function),
      );
    });
  });

  it('returns the persisted safe code on a failed analysis and tolerates old rows', async () => {
    const row = {
      id: 'an_failed', status: 'failed', recommendation: null, confidence: null,
      reasoning: 'Try again', errorMessage: 'Try again', errorCode: 'openai_rate_limit',
      result: null, fullResponse: null, imageUrl: null,
      createdAt: new Date('2026-09-23T00:00:00Z'), updatedAt: new Date('2026-09-23T00:00:01Z'),
    };
    prisma.analysis.findFirst.mockResolvedValue(row);
    (service as any).getSignedImageUrl = jest.fn().mockResolvedValue(null);
    (service as any).getOutcomeById = jest.fn().mockResolvedValue(null);
    (service as any).getCalibration = jest.fn().mockResolvedValue({ sampleSize: 0, winRate: null });

    expect((await service.getAnalysis(row.id, 'usr_1')).errorCode).toBe('openai_rate_limit');
    prisma.analysis.findFirst.mockResolvedValue({ ...row, errorCode: null });
    expect((await service.getAnalysis(row.id, 'usr_1')).errorCode).toBeNull();
  });

  // "48 hours later" (12/10/2026): a analise traz o que o MERCADO fez, separado
  // do que o trader marcou, com o R do Target 1 so quando foi WIN.
  it('returns the measured market outcome next to the trader verdict', async () => {
    const base = {
      id: 'an_done', status: 'completed', recommendation: 'BUY', confidence: 60,
      reasoning: 'r', errorMessage: null, errorCode: null, result: {}, fullResponse: null, imageUrl: null,
      createdAt: new Date('2026-10-10T00:00:00Z'), updatedAt: new Date('2026-10-10T00:00:01Z'),
    };
    (service as any).getSignedImageUrl = jest.fn().mockResolvedValue(null);
    (service as any).getOutcomeById = jest.fn().mockResolvedValue({ outcome: 'stop', pnlPercent: null, pnlAmount: null });
    (service as any).getCalibration = jest.fn().mockResolvedValue({ sampleSize: 0, winRate: null });

    prisma.analysis.findFirst.mockResolvedValue({
      ...base, outcome: 'WIN', outcomeDetail: { entry: 4150, stopLoss: 4140, takeProfit1: 4170, tp2Hit: true },
    });
    expect(await service.getAnalysis('an_done', 'usr_1')).toMatchObject({
      outcome: 'stop', marketOutcome: 'WIN', marketTp1R: 2, marketTp2Hit: true,
    });

    prisma.analysis.findFirst.mockResolvedValue({ ...base, outcome: 'LOSS', outcomeDetail: { tp2Hit: true } });
    expect(await service.getAnalysis('an_done', 'usr_1')).toMatchObject({
      marketOutcome: 'LOSS', marketTp1R: null, marketTp2Hit: false,
    });

    prisma.analysis.findFirst.mockResolvedValue({ ...base, outcome: null, outcomeDetail: null });
    expect(await service.getAnalysis('an_done', 'usr_1')).toMatchObject({ marketOutcome: null, marketTp1R: null });
  });

  it('track record: counts only the user own BUY/SELL plans of the last 30 days', async () => {
    prisma.analysis.groupBy = jest.fn().mockResolvedValue([
      { outcome: 'WIN', _count: { _all: 3 } },
      { outcome: 'LOSS', _count: { _all: 4 } },
      { outcome: 'NO_FILL', _count: { _all: 1 } },
      { outcome: null, _count: { _all: 2 } },
    ]);
    const out = await service.getTrackRecord('usr_1');
    expect(out).toEqual({ days: 30, plans: 10, win: 3, loss: 4, noFill: 1, timeout: 0, pending: 2 });
    const where = prisma.analysis.groupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'usr_1', status: 'completed', recommendation: { in: ['BUY', 'SELL'] } });
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(30 * 24 * 3600_000 - 1000);
  });

  it('never leaks a prior error code while polling an analysis in progress', async () => {
    prisma.analysis.findFirst.mockResolvedValue({
      id: 'an_processing', status: 'processing', errorCode: 'openai_rate_limit',
      errorMessage: 'Retrying', createdAt: new Date(), updatedAt: new Date(),
    });
    const response = await service.getAnalysis('an_processing', 'usr_1');
    expect(response.status).toBe('processing');
    expect(response.errorCode).toBeNull();
  });

  it('bloqueia depois de 3 sinais (BUY/SELL) grátis → DEMO_LIMIT_REACHED', async () => {
    setFreeQuota(prisma, { signals: 3 });

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

  it('bloqueia com 10 análises grátis no total, mesmo sem nenhum sinal', async () => {
    setFreeQuota(prisma, { signals: 0, total: 10 });

    await expect(service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.analysis.create).not.toHaveBeenCalled();
  });

  it('análise em andamento conta: 2 sinais + 1 rodando bloqueiam a próxima', async () => {
    setFreeQuota(prisma, { signals: 2, inFlight: 1 });

    await expect(service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.analysis.create).not.toHaveBeenCalled();
  });

  it('WAIT não consome: com 3 WAITs concluídos a próxima análise é liberada', async () => {
    setFreeQuota(prisma, { signals: 0, total: 3 });
    (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
    (getAiQueue as jest.Mock).mockReturnValue({ add: jest.fn().mockResolvedValue(undefined) });

    await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);

    expect(prisma.analysis.create).toHaveBeenCalledTimes(1);
  });

  it('reserva a análise grátis dentro da transação quando ainda há cota', async () => {
    // 2 sinais usados → o 3º é permitido.
    setFreeQuota(prisma, { signals: 2 });
    // Fila online: createAnalysis enfileira e retorna sem rodar o processamento.
    (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
    const add = jest.fn().mockResolvedValue(undefined);
    (getAiQueue as jest.Mock).mockReturnValue({ add });

    await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.analysis.create).toHaveBeenCalledTimes(1);
    // A análise é marcada como demo (isDemo=true).
    expect(prisma.analysis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDemo: true, userId: 'usr_1' }),
      }),
    );
    expect(add).toHaveBeenCalledWith('process-analysis', expect.objectContaining({
      analysisId: 'an_1', userId: 'usr_1', isDemo: true,
    }), { jobId: 'an_1' });
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

  it('cria a análise paga e debita ticks na mesma transação', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: null });
    ticksService.debitTicks.mockResolvedValue(undefined);
    (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
    (getAiQueue as jest.Mock).mockReturnValue({ add: jest.fn().mockResolvedValue(undefined) });

    await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ticksService.debitTicks).toHaveBeenCalledWith(
      'usr_1', 1, expect.any(String), { analysisType: 'quick' }, prisma,
    );
    expect(prisma.analysis.create).toHaveBeenCalledTimes(1);
    expect(prisma.analysis.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'usr_1', isDemo: false, status: 'pending' }),
    }));
  });

  it('não conclui a transação paga se a criação da análise falhar', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: null });
    ticksService.debitTicks.mockResolvedValue(undefined);
    prisma.analysis.create.mockRejectedValueOnce(new Error('insert failed'));
    let committed = false;
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const result = await callback(prisma);
      committed = true;
      return result;
    });

    await expect(service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL))
      .rejects.toThrow('insert failed');

    expect(ticksService.debitTicks).toHaveBeenCalledWith(
      'usr_1', 1, expect.any(String), { analysisType: 'quick' }, prisma,
    );
    expect(committed).toBe(false);
  });

  it('falha e reembolsa quando a validação prévia do caminho síncrono bloqueia', async () => {
    prisma.analysis.update
      .mockResolvedValueOnce({ id: 'an_1', status: 'processing' })
      .mockResolvedValueOnce({ id: 'an_1', status: 'failed', createdAt: new Date() });
    ticksService.refundTicks = jest.fn().mockResolvedValue(undefined);

    await expect((service as any).processSynchronously({
      analysisId: 'an_1', imageUrl: 'invalid-image-url', userId: 'usr_1',
      analysisType: 'quick', isDemo: false,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.analysis.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', errorCode: 'processing_unclassified' }),
    }));
    expect(ticksService.refundTicks).toHaveBeenCalledWith(
      'usr_1', 1, 'Refund: analysis failed', 'an_1',
    );
    expect(promptBuilder.buildPromptByVersion).not.toHaveBeenCalled();
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

  // ── Gratis esgotado: 402 nas rotas de operacao ──────────────────────────────
  // Regra de 05/10/2026: depois das gratis, historico completo, diario, marcar
  // resultado e favoritar ficam para quem assina; as 3 ultimas analises
  // continuam abertas para leitura. Antes de esgotar nada trava.
  describe('gratis esgotado', () => {
    const expect402 = async (promise: Promise<unknown>) => {
      await expect(promise).rejects.toMatchObject({
        status: 402,
        response: { code: 'free_quota_exhausted' },
      });
    };
    const range = [new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z')] as const;

    it('diario, resultado e favorito respondem 402 free_quota_exhausted', async () => {
      setFreeQuota(prisma, { signals: 3 });
      await expect402(service.listAnalysesInRange('usr_1', ...range));
      await expect402(service.setOutcome('usr_1', 'an_1', { outcome: 'tp1' }));
      await expect402(service.setFavorite('usr_1', 'an_1', true));
    });

    it('historico: so as 3 ultimas concluidas, sem paginacao', async () => {
      setFreeQuota(prisma, { signals: 3 });
      await service.listAnalyses('usr_1', 40);
      const args = prisma.analysis.findMany.mock.calls[0][0];
      expect(args.take).toBe(3);
      expect(args.where).toEqual({ userId: 'usr_1', status: 'completed' });

      prisma.analysis.findMany.mockClear();
      expect(await service.listAnalyses('usr_1', 40, 'an_123')).toEqual([]);
      expect(prisma.analysis.findMany).not.toHaveBeenCalled();
    });

    it('analise mais antiga que as 3 ultimas: 402; em andamento nunca trava o polling', async () => {
      setFreeQuota(prisma, { signals: 3 });
      prisma.analysis.findFirst.mockResolvedValue({ id: 'an_old', status: 'completed', createdAt: new Date(), updatedAt: new Date() });
      prisma.analysis.findMany.mockResolvedValue([{ id: 'an_3' }, { id: 'an_2' }, { id: 'an_1' }]);
      await expect402(service.getAnalysis('an_old', 'usr_1'));

      prisma.analysis.findFirst.mockResolvedValue({ id: 'an_new', status: 'processing', createdAt: new Date(), updatedAt: new Date() });
      expect((await service.getAnalysis('an_new', 'usr_1')).status).toBe('processing');
    });

    it('antes de esgotar nada trava', async () => {
      setFreeQuota(prisma, { signals: 2 });
      await expect(service.listAnalysesInRange('usr_1', ...range)).resolves.toMatchObject({ truncated: false });
      await service.listAnalyses('usr_1', 40);
      expect(prisma.analysis.findMany.mock.calls.at(-1)[0].take).toBe(40);
    });

    it('assinante (inclusive acesso manual) e admin nunca travam', async () => {
      setFreeQuota(prisma, { signals: 3 });
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', stripeId: 'manual_owner_1', priceId: null });
      await expect(service.isFreeLocked('usr_1')).resolves.toBe(false);

      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', role: 'admin' });
      await expect(service.isFreeLocked('usr_1')).resolves.toBe(false);
    });

    it('/usage avisa a tela com freeLocked', async () => {
      setFreeQuota(prisma, { signals: 3 });
      expect((await service.getUsage('usr_1')).freeLocked).toBe(true);
      setFreeQuota(prisma, { signals: 1 });
      expect((await service.getUsage('usr_1')).freeLocked).toBe(false);
    });
  });

  // ── setOutcome ────────────────────────────────────────────────────────────────
  // `Number(null)` e 0: ate 25/09/2026 "sem valor" era gravado como 0, e um trade
  // sem valor aparecia como +0.00 e entrava na soma do Diario.
  describe('setOutcome: valor da operacao', () => {
    function valuesOfUpdate() {
      const call = (prisma.$executeRaw as jest.Mock).mock.calls.at(-1);
      return call.slice(1) as unknown[];
    }

    beforeEach(() => {
      prisma.$executeRaw = jest.fn().mockResolvedValue(1);
      prisma.analysis.findFirst.mockResolvedValue({ id: 'an_1' });
      (service as any).outcomeColumnsReady = true;
    });

    it('sem valor grava NULL, nunca 0', async () => {
      await service.setOutcome('usr_1', 'an_1', { outcome: 'tp1', pnlAmount: null });
      await service.setOutcome('usr_1', 'an_1', { outcome: 'tp1' });
      const [verdict, pnlPercent, pnlAmount] = valuesOfUpdate();
      expect(verdict).toBe('tp1');
      expect(pnlPercent).toBeNull();
      expect(pnlAmount).toBeNull();
    });

    it('valor informado, inclusive negativo e zero de verdade, vai como numero', async () => {
      await service.setOutcome('usr_1', 'an_1', { outcome: 'stop', pnlAmount: -40.25 });
      expect(valuesOfUpdate()[2]).toBe(-40.25);
      await service.setOutcome('usr_1', 'an_1', { outcome: 'tp1', pnlAmount: 0 });
      expect(valuesOfUpdate()[2]).toBe(0);
    });

    it('registrar resultado vira trade_outcome_set no PostHog', async () => {
      captureServer.mockClear();
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1' });
      await service.setOutcome('usr_1', 'an_1', { outcome: 'tp2', pnlAmount: 80 });
      await new Promise((r) => setImmediate(r));
      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'trade_outcome_set',
        { analysisId: 'an_1', outcome: 'tp2', hasPnl: true },
        {},
      );
    });

    it('entrada nao atingida (no_fill) e gravada como veredito', async () => {
      await service.setOutcome('usr_1', 'an_1', { outcome: 'no_fill' });
      expect(valuesOfUpdate()[0]).toBe('no_fill');
    });
  });

  // ── Anotacao do trader (Diario, 05/10/2026) ───────────────────────────────────
  describe('anotacao do trade', () => {
    it('sanitize: so valores das listas, nota cortada, tudo vazio vira null', () => {
      expect(sanitizeTradeNote({ note: '  entrei cedo  ', setup: 'pullback', emotion: 'fomo', mistakes: ['late_entry', 'late_entry', 'hack'] })).toEqual({
        note: 'entrei cedo', setup: 'pullback', emotion: 'fomo', mistakes: ['late_entry'],
      });
      expect(sanitizeTradeNote({ setup: 'DROP TABLE', emotion: 42, note: '   ', mistakes: 'x' })).toBeNull();
      expect(sanitizeTradeNote(null)).toBeNull();
      expect(sanitizeTradeNote({ note: 'a'.repeat(1500) })?.note).toHaveLength(1000);
    });

    describe('setTradeNote', () => {
      beforeEach(() => {
        prisma.$executeRaw = jest.fn().mockResolvedValue(1);
        prisma.analysis.findFirst.mockResolvedValue({ id: 'an_1' });
        (service as any).tradeNoteReady = true;
      });
      const valueOfUpdate = () => (prisma.$executeRaw as jest.Mock).mock.calls.at(-1)[1];

      it('grava o JSON limpo como jsonb, so na analise do proprio usuario', async () => {
        const out = await service.setTradeNote('usr_1', 'an_1', { note: 'ok', setup: 'breakout', mistakes: ['oversized'] });
        expect(out.tradeNote).toEqual({ note: 'ok', setup: 'breakout', emotion: null, mistakes: ['oversized'] });
        expect(valueOfUpdate().values[0]).toBe(JSON.stringify(out.tradeNote));
        const strings = (prisma.$executeRaw as jest.Mock).mock.calls.at(-1)[0].join('?');
        expect(strings).toContain('"userId" =');
        expect(prisma.analysis.findFirst).toHaveBeenCalledWith({ where: { id: 'an_1', userId: 'usr_1' }, select: { id: true } });
      });

      it('apagar tudo grava NULL', async () => {
        await service.setTradeNote('usr_1', 'an_1', { note: '', setup: null, mistakes: [] });
        expect(valueOfUpdate().values).toEqual([]);
        expect(valueOfUpdate().strings.join('')).toBe('NULL');
      });

      it('analise de outro usuario: recusa sem gravar', async () => {
        prisma.analysis.findFirst.mockResolvedValue(null);
        await expect(service.setTradeNote('usr_1', 'alheia', { note: 'x' })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
      });

      it('sem a coluna, so as notas ficam indisponiveis (503)', async () => {
        (service as any).tradeNoteReady = false;
        await expect(service.setTradeNote('usr_1', 'an_1', { note: 'x' })).rejects.toMatchObject({ status: 503 });
      });

      it('PostHog recebe o evento sem o texto da nota', async () => {
        captureServer.mockClear();
        prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1' });
        await service.setTradeNote('usr_1', 'an_1', { note: 'segredo', emotion: 'calm' });
        await new Promise((r) => setImmediate(r));
        const call = captureServer.mock.calls.find((c) => c[1] === 'trade_note_saved');
        expect(call?.[2]).toMatchObject({ hasNote: true, emotion: 'calm', mistakes: 0 });
        expect(JSON.stringify(call?.[2])).not.toContain('segredo');
      });
    });

    it('a lista le a anotacao so quando a coluna existe, e devolve limpa', async () => {
      prisma.analysis.findMany.mockResolvedValue([{ id: 'a1', imageUrl: null, status: 'completed', result: {}, createdAt: new Date() }]);
      (service as any).outcomeColumnsReady = true;
      (service as any).tradeNoteReady = false;
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'a1', outcome: 'tp1', pnlPercent: null, pnlAmount: 10, isFavorite: false }]);
      const range: [Date, Date] = [new Date('2026-10-01T00:00:00Z'), new Date('2026-10-20T00:00:00Z')];
      await service.listAnalysesInRange('usr_1', ...range);
      expect((prisma.$queryRaw as jest.Mock).mock.calls[0][0].sql).not.toContain('tradeNote');

      (service as any).tradeNoteReady = true;
      prisma.$queryRaw = jest.fn().mockResolvedValue([
        { id: 'a1', outcome: 'tp1', pnlPercent: null, pnlAmount: 10, isFavorite: false, tradeNote: { note: 'ok', setup: 'bogus', mistakes: ['early_exit'] } },
      ]);
      const out = await service.listAnalysesInRange('usr_1', ...range);
      expect((prisma.$queryRaw as jest.Mock).mock.calls[0][0].sql).toContain('"tradeNote"');
      expect(out.items[0].tradeNote).toEqual({ note: 'ok', setup: null, emotion: null, mistakes: ['early_exit'] });
    });
  });

  // ── listAnalysesInRange (Diario) ──────────────────────────────────────────────
  // O calendario do mes agrupa por dia no navegador; aqui so se filtra o
  // intervalo. Os testes travam o filtro por usuario/status/data, os tetos e o
  // aviso de mes cortado (sem ele a soma do mes sairia menor que a real, calada).
  describe('listAnalysesInRange: Diario', () => {
    const from = new Date('2026-09-01T03:00:00.000Z');
    const to = new Date('2026-10-01T03:00:00.000Z');

    it('filtra por usuario, so concluidas, no intervalo [from, to)', async () => {
      await service.listAnalysesInRange('usr_1', from, to);
      const args = prisma.analysis.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ userId: 'usr_1', status: 'completed', createdAt: { gte: from, lt: to } });
      expect(args.select.fullResponse).toBeUndefined();
    });

    it('recusa intervalo invertido e maior que 45 dias, sem tocar no banco', async () => {
      await expect(service.listAnalysesInRange('usr_1', to, from)).rejects.toThrow();
      await expect(
        service.listAnalysesInRange('usr_1', from, new Date(from.getTime() + 46 * 86_400_000)),
      ).rejects.toThrow();
      await expect(service.listAnalysesInRange('usr_1', new Date('x'), to)).rejects.toThrow();
      expect(prisma.analysis.findMany).not.toHaveBeenCalled();
    });

    it('avisa quando o teto de 500 corta o mes', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({
        id: `a${i}`, imageUrl: null, status: 'completed', result: {}, createdAt: new Date(),
      }));
      prisma.analysis.findMany.mockResolvedValue(rows);
      const out = await service.listAnalysesInRange('usr_1', from, to);
      expect(prisma.analysis.findMany.mock.calls[0][0].take).toBe(501);
      expect(out.truncated).toBe(true);
      expect(out.items).toHaveLength(500);
    });

    it('mes pequeno volta inteiro e sem aviso, no mesmo formato da lista', async () => {
      prisma.analysis.findMany.mockResolvedValue([
        { id: 'a1', imageUrl: null, status: 'completed', result: {}, createdAt: new Date() },
      ]);
      const out = await service.listAnalysesInRange('usr_1', from, to);
      expect(out.truncated).toBe(false);
      expect(out.items[0]).toMatchObject({ id: 'a1', status: 'completed', pnlAmount: null });
    });

    it('manda o resultado do mercado (sweeper) em marketOutcome, sem misturar com o que o trader marcou', async () => {
      prisma.analysis.findMany.mockResolvedValue([
        { id: 'a1', imageUrl: null, status: 'completed', result: {}, outcome: 'WIN', createdAt: new Date() },
        { id: 'a2', imageUrl: null, status: 'completed', result: {}, outcome: null, createdAt: new Date() },
      ]);
      const out = await service.listAnalysesInRange('usr_1', from, to);
      expect(prisma.analysis.findMany.mock.calls[0][0].select.outcome).toBe(true);
      expect(out.items[0]).toMatchObject({ id: 'a1', marketOutcome: 'WIN', outcome: null });
      expect(out.items[1]).toMatchObject({ id: 'a2', marketOutcome: null });
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
    setFreeQuota(prisma, { signals: 2, total: 5 });

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('free');
    expect(usage.period).toBe('monthly');
    // total/used/remaining seguem falando de sinais (compatibilidade do front).
    expect(usage.total).toBe(3);
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(1);
    expect(usage.canAnalyze).toBe(true);
    expect(usage.isUnlimited).toBe(false);
    expect(usage).toMatchObject({ signalsUsed: 2, signalsLimit: 3, totalUsed: 5, totalLimit: 10 });
  });

  it('getUsage free: 10 no total bloqueia mesmo com sinais sobrando', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    setFreeQuota(prisma, { signals: 1, total: 10 });

    const usage = await service.getUsage('usr_1');

    expect(usage.remaining).toBe(0);
    expect(usage.canAnalyze).toBe(false);
  });

  // Este teste existe por causa de um bug que o dono viu na tela: o KPI de
  // análises do painel contava a LISTA CARREGADA (useAnalyses(40)) e rotulava o
  // número como "all time". Uma conta com 403 análises exibia 38, para sempre.
  // A correção foi devolver uma contagem REAL daqui. Se alguém trocar este
  // count() por algo derivado de uma lista com take, este teste pega.
  it('getUsage devolve analysesAllTime a partir de um count() real, sem teto', async () => {
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 2 });
    prisma.subscription.findFirst.mockResolvedValue(null);
    // Contagens diferentes no mesmo método: a do histórico completo e as da
    // cota grátis. Distinguidas pela cláusula, não pela ordem da chamada.
    setFreeQuota(prisma, { signals: 2, allTime: 403 });

    const usage = await service.getUsage('usr_1');

    expect(usage.analysesAllTime).toBe(403);
    // O contador do período continua sendo outra coisa, e não pode se misturar.
    expect(usage.used).toBe(2);
    expect(prisma.analysis.count).toHaveBeenCalledWith({
      where: { userId: 'usr_1', status: 'completed' },
    });
  });

  it('getUsage free: com os 3 sinais usados, bloqueia (mesma régua do paywall)', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    setFreeQuota(prisma, { signals: 3 });

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

  it('getUsage assinante semanal: plano weekly e ciclo weekly', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: 'price_1UKeWPB1hl0IoocUjsQNv9BG' });
    ticksService.getBalance.mockResolvedValue(25);

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('weekly');
    expect(usage.billingCycle).toBe('weekly');
    expect(usage.period).toBe('weekly');
  });

  describe('origem da analise (clientContext, 06/10/2026)', () => {
    const flush = async () => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    };

    beforeEach(() => {
      captureServer.mockClear();
      prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', email: 'trader@example.com', clerkUserId: 'clerk_1' });
      prisma.$executeRaw = jest.fn().mockResolvedValue(1);
      (service as any).clientContextReady = true;
      setFreeQuota(prisma, { signals: 0 });
      (getAiQueueReadiness as jest.Mock).mockResolvedValue(QUEUE_ONLINE);
      (getAiQueue as jest.Mock).mockReturnValue({ add: jest.fn().mockResolvedValue(undefined) });
    });

    it('extensao: grava o clientContext na analise criada e marca source no evento', async () => {
      const context = { source: 'extension' as const, platform: 'tradingview', chartSymbol: 'FX:EURJPY', chartTimeframe: '5m' };

      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL, undefined, 'quick', 'en', [], context);
      await flush();

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const [sqlParts, ...values] = (prisma.$executeRaw as jest.Mock).mock.calls[0];
      expect(sqlParts.join('?')).toContain('"clientContext"');
      expect(values).toContain(JSON.stringify(context));
      expect(values).toContain('an_1');
      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'free_analysis_started',
        expect.objectContaining({ analysisId: 'an_1', source: 'extension' }),
        expect.anything(),
      );
    });

    it('site: nao grava nada e o evento sai com source web', async () => {
      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);
      await flush();

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(captureServer).toHaveBeenCalledWith(
        'clerk_1',
        'free_analysis_started',
        expect.objectContaining({ source: 'web' }),
        expect.anything(),
      );
    });

    it('falha ao gravar o clientContext nao derruba a analise', async () => {
      prisma.$executeRaw = jest.fn().mockRejectedValue(new Error('column missing'));

      await expect(
        service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL, undefined, 'quick', 'en', [], { source: 'extension' }),
      ).resolves.toMatchObject({ id: 'an_1' });
    });

    it('coluna indisponivel no boot: nem tenta gravar', async () => {
      (service as any).clientContextReady = false;

      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL, undefined, 'quick', 'en', [], { source: 'extension' });

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    describe('getPriceAxis (linhas da extensao)', () => {
      const row = (over: Record<string, unknown> = {}) => ({
        imageUrl: 'data:image/jpeg;base64,AAAA',
        status: 'completed',
        recommendation: 'BUY',
        clientContext: { source: 'extension', platform: 'tradingview' },
        ...over,
      });

      beforeEach(() => {
        (service as any).aiAdapter.readPriceAxis = jest.fn().mockResolvedValue({ top: 189.37, bottom: 173.85 });
      });

      it('le o eixo uma vez, guarda e devolve', async () => {
        prisma.$queryRaw = jest.fn().mockResolvedValue([row()]);
        await expect(service.getPriceAxis('usr_1', 'an_1')).resolves.toEqual({ top: 189.37, bottom: 173.85 });
        expect((service as any).aiAdapter.readPriceAxis).toHaveBeenCalledTimes(1);
        const [sqlParts, ...values] = (prisma.$executeRaw as jest.Mock).mock.calls[0];
        expect(sqlParts.join('?')).toContain('priceAxis');
        expect(values).toContain(JSON.stringify({ top: 189.37, bottom: 173.85 }));
      });

      it('ja guardado: devolve sem chamar a IA', async () => {
        prisma.$queryRaw = jest.fn().mockResolvedValue([row({ clientContext: { source: 'extension', priceAxis: { top: 2, bottom: 1 } } })]);
        await expect(service.getPriceAxis('usr_1', 'an_1')).resolves.toEqual({ top: 2, bottom: 1 });
        expect((service as any).aiAdapter.readPriceAxis).not.toHaveBeenCalled();
      });

      it('analise do site, WAIT ou em andamento: sem IA e sem linhas', async () => {
        for (const over of [{ clientContext: null }, { recommendation: 'WAIT' }, { status: 'processing' }]) {
          prisma.$queryRaw = jest.fn().mockResolvedValue([row(over)]);
          await expect(service.getPriceAxis('usr_1', 'an_1')).resolves.toEqual({ top: null, bottom: null });
        }
        expect((service as any).aiAdapter.readPriceAxis).not.toHaveBeenCalled();
      });

      it('analise de outra pessoa (ou inexistente) e recusada', async () => {
        prisma.$queryRaw = jest.fn().mockResolvedValue([]);
        await expect(service.getPriceAxis('usr_1', 'an_x')).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('buildClientContext: so a extensao gera contexto, sem campos vazios', () => {
      expect(buildClientContext({})).toBeNull();
      expect(buildClientContext({ source: 'web' })).toBeNull();
      expect(buildClientContext({ source: 'extension', chartSymbol: '', platform: 'other' })).toEqual({
        source: 'extension',
        platform: 'other',
      });
    });
  });

  it('analise paga manda custo, saldo e plano para o PostHog (evento e perfil)', async () => {
    captureServer.mockClear();
    prisma.user.findUnique.mockResolvedValue({ id: 'usr_1', clerkUserId: 'clerk_1' });
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: 'price_1UKeWPB1hl0IoocUjsQNv9BG' });
    ticksService.getBalance.mockResolvedValue(22);
    const createdAt = new Date('2026-09-29T12:00:00Z');

    await (service as any).trackPaidAnalysisStarted('usr_1', { id: 'an_9', createdAt }, 'deep');

    expect(captureServer).toHaveBeenCalledWith(
      'clerk_1',
      'paid_analysis_started',
      expect.objectContaining({
        analysisId: 'an_9',
        analysisType: 'deep',
        ticksCost: 3,
        ticksLeft: 22,
        plan: 'weekly',
        billingCycle: 'weekly',
        $set: expect.objectContaining({ plan: 'weekly', billing_cycle: 'weekly', ticks_left: 22 }),
      }),
      { dedupeKey: 'paid_analysis_started:an_9', timestamp: createdAt },
    );
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
      setFreeQuota(prisma, { signals: 3 });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).toHaveBeenCalledTimes(1);
      expect(mailService.sendRecovery).toHaveBeenCalledWith(
        'trader@example.com',
        expect.objectContaining({ code: 'EARLY35', active: true }),
      );
    });

    it('não envia enquanto ainda sobra cota', async () => {
      setFreeQuota(prisma, { signals: 2 });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
    });

    it('não envia com WAIT/WAIT/WAIT: WAIT não esgota a cota', async () => {
      setFreeQuota(prisma, { signals: 0, total: 3 });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
    });

    it('envia quando o total de 10 é atingido', async () => {
      setFreeQuota(prisma, { signals: 1, total: 10 });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).toHaveBeenCalledTimes(1);
    });

    it('não envia para análise de assinante (isDemo=false)', async () => {
      setFreeQuota(prisma, { signals: 3 });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', false);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
      expect(prisma.analysis.count).not.toHaveBeenCalled();
    });

    it('não envia para quem já assinou, mesmo com a cota grátis esgotada', async () => {
      setFreeQuota(prisma, { signals: 3 });
      prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1', priceId: 'price_1' });

      await (service as any).notifyIfFreeQuotaExhausted('usr_1', true);

      expect(mailService.sendRecovery).not.toHaveBeenCalled();
    });

    it('não envia duas vezes: a dedup por AdminAudit vale para os dois gatilhos', async () => {
      setFreeQuota(prisma, { signals: 3 });
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
      ['invalid_trade_plan', 'inconsistent entry'],
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
