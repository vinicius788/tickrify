import { OpsTokenGuard } from './ops-token.guard';

describe('OpsTokenGuard', () => {
  const guard = new OpsTokenGuard();

  function contextWithToken(token?: string) {
    const headers: Record<string, string> = {};
    if (token) {
      headers['x-ops-token'] = token;
    }

    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as any;
  }

  afterEach(() => {
    delete process.env.INTERNAL_OPS_TOKEN;
  });

  it('denies when INTERNAL_OPS_TOKEN is missing', () => {
    expect(guard.canActivate(contextWithToken('anything'))).toBe(false);
  });

  it('denies when token does not match', () => {
    process.env.INTERNAL_OPS_TOKEN = 'ops-secret';
    expect(guard.canActivate(contextWithToken('wrong'))).toBe(false);
  });

  it('allows only matching x-ops-token', () => {
    process.env.INTERNAL_OPS_TOKEN = 'ops-secret';
    expect(guard.canActivate(contextWithToken('ops-secret'))).toBe(true);
  });
});

