import { beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  setPersonProperties: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));

async function freshAnalytics() {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
  return import('@/lib/analytics');
}

describe('analytics', () => {
  beforeEach(() => {
    Object.values(posthog).forEach((fn) => fn.mockClear());
    sessionStorage.clear();
  });

  it('conversao de anuncio NAO vai para o PostHog (cadastro e receita vem do backend)', async () => {
    const a = await freshAnalytics();
    await a.initAnalytics();

    a.trackAdConversion('signup');
    a.trackAdConversion('purchase');

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('conversao de anuncio na fila (antes do aceite) tambem nao chega ao PostHog', async () => {
    const a = await freshAnalytics();
    a.trackAdConversion('signup');
    a.track('landing_viewed');

    await a.initAnalytics();

    expect(posthog.capture.mock.calls.map((c) => c[0])).toEqual(['landing_viewed']);
  });

  it('signup_started sai uma vez por sessao, venha de onde vier', async () => {
    const a = await freshAnalytics();
    await a.initAnalytics();

    a.trackSignupStartedOnce('signup_route');
    a.trackSignupStartedOnce('signup_route'); // sub-rota do Clerk
    a.trackSignupStartedOnce('header');

    const calls = posthog.capture.mock.calls.filter((c) => c[0] === 'signup_started');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ source: 'signup_route' });
  });

  it('origem vira super propriedade (ultimo toque) e perfil (primeiro com set_once)', async () => {
    const a = await freshAnalytics();
    a.setAttributionContext(
      { utmSource: 'instagram', utmCampaign: 'teste120', landingPath: '/?utm_source=instagram' },
      { utmSource: 'chatgpt.com', referrerDomain: 'chatgpt.com' },
    );

    await a.initAnalytics(); // aplicado no init, quando o aceite chega

    expect(posthog.register).toHaveBeenCalledWith({ utm_source: 'chatgpt.com', referrer_domain: 'chatgpt.com' });
    expect(posthog.setPersonProperties).toHaveBeenCalledWith(
      { last_utm_source: 'chatgpt.com', last_referrer_domain: 'chatgpt.com' },
      { first_utm_source: 'instagram', first_utm_campaign: 'teste120', first_landing_path: '/?utm_source=instagram' },
    );
  });
});

describe('Meta pixel: eventID para deduplicar com o servidor', () => {
  it('InitiateCheckout, Purchase e CompleteRegistration saem com o event_id do servidor', async () => {
    const fbq = vi.fn();
    vi.stubGlobal('fbq', fbq);
    (window as unknown as { fbq?: unknown }).fbq = fbq;
    const a = await freshAnalytics();
    await a.initAnalytics();

    a.track('checkout_started', { sessionId: 'cs_live_1' });
    a.trackAdConversion('purchase', { eventId: 'purchase_cs_live_1', value: 18.85, currency: 'usd' });
    a.trackAdConversion('signup', { eventId: 'signup_user_1' });

    expect(fbq).toHaveBeenCalledWith('track', 'InitiateCheckout', {}, { eventID: 'checkout_cs_live_1' });
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', { currency: 'USD', value: 18.85 }, { eventID: 'purchase_cs_live_1' });
    expect(fbq).toHaveBeenCalledWith('track', 'CompleteRegistration', {}, { eventID: 'signup_user_1' });
    // Nenhum Purchase ao iniciar checkout.
    expect(fbq.mock.calls.filter((c) => c[1] === 'Purchase')).toHaveLength(1);
    delete (window as unknown as { fbq?: unknown }).fbq;
    vi.unstubAllGlobals();
  });
});
