import { UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { AuthGuard } from './auth.guard';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

describe('AuthGuard', () => {
  const verifyTokenMock = verifyToken as jest.Mock;
  let guard: AuthGuard;
  let prisma: any;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;

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
  });

  it('rejects requests without bearer token', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('loads role from database even when token has admin metadata', async () => {
    verifyTokenMock.mockResolvedValue({
      sub: 'clerk_user_1',
      email: 'trader@tickrify.com',
      unsafe_metadata: { role: 'admin' },
      public_metadata: { role: 'admin' },
    });

    prisma.user.upsert.mockResolvedValue({
      id: 'usr_1',
      clerkUserId: 'clerk_user_1',
      email: 'trader@tickrify.com',
      role: 'user',
    });

    const request: any = {
      headers: {
        authorization: 'Bearer fake.jwt.token',
      },
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: 'user' }),
      }),
    );
    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'usr_1',
        clerkUserId: 'clerk_user_1',
        role: 'user',
      }),
    );
  });
});
