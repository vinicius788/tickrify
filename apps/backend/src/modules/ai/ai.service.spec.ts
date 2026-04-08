import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';

const VALID_PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]).toString('base64')}`;

describe('AiService access enforcement', () => {
  let service: AiService;
  let prisma: any;
  let ticksService: any;
  let promptBuilder: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.FREE_ANALYSIS_LIMIT_PER_MONTH = '3';
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_STORAGE_BUCKET;

    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }),
      },
      analysisUsage: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      analysis: {
        create: jest.fn(),
        update: jest.fn(),
      },
      promptConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

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

    service = new AiService(prisma, aiAdapter as any, ticksService as any, promptBuilder as any);
  });

  it('blocks analysis creation when free quota is exhausted and user has no ticks', async () => {
    try {
      await service.createAnalysis('usr_1', undefined, VALID_PNG_DATA_URL);
      throw new Error('Expected INSUFFICIENT_TICKS exception');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as { message?: string };
      expect(String(response?.message || '')).toContain('INSUFFICIENT_TICKS');
    }
  });

  it('returns free-plan usage details when user has no active subscription', async () => {
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 2 });
    prisma.subscription.findFirst.mockResolvedValue(null);

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('free');
    expect(usage.period).toBe('monthly');
    expect(usage.total).toBe(3);
    expect(usage.used).toBe(2);
    expect(usage.remaining).toBe(1);
    expect(usage.canAnalyze).toBe(true);
    expect(usage.isUnlimited).toBe(false);
  });

  it('returns pro-plan usage details when user has active subscription', async () => {
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 99 });
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub_1' });

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('pro');
    expect(usage.total).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.used).toBe(99);
    expect(usage.canAnalyze).toBe(true);
    expect(usage.isUnlimited).toBe(true);
  });

  it('returns unlimited usage for free users when free limit is disabled', async () => {
    process.env.FREE_ANALYSIS_LIMIT_PER_MONTH = '0';
    prisma.analysisUsage.findUnique.mockResolvedValue({ count: 99 });
    prisma.subscription.findFirst.mockResolvedValue(null);

    const usage = await service.getUsage('usr_1');

    expect(usage.plan).toBe('free');
    expect(usage.total).toBeNull();
    expect(usage.remaining).toBeNull();
    expect(usage.used).toBe(99);
    expect(usage.canAnalyze).toBe(true);
    expect(usage.isUnlimited).toBe(true);
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

    expect(result).toContain(TRADING_SYSTEM_PROMPT.slice(0, 40));
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

  it('toUserMessage maps known codes to Portuguese messages', async () => {
    const { AIAnalysisError } = await import('./ai.adapter');

    const cases: Array<[import('./ai.adapter').AIAnalysisErrorCode, string]> = [
      ['openai_billing', 'Limite de análises atingido'],
      ['openai_rate_limit', 'sobrecarregado'],
      ['openai_truncated_response', 'gráfico mais simples'],
      ['openai_empty_content', 'analisar a imagem'],
      ['openai_request_failed', 'Erro na análise'],
    ];

    for (const [code, expectedSubstring] of cases) {
      const error = new AIAnalysisError({ code, message: 'raw', retriable: false });
      expect(AIAnalysisError.toUserMessage(error).toLowerCase()).toContain(
        expectedSubstring.toLowerCase(),
      );
    }

    expect(AIAnalysisError.toUserMessage(new Error('generic'))).toBe(
      'Erro na análise. Tente novamente.',
    );
  });
});
