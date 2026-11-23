import { breakoutEntry, candleBias, chooseEntry, collectReaders, majorityOf, nowEntry, pullbackEntry, watchPlanOf, type CandleView } from './entry-engine';
import { isValidWatchPlan } from './plan-engine';

const up: CandleView = {
  price: 108,
  atr: 2,
  swings: [
    { kind: 'low', price: 96 }, { kind: 'high', price: 104 }, { kind: 'low', price: 100 }, { kind: 'low', price: 103.5 },
    { kind: 'high', price: 108 }, { kind: 'low', price: 106 },
  ],
  htfTrend: 'uptrend', htfVsEma50: 'above', vsEma50: 'above', rangePosPct: 60,
  windowHigh: 116, windowLow: 95, late: { long: false, short: false },
};

describe('candleBias', () => {
  it('estrutura, 4h e EMA a favor dao compra', () => {
    expect(candleBias(up)).toMatchObject({ direction: 'long', structure: 'up', score: 3, stretched: false });
  });
  it('estrutura contra nunca vira compra, e conflito fica neutro', () => {
    const v = { ...up, swings: [{ kind: 'high' as const, price: 110 }, { kind: 'low' as const, price: 100 }, { kind: 'high' as const, price: 108 }, { kind: 'low' as const, price: 98 }] };
    expect(candleBias(v).direction).toBe('neutral');
  });
  it('preco no topo da janela conta como esticado na compra', () => {
    expect(candleBias({ ...up, rangePosPct: 90 }).stretched).toBe(true);
  });
});

describe('entradas', () => {
  it('agora: stop atras do primeiro swing a 1 ATR ou mais, alvo no nivel que da 1R', () => {
    const e = nowEntry(up, 'long', false);
    if (typeof e === 'string') throw new Error(e);
    expect(e.invalidation).toBe(106);
    expect(e.stopLoss).toBeLessThan(106);
    expect(e.tp1R).toBeGreaterThanOrEqual(1);
    expect(e.tp1R).toBeLessThanOrEqual(1.5);
  });
  it('esticado nao entra agora', () => {
    expect(nowEntry(up, 'long', true)).toBe('stretched');
  });
  it('recuo vai ao suporte mais proximo que fecha a conta', () => {
    const e = pullbackEntry(up, 'long');
    if (typeof e === 'string') throw new Error(e);
    expect(e.entry).toBeLessThan(up.price);
    expect(e.stopLoss).toBeLessThan(e.entry);
    expect(e.takeProfit1).toBeGreaterThan(e.entry);
  });
  it('rompimento: entrada alem do nivel logo a frente, stop atras da estrutura de hoje', () => {
    const v = { ...up, swings: [...up.swings, { kind: 'high' as const, price: 109 }] };
    const e = breakoutEntry(v, 'long');
    if (typeof e === 'string') throw new Error(e);
    expect(e.level).toBe(109);
    expect(e.entry).toBeGreaterThan(109);
    expect(e.stopLoss).toBeLessThan(up.price);
  });
  it('risco acima de 2 ATR nao fecha', () => {
    const v = { ...up, swings: [{ kind: 'low' as const, price: 90 }, { kind: 'high' as const, price: 120 }], windowLow: 90 };
    expect(nowEntry(v, 'long', false)).toBe('stop_out_of_range');
  });
  it('a melhor entrada vira um plano de WATCH valido', () => {
    const c = chooseEntry({ ...up, rangePosPct: 95 }, 'long', true);
    expect(c.best?.kind).not.toBe('now');
    expect(isValidWatchPlan(watchPlanOf(c.best!, up.atr))).toBe(true);
  });
  it('venda espelha a compra', () => {
    const mirror = (v: number) => 220 - v;
    const down: CandleView = {
      ...up, price: mirror(up.price), htfTrend: 'downtrend', htfVsEma50: 'below', vsEma50: 'below', rangePosPct: 40,
      swings: up.swings.map((s) => ({ kind: s.kind === 'high' ? 'low' : 'high', price: mirror(s.price) })),
      windowHigh: mirror(up.windowLow!), windowLow: mirror(up.windowHigh!),
    };
    expect(candleBias(down).direction).toBe('short');
    const a = nowEntry(up, 'long', false), b = nowEntry(down, 'short', false);
    if (typeof a === 'string' || typeof b === 'string') throw new Error('sem entrada');
    expect(b.tp1R).toBeCloseTo(a.tp1R, 6);
    expect(b.stopLoss).toBeCloseTo(mirror(a.stopLoss), 6);
  });
});

describe('majorityOf', () => {
  it('2 de 3 vencem; 3 diferentes nao tem maioria', () => {
    expect(majorityOf([{ state: 'ENTER_NOW', direction: 'long' }, { state: 'ENTER_NOW', direction: 'long' }, { state: 'NO_TRADE', direction: 'neutral' }])?.count).toBe(2);
    expect(majorityOf([{ state: 'ENTER_NOW', direction: 'long' }, { state: 'WATCH', direction: 'long' }, { state: 'NO_TRADE', direction: 'neutral' }])).toBeNull();
  });
});

describe('collectReaders', () => {
  const later = <T,>(ms: number, v: T) => () => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const fail = (ms: number) => () => new Promise<never>((_, j) => setTimeout(() => j(new Error('x')), ms));
  const out = async (v: string) => ({ state: v, direction: 'long' as const });
  it('os 2 primeiros concordam: sai sem o terceiro', async () => {
    const r = await collectReaders([{ label: 'a', run: later(5, 'E') }, { label: 'b', run: later(10, 'E') }, { label: 'c', run: later(500, 'W') }], out, 1000);
    expect(r.early).toBe(true);
    expect(r.ignored).toEqual(['c']);
  });
  it('discordam: espera o terceiro ate o teto', async () => {
    const r = await collectReaders([{ label: 'a', run: later(5, 'E') }, { label: 'b', run: later(10, 'W') }, { label: 'c', run: later(400, 'W') }], out, 30);
    expect(r.early).toBe(false);
    expect(r.ignored).toEqual(['c']);
  });
  it('leitor que falha nao derruba', async () => {
    const r = await collectReaders([{ label: 'a', run: fail(5) }, { label: 'b', run: later(10, 'E') }, { label: 'c', run: later(15, 'E') }], out, 30);
    expect(r.done.filter((d) => d.ok)).toHaveLength(2);
    expect(r.ignored).toEqual([]);
  });
});
