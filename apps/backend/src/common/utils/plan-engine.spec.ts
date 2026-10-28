import {
  PLAN_RULES,
  clampValidity,
  closedBars,
  isValidWatchPlan,
  levelsFromPlan,
  nearEdge,
  pricePosition,
  resolveTp1,
  trackPlan,
  runLimitOrder,
  type WatchPlan,
} from './plan-engine';

// Compra na zona 99-99,5, ATR 1: limit em 99,5, stop 98,55. Venda e o espelho em torno de 100.
const long: WatchPlan = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 99, zoneHigh: 99.5, invalidation: 98.8,
  target1: 101.5, target2: 103, validForCandles: 16, trigger: '',
};
const short: WatchPlan = {
  ...long, direction: 'short', zoneLow: 100.5, zoneHigh: 101, invalidation: 101.2, target1: 98.5, target2: 97,
};
const bar = (o: number, h: number, l: number, c: number, t = 0) => [t, o, h, l, c];

describe('isValidWatchPlan', () => {
  it('long e short coerentes passam', () => {
    expect(isValidWatchPlan(long)).toBe(true);
    expect(isValidWatchPlan(short)).toBe(true);
    expect(isValidWatchPlan({ ...long, target2: null })).toBe(true);
  });

  it.each([
    ['zona invertida', { zoneLow: 99.6 }],
    ['invalidacao dentro da zona', { invalidation: 99.2 }],
    ['alvo dentro da zona', { target1: 99.4 }],
    ['TP2 antes do TP1', { target2: 101 }],
    ['nivel zero', { zoneLow: 0 }],
    ['tipo de gatilho desconhecido', { triggerType: 'limit' }],
  ])('%s nao passa', (_n, patch) => {
    expect(isValidWatchPlan({ ...long, ...(patch as Partial<WatchPlan>) })).toBe(false);
  });

  it('null nao passa', () => expect(isValidWatchPlan(null)).toBe(false));
});

describe('clampValidity', () => {
  it('fica entre 6 e 24 velas; ausente vira 16', () => {
    expect(clampValidity(3)).toBe(6);
    expect(clampValidity(40)).toBe(24);
    expect(clampValidity(12)).toBe(12);
    expect(clampValidity(null)).toBe(PLAN_RULES.validDefaultCandles);
  });
});

describe('levelsFromPlan', () => {
  it('limit na borda proxima, stop na invalidacao alem de 0,25 ATR, TP1 limitado a 1,5R', () => {
    expect(nearEdge(long)).toBe(99.5);
    expect(nearEdge(short)).toBe(100.5);
    const l = levelsFromPlan(long, 1);
    expect(l).toMatchObject({ entry: 99.5, stopLoss: 98.55, takeProfit2: 103, stopWidened: false });
    if (typeof l === 'string') throw new Error(l);
    expect(l.takeProfit1).toBeCloseTo(100.925);
    expect(l.riskAtr).toBeCloseTo(0.95);
    expect(l.tp1R).toBe(PLAN_RULES.tp1CapR);
  });

  it('target1 dentro do teto fica exato; TP2 antes do TP1 limitado cai', () => {
    expect(levelsFromPlan({ ...long, target1: 100.7, target2: null }, 1)).toMatchObject({ takeProfit1: 100.7, takeProfit2: null });
    expect(levelsFromPlan({ ...long, target2: 100.9 }, 1)).toMatchObject({ takeProfit2: null });
  });

  it('stop a menos de 0,5 ATR e alargado ate 0,5 ATR, nunca descartado', () => {
    const narrow = { ...long, zoneLow: 99.3, invalidation: 99.3 };
    expect(levelsFromPlan(narrow, 1)).toMatchObject({ entry: 99.5, stopLoss: 99, stopWidened: true, riskAtr: 0.5 });
  });

  it('stop a mais de 2,0 ATR ou TP1 abaixo de 1,0R: sem trade', () => {
    expect(levelsFromPlan(long, 0.3)).toBe('stop_out_of_range');
    expect(levelsFromPlan({ ...long, target1: 100.4 }, 1)).toBe('no_room');
  });

  it('a mercado (ENTER_NOW): entrada no preco, stop e TP1 pelas mesmas regras', () => {
    const l = levelsFromPlan(long, 1, 99.3);
    expect(l).toMatchObject({ entry: 99.3, stopLoss: 98.55 });
    if (typeof l === 'string') throw new Error(l);
    expect(l.takeProfit1).toBeCloseTo(100.425);
  });

  it('venda e o espelho', () => {
    const l = levelsFromPlan(short, 1);
    expect(l).toMatchObject({ entry: 100.5, stopLoss: 101.45 });
    if (typeof l === 'string') throw new Error(l);
    expect(l.takeProfit1).toBeCloseTo(99.075);
  });
});

