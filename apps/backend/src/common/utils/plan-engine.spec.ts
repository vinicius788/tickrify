import {
  ENGINE_RULES,
  clampValidity,
  closedBars,
  entryLevels,
  fractalSwings,
  isValidWatchPlan,
  limitEntryLevels,
  moveIsLate,
  nearEdge,
  atr14Series,
  reachProbability,
  volatilityRegime,
  pricePosition,
  resolveTp1,
  snapInvalidation,
  stopMarginAtr,
  trackPlan,
  runLimitOrder,
  type WatchPlan,
} from './plan-engine';
import { STOP_MARGIN_P80 } from './engine-calibration';

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
    expect(clampValidity(null)).toBe(ENGINE_RULES.validDefaultCandles);
  });
});

describe('entryLevels e limitEntryLevels', () => {
  it('limit na borda proxima, stop na invalidacao alem de 0,25 ATR, TP1 limitado a 1,5R', () => {
    expect(nearEdge(long)).toBe(99.5);
    expect(nearEdge(short)).toBe(100.5);
    const l = limitEntryLevels(long, 1, 100);
    expect(l).toMatchObject({ entry: 99.5, stopLoss: 98.55, takeProfit2: 103, stopWidened: false });
    if (typeof l === 'string') throw new Error(l);
    expect(l.takeProfit1).toBeCloseTo(100.925);
    expect(l.riskAtr).toBeCloseTo(0.95);
    expect(l.tp1R).toBe(ENGINE_RULES.tp1CapR);
  });

  it('limit so como recuo: preco dentro ou alem da zona nao tem limit', () => {
    expect(limitEntryLevels(long, 1, 99.4)).toBe('not_pullback');
    expect(limitEntryLevels(short, 1, 100.6)).toBe('not_pullback');
  });

  it('target1 dentro do teto fica exato; TP2 antes do TP1 limitado cai', () => {
    expect(entryLevels({ ...long, target1: 100.7, target2: null }, 1, 99.5)).toMatchObject({ takeProfit1: 100.7, takeProfit2: null });
    expect(entryLevels({ ...long, target2: 100.9 }, 1, 99.5)).toMatchObject({ takeProfit2: null });
  });

  it('risco abaixo de 0,5 ATR e alargado ate 0,5 ATR, nunca descartado', () => {
    const narrow = { ...long, zoneLow: 99.3, invalidation: 99.3 };
    expect(entryLevels(narrow, 1, 99.5)).toMatchObject({ entry: 99.5, stopLoss: 99, stopWidened: true, riskAtr: 0.5 });
  });

  it('risco acima de 2,0 ATR, TP1 abaixo de 1,0R ou entrada alem da invalidacao: invalida', () => {
    expect(entryLevels(long, 0.3, 99.5)).toBe('stop_out_of_range');
    expect(entryLevels({ ...long, target1: 100.4 }, 1, 99.5)).toBe('no_room');
    expect(entryLevels(long, 1, 98.7)).toBe('wrong_side');
  });

  it('a mercado: entrada no preco, stop e TP1 pelas mesmas regras; margem calibrada muda o stop', () => {
    const l = entryLevels(long, 1, 99.3);
    expect(l).toMatchObject({ entry: 99.3, stopLoss: 98.55 });
    if (typeof l === 'string') throw new Error(l);
    expect(l.takeProfit1).toBeCloseTo(100.425);
    expect(entryLevels(long, 1, 99.6, 0.4)).toMatchObject({ stopLoss: 98.4 });
  });

  it('venda e o espelho', () => {
    const l = limitEntryLevels(short, 1, 100);
    expect(l).toMatchObject({ entry: 100.5, stopLoss: 101.45 });
    if (typeof l === 'string') throw new Error(l);
    expect(l.takeProfit1).toBeCloseTo(99.075);
  });

  it('sem calibracao do par e do regime, a margem padrao', () => {
    expect(STOP_MARGIN_P80['XAUUSDX:normal']).toBeUndefined();
    expect(stopMarginAtr('XAUUSDX', 'normal')).toBe(ENGINE_RULES.stopMarginAtr);
    expect(stopMarginAtr(null, null)).toBe(ENGINE_RULES.stopMarginAtr);
  });
});

