import { isOriginAllowed, resolveAllowedOrigins } from './cors';

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

  // Extensao de navegador (06/10/2026): so a origem EXATA da extensao oficial
  // entra (env CORS_ORIGINS no Render). Outra extensao qualquer continua barrada.
  it('libera so a extensao listada, pela origem exata', () => {
    process.env.APP_ENV = 'production';
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://tickrify.com,chrome-extension://abcdefghijklmnopabcdefghijklmnop';

    const origins = resolveAllowedOrigins();
    expect(isOriginAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop', origins)).toBe(true);
    expect(isOriginAllowed('chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba', origins)).toBe(false);
    expect(isOriginAllowed('moz-extension://abcdefghijklmnopabcdefghijklmnop', origins)).toBe(false);
  });
});
