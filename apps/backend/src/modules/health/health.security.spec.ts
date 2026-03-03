import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { OpsTokenGuard } from './ops-token.guard';
import { PrismaService } from '../database/prisma.service';
import { getAiQueueReadiness } from '../ai/ai.queue';

const request = require('supertest');

jest.mock('../ai/ai.queue', () => ({
  getAiQueueReadiness: jest.fn(),
}));

const queueReadinessMock = getAiQueueReadiness as jest.MockedFunction<typeof getAiQueueReadiness>;

describe('Health routes security', () => {
  let app: INestApplication;

  const prismaMock = {
    isReady: jest.fn().mockReturnValue(true),
    checkConnection: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    delete process.env.INTERNAL_OPS_TOKEN;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.OPENAI_API_KEY;

    queueReadinessMock.mockResolvedValue({
      required: false,
      configured: false,
      connected: false,
      workersCount: 0,
      hasWorkers: false,
      ready: true,
      reason: 'ok',
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        OpsTokenGuard,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    delete process.env.INTERNAL_OPS_TOKEN;
    await app.close();
  });

  it('keeps /api/health/live public and minimal', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns 403 for /api/health/ready without valid ops token', async () => {
    process.env.INTERNAL_OPS_TOKEN = 'ops-secret';

    const response = await request(app.getHttpServer()).get('/api/health/ready');
    expect(response.status).toBe(403);
  });

  it('allows /api/health/ready only with correct x-ops-token', async () => {
    process.env.INTERNAL_OPS_TOKEN = 'ops-secret';

    const response = await request(app.getHttpServer())
      .get('/api/health/ready')
      .set('x-ops-token', 'ops-secret');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
