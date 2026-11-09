const capture = jest.fn();
jest.mock('posthog-node', () => ({ PostHog: jest.fn(() => ({ capture })) }), { virtual: true });

import { captureServer } from '../posthog';
import { runWithClientIp } from '../../middleware/request-context.middleware';

describe('captureServer: IP e pais reais', () => {
  beforeAll(() => {
    process.env.POSTHOG_ENABLE_IN_TEST = 'true';
    process.env.POSTHOG_KEY = 'phc_test';
  });
  afterAll(() => {
    delete process.env.POSTHOG_ENABLE_IN_TEST;
    delete process.env.POSTHOG_KEY;
  });
  beforeEach(() => capture.mockClear());

  it('com usuario na ponta manda $ip e liga a geolocalizacao', () => {
    runWithClientIp('198.51.100.7', () => captureServer('user_1', 'x'));
    expect(capture.mock.calls[0][0]).toMatchObject({
      properties: expect.objectContaining({ $ip: '198.51.100.7' }),
      disableGeoip: false,
    });
  });

  it('sem usuario (webhook, varredura) nao manda IP nem liga a geolocalizacao', () => {
    captureServer('user_1', 'x');
    const args = capture.mock.calls[0][0];
    expect(args.properties).not.toHaveProperty('$ip');
    expect(args).not.toHaveProperty('disableGeoip');
  });
});
