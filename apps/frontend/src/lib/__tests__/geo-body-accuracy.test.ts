import { describe, expect, it } from 'vitest';
// @ts-expect-error modulo .mjs do build, sem tipos
import { accuracyBlock, accuracyFaqItems } from '../../../scripts/geo-body.mjs';

// HTML pre-renderizado da /accuracy e a regra do candle do fill (20/10/2026, opcao c).
const interval = (wins: number, losses: number, rate: number | null) => ({
  n: wins + losses, wins, losses, rate, low: rate === null ? null : rate - 10, high: rate === null ? null : rate + 10,
  publishable: rate !== null,
});
const base = {
  updatedAt: '2026-10-21T10:00:00.000Z',
  overall: interval(30, 45, 40),
  byConfidence: [],
  abstention: { wait: 10, total: 100, rate: 10 },
  breakdown: { WIN: 30, LOSS: 45 },
};

describe('geo-body: /accuracy com a regra do candle do fill', () => {
  it('rotula o numero principal como regra original; sem stopOnly nao inventa a serie nova', () => {
    const html: string = accuracyBlock(base);
    expect(html).toContain('Hit rate, original scoring rule');
    expect(html).not.toContain('all resolved analyses');
    expect(html).not.toContain('updated scoring rule');
  });

  it('com stopOnly, a serie nova sai numa linha propria (so o n abaixo do minimo)', () => {
    const html: string = accuracyBlock({ ...base, stopOnly: { overall: interval(1, 2, null), breakdown: {} } });
    expect(html).toContain('Hit rate, updated scoring rule (separate series)');
    expect(html).toContain('Not published yet, too few resolved trades');
    expect(html).toContain('40% (95% CI 30% to 50%)');
  });

  it('o FAQ de metodologia explica que as duas regras nunca sao somadas', () => {
    const faq: Array<{ q: string; a: string }> = accuracyFaqItems(base);
    const method = faq.find((item) => item.q === 'How is that accuracy measured?');
    expect(method?.a).toContain('The headline figures use the original rule');
    expect(method?.a).toContain('never added to the headline figures');
  });
});
