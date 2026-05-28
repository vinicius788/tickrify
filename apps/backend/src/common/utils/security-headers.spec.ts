import { buildHelmetConfig } from './security-headers';

describe('security headers config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('enables frameguard deny and noSniff', () => {
    process.env.APP_ENV = 'test';
    const config = buildHelmetConfig();

    expect(config.frameguard).toEqual({ action: 'deny' });
    expect(config.noSniff).toBe(true);
  });

  it('disables HSTS in non-production runtime', () => {
    process.env.APP_ENV = 'test';
    const config = buildHelmetConfig();
    expect(config.hsts).toBe(false);
  });

  it('enables HSTS in production runtime', () => {
    process.env.APP_ENV = 'production';
    const config = buildHelmetConfig();
    expect(config.hsts).toEqual(
      expect.objectContaining({
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      }),
    );
  });
});