describe('pricePosition e closedBars', () => {
  it('antes, dentro, alem da zona e alem da invalidacao', () => {
    expect(pricePosition(long, 100)).toBe('before_zone');
    expect(pricePosition(long, 99.2)).toBe('inside_zone');
    expect(pricePosition(long, 98.9)).toBe('beyond_zone');
    expect(pricePosition(long, 98.7)).toBe('invalidated');
    expect(pricePosition(short, 100)).toBe('before_zone');
    expect(pricePosition(short, 101.3)).toBe('invalidated');
  });

  it('closedBars tira a vela que ainda se forma', () => {
    const bars = [[0, 1, 1, 1, 1], [60_000, 1, 1, 1, 1], [120_000, 1, 1, 1, 1]];
    expect(closedBars(bars, 60_000, 150_000)).toHaveLength(2);
    expect(closedBars(bars, 60_000, 180_000)).toHaveLength(3);
  });
});

describe('runLimitOrder e resolveTp1', () => {
  const M = 60_000;
  const tfStep = 15 * M;
  const plan = { ...long, validForCandles: 2 };
  const quiet = (t: number) => bar(100, 100.2, 99.8, 100, t);

  it('executa quando a minima toca a borda; gap abaixo executa na abertura', () => {
    const fine = [quiet(0), bar(99.8, 99.9, 99.4, 99.6, M)];
    expect(runLimitOrder(plan, 99.5, [], tfStep, fine, 0)).toEqual({ kind: 'filled', fill: { index: 1, price: 99.5 } });
    const gap = [quiet(0), bar(99.3, 99.4, 99.2, 99.3, M)];
    expect(runLimitOrder(plan, 99.5, [], tfStep, gap, 0)).toEqual({ kind: 'filled', fill: { index: 1, price: 99.3 } });
  });

  it('expira depois de validForCandles velas do tempo grafico', () => {
    const fine = [quiet(0), quiet(29 * M), bar(99.6, 99.7, 99.4, 99.5, 30 * M)];
    expect(runLimitOrder(plan, 99.5, [], tfStep, fine, 0)).toEqual({ kind: 'expired' });
  });

  it('fechamento do tempo grafico alem da invalidacao cancela a partir do fechamento', () => {
    const tf = [bar(100, 100.2, 98.6, 98.7, 0)];
    const fine = [quiet(0), bar(99.8, 99.9, 99.4, 99.6, 20 * M)];
    expect(runLimitOrder(plan, 99.5, tf, tfStep, fine, 0)).toEqual({ kind: 'invalidated' });
    expect(runLimitOrder(plan, 99.5, tf, tfStep, [bar(99.8, 99.9, 99.4, 99.6, M)], 0)).toMatchObject({ kind: 'filled' });
  });

  it('target1 tocado antes do fill cancela; na mesma vela conta como fill', () => {
    const away = [bar(100, 101.6, 99.9, 101, 0), bar(100.5, 100.6, 99.4, 99.6, M)];
    expect(runLimitOrder(plan, 99.5, [], tfStep, away, 0)).toEqual({ kind: 'target_before_fill' });
    expect(runLimitOrder(plan, 99.5, [], tfStep, [bar(100, 101.6, 99.4, 101, 0)], 0)).toMatchObject({ kind: 'filled' });
  });

  it('venda: executa quando a maxima toca a borda de baixo', () => {
    const fine = [bar(100, 100.2, 99.8, 100, 0), bar(100.2, 100.6, 100.1, 100.4, M)];
    expect(runLimitOrder({ ...short, validForCandles: 2 }, 100.5, [], tfStep, fine, 0)).toEqual({ kind: 'filled', fill: { index: 1, price: 100.5 } });
  });

  it('WIN, LOSS, TIMEOUT e TP1 com stop na mesma vela = stop', () => {
    const fill = { index: 0, price: 100 };
    const t = (i: number) => i * 60_000;
    const win = [bar(100, 100.1, 99.9, 100, t(0)), bar(100, 101.6, 99.9, 101.5, t(1))];
    expect(resolveTp1(win, true, fill, 99, 101.5, Infinity)).toMatchObject({ outcome: 'WIN', index: 1, sameCandle: false });
    const both = [bar(100, 100.1, 99.9, 100, t(0)), bar(100, 101.6, 98.9, 99, t(1))];
    expect(resolveTp1(both, true, fill, 99, 101.5, Infinity)).toMatchObject({ outcome: 'LOSS', sameCandle: true });
    const flat = [bar(100, 100.1, 99.9, 100, t(0)), bar(100, 100.2, 99.8, 100, t(1))];
    expect(resolveTp1(flat, true, fill, 99, 101.5, Infinity)).toMatchObject({ outcome: 'TIMEOUT' });
    expect(resolveTp1(win, true, fill, 99, 101.5, t(1))).toMatchObject({ outcome: 'TIMEOUT' });
  });

  it('na vela da execucao so o stop conta; MFE e MAE em R', () => {
    const fill = { index: 0, price: 100 };
    const r = resolveTp1([bar(100, 101.6, 99.9, 101, 0), bar(101, 101.2, 98.9, 99, 1)], true, fill, 99, 101.5, Infinity);
    expect(r).toMatchObject({ outcome: 'LOSS' });
    expect(r.mfeR).toBeCloseTo(1.6);
    expect(r.maeR).toBeCloseTo(1.1);
  });
});


