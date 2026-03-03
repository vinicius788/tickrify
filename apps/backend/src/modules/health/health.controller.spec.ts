import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { getAiQueueReadiness } from '../ai/ai.queue';

jest.mock('../ai/ai.queue', () => ({
  getAiQueueReadiness: jest.fn(),
}));

const queueReadinessMock = getAiQueueReadiness as jest.MockedFunction<typeof getAiQueueReadiness>;

const READY_QUEUE = {
  required: false,
  configured: false,
  connected: false,
  workersCount: 0,
  hasWorkers: false,
  ready: true,
  reason: 'ok' as const,
};

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: {
    isReady: jest.Mock<boolean, []>;
    checkConnection: jest.Mock<Promise<boolean>, []>;
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OPENAI_API_KEY;

    prisma = {
      isReady: jest.fn().mockReturnValue(true),
      checkConnection: jest.fn().mockResolvedValue(true),
    };

    queueReadinessMock.mockResolvedValue(READY_QUEUE);
    controller = new HealthController(prisma as any);
  });

  it('treats critical deps as ready in non-production runtime', async () => {
    const readiness = await controller.getReadiness();

    expect(readiness.status).toBe('ok');
    expect(readiness.environment).toBe('non_production');
    expect(readiness.auth.ready).toBe(true);
    expect(readiness.storage.ready).toBe(true);
    expect(readiness.ai.ready).toBe(true);
  });

  it('returns minimal public liveness payload', () => {
    expect(controller.getLiveness()).toEqual({ status: 'ok' });
  });

  it('fails readiness in production when OpenAI key is missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    process.env.CLERK_SECRET_KEY = 'clerk_secret_example';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'supabase_service_role_example';

    queueReadinessMock.mockResolvedValue({
      ...READY_QUEUE,
      required: true,
      configured: true,
      connected: true,
      workersCount: 1,
      hasWorkers: true,
      ready: true,
    });

    try {
      await controller.getReadiness();
      throw new Error('Expected ServiceUnavailableException');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse() as Record<string, any>;
      expect(response.status).toBe('not_ready');
      expect(response.ai).toEqual(
        expect.objectContaining({
          required: true,
          configured: false,
          ready: false,
        }),
      );
    }
  });
});
