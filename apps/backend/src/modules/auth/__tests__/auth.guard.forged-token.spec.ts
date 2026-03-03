import { UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { AuthGuard } from '../auth.guard';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

describe('AuthGuard — forged token must always be rejected', () => {
  const verifyTokenMock = verifyToken as jest.Mock;
  let guard: AuthGuard;
  let prisma: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.ALLOW_LEGACY_AUTH_FALLBACK = 'true';

    prisma = {
      user: {
        upsert: jest.fn(),
      },
      adminAudit: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback) => callback(prisma)),
    };

    guard = new AuthGuard(prisma);
    verifyTokenMock.mockReset();
    verifyTokenMock.mockRejectedValue(new Error('invalid signature'));
  });

  afterEach(() => {
    delete process.env.ALLOW_LEGACY_AUTH_FALLBACK;
  });

  it('rejects a token with valid structure but no valid signature', async () => {
    const forgedToken = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: 'user_forged_123',
          iat: Math.floor(Date.now() / 1000),
        }),
      ).toString('base64url'),
      'invalidsignature',
    ].join('.');

    const request: any = {
      headers: {
        authorization: `Bearer ${forgedToken}`,
      },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

