import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError, createCheckoutSession } from '@/lib/stripe';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createCheckoutSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devolve a URL do checkout quando o backend responde com https', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createCheckoutSession('starter', 'tok', 'monthly', 'usd', 'EARLY35');

    expect(result.url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    const [, init] = fetchMock.mock.calls[0];
    // Sem aceite de cookies: `adsConsent: false` e nenhum fbp/fbc.
    expect(JSON.parse(init.body)).toEqual({
      planType: 'starter', billingCycle: 'monthly', currency: 'usd', coupon: 'EARLY35', adsConsent: false,
    });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('com aceite de cookies manda fbp/fbc validos e descarta cookie fora do formato', async () => {
    localStorage.setItem('tickrify_cookie_consent', 'granted');
    document.cookie = '_fbp=fb.1.1789000000000.123456789';
    document.cookie = '_fbc=lixo-que-derrubaria-o-checkout';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));
    vi.stubGlobal('fetch', fetchMock);

    await createCheckoutSession('starter', 'tok');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.adsConsent).toBe(true);
    expect(body.fbp).toBe('fb.1.1789000000000.123456789');
    expect(body.fbc).toBeUndefined();
    localStorage.removeItem('tickrify_cookie_consent');
    document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = '_fbc=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('manda o codigo da oferta Founding Member so quando existe', async () => {
    // Uma Response nova por chamada: o corpo so pode ser lido uma vez.
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createCheckoutSession('starter', 'tok', 'monthly', 'usd', undefined, 'pricing', 'FND-ABCD2345');
    await createCheckoutSession('starter', 'tok', 'monthly', 'usd', undefined, 'pricing');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).offerCode).toBe('FND-ABCD2345');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('offerCode');
  });

  it('rejeita resposta sem URL em vez de redirecionar para "undefined"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'cs_1', url: null })));

    await expect(createCheckoutSession('starter', 'tok')).rejects.toMatchObject({ code: 'invalid_checkout_url' });
  });

  it('propaga o code do backend (ex.: already_subscribed) no CheckoutError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ code: 'already_subscribed', message: 'You already have an active Tickrify subscription.' }, 409),
      ),
    );

    const error = await createCheckoutSession('starter', 'tok').catch((e) => e);
    expect(error).toBeInstanceOf(CheckoutError);
    expect(error.code).toBe('already_subscribed');
    expect(error.status).toBe(409);
    expect(error.message).toBe('You already have an active Tickrify subscription.');
  });
});
