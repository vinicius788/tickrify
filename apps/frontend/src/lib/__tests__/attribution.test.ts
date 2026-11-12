import { beforeEach, describe, expect, it } from 'vitest';
import { captureTechnicalAttribution, getAttributionTouches, isPassThroughReferrer } from '@/lib/attribution';

const setReferrer = (value: string) => Object.defineProperty(document, 'referrer', { value, configurable: true });

describe('origem tecnica: volta do login nao e origem', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('login, checkout e o proprio dominio nao contam como origem', () => {
    for (const d of ['accounts.google.com', 'clerk.tickrify.com', 'checkout.stripe.com', 'appleid.apple.com', 'x.clerk.accounts.dev']) {
      expect(isPassThroughReferrer(d)).toBe(true);
    }
    for (const d of ['chatgpt.com', 'google.com', 'notgoogle.com', 'l.instagram.com']) {
      expect(isPassThroughReferrer(d)).toBe(false);
    }
  });

  it('quem entrou direto e voltou do Google fica sem primeiro toque; a origem real seguinte e gravada', () => {
    setReferrer('https://accounts.google.com/');
    captureTechnicalAttribution();
    expect(getAttributionTouches().first).toBeNull();

    setReferrer('https://chatgpt.com/');
    captureTechnicalAttribution();
    expect(getAttributionTouches().first?.referrerDomain).toBe('chatgpt.com');
  });

  it('utm na volta do login continua valendo', () => {
    setReferrer('https://accounts.google.com/');
    window.history.replaceState({}, '', '/dashboard?utm_source=chatgpt.com');
    captureTechnicalAttribution();
    const first = getAttributionTouches().first;
    expect(first?.utmSource).toBe('chatgpt.com');
    expect(first?.referrerDomain).toBeUndefined();
  });
});
