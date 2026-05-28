import { isProductionRuntime } from './runtime-env';

describe('runtime-env fail-closed behavior', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('treats unknown APP_ENV as production (fail-closed)', () => {
    process.env.APP_ENV = 'staging-weird';
    process.env.NODE_ENV = 'development';
    expect(isProductionRuntime()).toBe(true);
  });

  it('treats missing APP_ENV and NODE_ENV as production', () => {
    delete process.env.APP_ENV;
    delete process.env.NODE_ENV;
    expect(isProductionRuntime()).toBe(true);
  });
});