describe('trackPlan: a regua compartilhada do replay e do rastreador', () => {
  const M = 60_000;
  const tfStep = 15 * M;
  const plan = { ...long, validForCandles: 4 };
  const quiet = (t: number) => bar(100, 100.2, 99.8, 100, t);
  const base = { plan, enterNow: false, atr: 1, tf: [] as number[][], tfStepMs: tfStep, startMs: 0, resolveMs: 48 * 60 * M };

  it('toque, fill na borda, WIN no TP1 com MFE e MAE em R', () => {
    const fine = [quiet(0), bar(99.8, 99.9, 99.4, 99.6, M), bar(99.6, 101, 99.5, 100.9, 2 * M)];
    const t = trackPlan({ ...base, fine });
    expect(t).toMatchObject({ outcome: 'WIN', touchIndex: 1, order: 'filled', fill: { index: 1, price: 99.5 } });
    expect(t.levels).toMatchObject({ entry: 99.5, stopLoss: 98.55 });
    expect(t.resolution?.mfeR).toBeGreaterThanOrEqual(1);
  });

  it('missed: o alvo veio antes do preco voltar a zona', () => {
    const fine = [quiet(0), bar(100, 101.6, 99.9, 101.5, M)];
    expect(trackPlan({ ...base, fine })).toMatchObject({ outcome: 'MISSED', touchIndex: null, fill: null });
  });

  it('ENTER_NOW: a mercado na abertura da primeira vela; niveis gravados mandam', () => {
    const fine = [bar(99.3, 99.4, 98.4, 98.5, 0)];
    const t = trackPlan({ ...base, enterNow: true, levels: { entry: 99.3, stopLoss: 98.6, takeProfit1: 100.4 }, fine });
    expect(t).toMatchObject({ order: 'market', fill: { index: 0, price: 99.3 }, outcome: 'LOSS' });
  });

  it('sem ATR e sem niveis: NO_LEVELS; sem velas depois: NO_CANDLES', () => {
    expect(trackPlan({ ...base, atr: null, fine: [quiet(0)] })).toMatchObject({ outcome: 'NO_LEVELS' });
    expect(trackPlan({ ...base, fine: [quiet(-M)] })).toMatchObject({ outcome: 'NO_CANDLES' });
    expect(trackPlan({ ...base, atr: 0.3, fine: [quiet(0)] })).toMatchObject({ outcome: 'NO_LEVELS', rejection: 'stop_out_of_range' });
  });
});
