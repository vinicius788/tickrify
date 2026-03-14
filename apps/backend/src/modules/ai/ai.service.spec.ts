import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';

const VALID_PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]).toString('base64')}`;

describe('AiService access enforcement', () => {
  let service: AiService;
  let prisma: any;
  let ticksService: any;

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

    service = new AiService(prisma, aiAdapter as any, ticksService as any);
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
