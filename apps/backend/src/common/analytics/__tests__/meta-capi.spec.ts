import { buildMetaPayload, isValidFbc, isValidFbp, sendMetaEvent, sha256 } from '../meta-capi';

describe('meta-capi', () => {
  const originalEnv = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(() => {
    process.env.META_PIXEL_ID = '123';
    process.env.META_CAPI_ACCESS_TOKEN = 'EAAG-secret-token';
    delete process.env.META_CAPI_TEST_EVENT_CODE;
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ events_received: 1 }) });
    (global as any).fetch = fetchMock;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  const base = {
    eventName: 'Purchase' as const,
    eventId: 'purchase_cs_live_1',
    user: { externalId: 'user_clerk', email: ' Ana@Example.com ' },
    ads: { consent: true, fbp: 'fb.1.1789000000000.123456789', fbc: 'fb.1.1789000000000.IwAR0abcdefgh', ip: '203.0.113.9', userAgent: 'UA' },
    customData: { value: 18.85, currency: 'usd' },
  };

  it('monta o evento com event_id, hash de e-mail/id e valor', () => {
    const payload = buildMetaPayload(base) as any;
    expect(payload.event_id).toBe('purchase_cs_live_1');
    expect(payload.action_source).toBe('website');
    expect(payload.user_data.em).toEqual([sha256('ana@example.com')]);
    expect(payload.user_data.external_id).toEqual([sha256('user_clerk')]);
    expect(JSON.stringify(payload)).not.toContain('Ana@Example.com');
    expect(payload.custom_data).toEqual({ value: 18.85, currency: 'USD' });
  });

  it('fbp/fbc fora do formato do Meta nao saem', () => {
    const payload = buildMetaPayload({ ...base, ads: { ...base.ads, fbp: 'lixo', fbc: '<script>' } }) as any;
    expect(payload.user_data.fbp).toBeUndefined();
    expect(payload.user_data.fbc).toBeUndefined();
    expect(isValidFbp('fb.1.1789000000000.123456789')).toBe(true);
    expect(isValidFbc('fb.1.1789000000000.IwAR0abcdefgh')).toBe(true);
  });

  it('sem aceite de cookies nao envia nada', async () => {
    await expect(sendMetaEvent({ ...base, ads: { consent: false } })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem configuracao nao envia nada', async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;
    await expect(sendMetaEvent(base)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token vai no corpo, NUNCA na URL', async () => {
    await expect(sendMetaEvent(base)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/123/events');
    expect(url).not.toContain('EAAG');
    expect(JSON.parse(init.body).access_token).toBe('EAAG-secret-token');
  });

  it('erro do Meta nao lanca (anuncio nunca derruba compra)', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(sendMetaEvent(base)).resolves.toBe(false);
  });
});