describe('snapInvalidation', () => {
  // Compra com invalidacao do modelo em 98,8 e preco em 100.
  const swings = [{ kind: 'low' as const, price: 99.1 }, { kind: 'low' as const, price: 98.9 }, { kind: 'high' as const, price: 98.85 }, { kind: 'low' as const, price: 98.5 }];

  it('a swing do mesmo lado entre o preco e a invalidacao, a ate 0,5 ATR: a mais proxima da invalidacao', () => {
    expect(snapInvalidation(long, swings, 1, 100)).toMatchObject({ invalidation: 98.9, zoneLow: 99 });
    expect(snapInvalidation(short, [{ kind: 'high', price: 101.1 }, { kind: 'high', price: 101.3 }], 1, 100)).toMatchObject({ invalidation: 101.1, zoneHigh: 101 });
  });

  it('swing alem da invalidacao, do lado errado ou a mais de 0,5 ATR nao serve: null', () => {
    expect(snapInvalidation(long, [{ kind: 'low', price: 98.5 }, { kind: 'high', price: 99 }], 1, 100)).toBeNull();
    expect(snapInvalidation(long, [{ kind: 'low', price: 99.4 }], 1, 100)).toBeNull();
    expect(snapInvalidation(long, [{ kind: 'low', price: 98.9 }], 0.1, 100)).toBeNull();
  });

  it('a swing nao pode passar do preco atual', () => {
    expect(snapInvalidation(long, [{ kind: 'low', price: 99.2 }], 1, 99.1)).toBeNull();
  });

  it('a zona e recortada; com a swing acima da zona ela encolhe ate a swing (a limit deixa de valer)', () => {
    const tight = { ...long, zoneLow: 98.82, invalidation: 98.8 };
    expect(snapInvalidation(tight, [{ kind: 'low', price: 98.85 }], 1, 100)).toMatchObject({ invalidation: 98.85, zoneLow: 98.85, zoneHigh: 99.5 });
    const above = snapInvalidation({ ...long, zoneLow: 98.8, zoneHigh: 98.9 }, [{ kind: 'low', price: 99.2 }], 1, 100);
    expect(above).toMatchObject({ invalidation: 99.2, zoneLow: 99.2, zoneHigh: 99.2 });
    expect(limitEntryLevels(above as WatchPlan, 1, 100)).toBe('wrong_side');
  });
});

describe('fractalSwings e moveIsLate', () => {
  // Escada de alta: fundos e topos subindo, pernas de 2.
  const stairs = (legs: number) => {
    const out: number[][] = [];
    let p = 100;
    for (let k = 0; k < legs; k++) {
      for (const d of [1, 1, 1, -0.5, -0.5, -0.5]) {
        p += d;
        out.push([out.length, p - d, Math.max(p, p - d) + 0.05, Math.min(p, p - d) - 0.05, p]);
      }
    }
    return out;
  };

  it('fractal de 2 velas acha topos e fundos', () => {
    const sw = fractalSwings(stairs(3));
    expect(sw.some((s) => s.kind === 'high')).toBe(true);
    expect(sw.some((s) => s.kind === 'low')).toBe(true);
  });

  it('tres pernas de alta seguidas: atrasado na compra, nao na venda', () => {
    const bars = stairs(4);
    expect(moveIsLate(bars, 1, 'long')).toBe(true);
    expect(moveIsLate(bars, 1, 'short')).toBe(false);
  });

  it('vela de mais de 2 ATR fechando a favor: atrasado (parabolica)', () => {
    const flat = Array.from({ length: 10 }, (_, i) => [i, 100, 100.3, 99.7, 100 + (i % 2 ? 0.1 : -0.1)]);
    expect(moveIsLate([...flat, [10, 100, 102.6, 99.9, 102.5]], 1, 'long')).toBe(true);
    expect(moveIsLate(flat, 1, 'long')).toBe(false);
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

describe('regime de volatilidade e tabela de alcance', () => {
  const flat = (n: number, range: number) => Array.from({ length: n }, (_, i) => [i, 100, 100 + range / 2, 100 - range / 2, 100]);

  it('ATR(14) e a media simples do true range; antes de 14 velas, NaN', () => {
    const atr = atr14Series(flat(20, 2));
    expect(Number.isNaN(atr[12])).toBe(true);
    expect(atr[13]).toBeCloseTo(2);
  });

  it('ATR atual contra a mediana das ultimas 100 velas: low, normal, high', () => {
    expect(volatilityRegime(flat(60, 1))).toBe('normal');
    expect(volatilityRegime([...flat(60, 1), ...flat(14, 3)])).toBe('high');
    expect(volatilityRegime([...flat(60, 2), ...flat(14, 1)])).toBe('low');
    expect(volatilityRegime(flat(20, 1))).toBeNull();
  });

  it('com a calibracao gerada: margem P80 e chance de alcance do par e do regime', () => {
    expect(stopMarginAtr('XAUUSD', 'normal')).toBe(STOP_MARGIN_P80['XAUUSD:normal']);
    const near = reachProbability('BTCUSDT', 'normal', 0.25, 24, 3);
    const far = reachProbability('BTCUSDT', 'normal', 3, 6, 1);
    expect(near).toBeGreaterThan(0.5);
    expect(far).toBeLessThan(near as number);
    expect(reachProbability('BTCUSDT', 'normal', 10, 16, 2)).toBeNull();
  });

  it('sem calibracao do par e do regime: sem probabilidade', () => {
    expect(reachProbability('NAOEXISTE', 'normal', 0.5, 16, 2)).toBeNull();
    expect(reachProbability(null, null, 0.5, 16, 2)).toBeNull();
  });
});

