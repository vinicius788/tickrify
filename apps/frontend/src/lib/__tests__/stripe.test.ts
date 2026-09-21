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
    expect(JSON.parse(init.body)).toEqual({ planType: 'starter', billingCycle: 'monthly', currency: 'usd', coupon: 'EARLY35' });
    expect(init.headers.Authorization).toBe('Bearer tok');
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
