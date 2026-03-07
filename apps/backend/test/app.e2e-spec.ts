import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { verifyToken } from '@clerk/backend';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/database/prisma.service';

const request = require('supertest');

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

jest.mock('openai', () => {
  const OpenAIMock = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  }));

  return {
    __esModule: true,
    default: OpenAIMock,
  };
});

jest.mock('stripe', () => {
  const StripeMock = jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
    billingPortal: {
      sessions: {
        create: jest.fn(),
      },
    },
    subscriptions: {
      update: jest.fn(),
      retrieve: jest.fn(),
    },
    customers: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));

  return {
    __esModule: true,
    default: StripeMock,
  };
});

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    waitUntilReady: jest.fn().mockResolvedValue(undefined),
    getWorkersCount: jest.fn().mockResolvedValue(1),
    client: Promise.resolve({
      ping: jest.fn().mockResolvedValue('PONG'),
    }),
  })),
}));

describe('App E2E', () => {
  let app: INestApplication;

  const verifyTokenMock = verifyToken as jest.MockedFunction<typeof verifyToken>;

  const prismaMock: any = {
    isReady: jest.fn().mockReturnValue(true),
    checkConnection: jest.fn().mockResolvedValue(true),
    user: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    adminAudit: {
      create: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    analysis: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    analysisUsage: {
      findUnique: jest.fn(),
    },
    promptConfig: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    promptAudit: {
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  prismaMock.$transaction.mockImplementation(async (callback: (tx: any) => unknown) =>
    callback(prismaMock),
  );

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.INTERNAL_OPS_TOKEN = 'ops-secret';

    verifyTokenMock.mockReset();
    verifyTokenMock.mockRejectedValue(new Error('Invalid token'));

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    delete process.env.INTERNAL_OPS_TOKEN;
    if (app) {
      await app.close();
    }
  });

  it('GET /api/health/live -> 200 sem token', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /api/auth/me sem token -> 401', async () => {
    const response = await request(app.getHttpServer()).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('POST /api/ai/analyze sem token -> 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/analyze')
      .send({});

    expect(response.status).toBe(401);
  });

  it('POST /api/ai/analyze com token inválido -> 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/ai/analyze')
      .set('Authorization', 'Bearer invalid-token')
      .send({});

    expect(response.status).toBe(401);
  });

  it('GET /api/health/ready sem ops-token -> 403', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready');
    expect(response.status).toBe(403);
  });
});
