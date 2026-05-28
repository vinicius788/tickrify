import { resolveAllowedOrigins } from './cors';

describe('cors origin resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FRONTEND_URL;
    delete process.env.CORS_ORIGINS;
    delete process.env.NODE_ENV;
    delete process.env.APP_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('includes localhost origins in non-production runtime', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'development';

    const origins = resolveAllowedOrigins();
    expect(origins).toEqual(
      expect.arrayContaining(['http://localhost:5173', 'http://localhost:5174']),
    );
  });

  it('excludes localhost origins when APP_ENV is production even if NODE_ENV is not', () => {
    process.env.NODE_ENV = 'development';
    process.env.APP_ENV = 'production';

    const origins = resolveAllowedOrigins();
    expect(origins).not.toEqual(expect.arrayContaining(['http://localhost:5173']));
  });
});

