import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureReferral,
  claimReferral,
  getReferralCoupon,
  getReferralPayload,
  saveReferralCoupon,
} from '@/lib/attribution';
import { createCheckoutSession } from '@/lib/stripe';

const KEY = 'tickrify_referral_v1';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('afiliados no navegador', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    document.cookie = 'tickrify_ref=; Max-Age=0; Path=/';
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('o vinculo sobrevive ao localStorage apagado (cookie de primeira parte)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ valid: true, clickId: 'ckabcdefghijklmnopqrst' })));
    window.history.replaceState({}, '', '/try?ref=partner1');
    captureReferral('/try');
    await flush();

    localStorage.removeItem(KEY);
    expect(getReferralPayload()).toEqual({
      affiliateCode: 'PARTNER1',
      affiliateKind: 'link',
      affiliateClickId: 'ckabcdefghijklmnopqrst',
    });
  });

  it('?ref= valido grava o clique devolvido pelo servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ valid: true, clickId: 'ckabcdefghijklmnopqrst' }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/?ref=partner1');

    captureReferral('/');
    await flush();

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'PARTNER1', kind: 'link', landingPath: '/' });
    expect(getReferralPayload()).toEqual({
      affiliateCode: 'PARTNER1',
      affiliateKind: 'link',
      affiliateClickId: 'ckabcdefghijklmnopqrst',
    });
  });

  it('codigo invalido no servidor nao grava nada; lixo na URL nem chega a sair', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ valid: false }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/?ref=NOPE99');
    captureReferral('/');
    await flush();
    expect(getReferralPayload()).toEqual({});

    window.history.replaceState({}, '', '/?ref=%3Cscript%3E');
    captureReferral('/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cupom digitado vence um link aberto depois', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    saveReferralCoupon('save10');
    window.history.replaceState({}, '', '/?ref=OTHER1');
    captureReferral('/');
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getReferralCoupon()).toBe('SAVE10');
    expect(getReferralPayload()).toEqual({ affiliateCode: 'SAVE10', affiliateKind: 'coupon' });
  });

  it('clique com mais de 30 dias no navegador nao vai mais para o checkout', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ code: 'PARTNER1', kind: 'link', clickId: 'ckabcdefghijklmnopqrst', at: Date.now() - 31 * 86_400_000 }),
    );
    expect(getReferralPayload()).toEqual({});
  });

  it('checkout manda so a identificacao do afiliado, nunca desconto', async () => {
    saveReferralCoupon('SAVE10');
    const fetchMock = vi.fn().mockResolvedValue(json({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }));
    vi.stubGlobal('fetch', fetchMock);
    await createCheckoutSession('starter', 'tok');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ affiliateCode: 'SAVE10', affiliateKind: 'coupon' });
    expect(Object.keys(body).some((k) => /discount|percent|amount/i.test(k))).toBe(false);
  });

  it('vinculo apos login sai uma vez por conta neste navegador', async () => {
    saveReferralCoupon('SAVE10');
    const fetchMock = vi.fn().mockResolvedValue(json({ attributed: true }));
    vi.stubGlobal('fetch', fetchMock);
    await claimReferral('clerk_1', 'tok');
    await claimReferral('clerk_1', 'tok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
});
