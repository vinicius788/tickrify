import { describe, expect, it } from 'vitest';
import { detectChargeCurrency, localPricesFrom, type PublicPrices } from '@/hooks/useFoundingOffer';

const prices: PublicPrices = {
  currencies: ['usd', 'eur', 'jpy'],
  plans: {
    weekly: { usd: 7.99, eur: 7.49, jpy: 1200 },
    monthly: { usd: 29, eur: 27, jpy: 4500 },
    yearly: { usd: 290, eur: 270, jpy: 45000 },
  },
} as PublicPrices;

describe('moeda local da vitrine', () => {
  it('fuso decide a moeda; fora das cinco regioes, USD', () => {
    expect(detectChargeCurrency('Europe/Berlin')).toBe('eur');
    expect(detectChargeCurrency('Europe/London')).toBe('gbp');
    expect(detectChargeCurrency('Asia/Tokyo')).toBe('jpy');
    expect(detectChargeCurrency('America/Toronto')).toBe('cad');
    expect(detectChargeCurrency('Australia/Sydney')).toBe('aud');
    expect(detectChargeCurrency('America/Sao_Paulo')).toBe('usd');
    expect(detectChargeCurrency('America/New_York')).toBe('usd');
  });

  it('com o valor cadastrado na Stripe, mostra e cobra na moeda local', () => {
    const local = localPricesFrom(prices, 'en', 'Europe/Paris');
    expect(local.currency).toBe('eur');
    expect(local.amounts.monthly).toBe(27);
    expect(local.params.monthly).toContain('27');
    expect(local.params.monthly).toContain('€');
  });

  it('iene sai sem casas decimais', () => {
    const local = localPricesFrom(prices, 'en', 'Asia/Tokyo');
    expect(local.currency).toBe('jpy');
    expect(local.params.monthly).toMatch(/4,500/);
    expect(local.params.monthly).not.toMatch(/\./);
  });

  it('moeda sem valor na Stripe (ou API fora) cai inteira para USD, nunca mistura', () => {
    const gbp = localPricesFrom(prices, 'en', 'Europe/London');
    expect(gbp.currency).toBe('usd');
    expect(gbp.params).toEqual({ weekly: '$7.99', monthly: '$29', yearly: '$290', perAnalysis: '$0.145' });
    expect(localPricesFrom(null, 'en', 'Europe/Paris').currency).toBe('usd');
  });
});
