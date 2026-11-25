import { againstTrend, breakoutEntry, candleBias, chooseEntry, collectReaders, isStrongBias, majorityOf, nowEntry, pullbackEntry, pickDisplayReader,
  resolveVote, timeframeLadder, watchPlanOf, type CandleBias, type CandleView, type ReaderVote } from './entry-engine';
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

describe('regra de 25/11/2026 (filter-2026-11-25): leitor com NO_TRADE limita a WATCH', () => {
  const vote = (state: string, direction: 'long' | 'short' | null): ReaderVote => ({ raw: { state, direction }, outcome: { state, direction: direction ?? 'neutral' } });
  const strongLong = candleBias({ ...up, rangePosPct: 50, late: null, htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: 'above' });

  it('caso XAUUSD cmww3tjdx (espelhado): NO_TRADE + ENTER_NOW + WATCH com vies forte nao libera o agora', () => {
    expect(isStrongBias(strongLong)).toBe(true);
    const r = resolveVote([vote('NO_TRADE', null), vote('ENTER_NOW', 'long'), vote('WATCH', 'long')], strongLong);
    expect(r).toMatchObject({ decidedBy: 'candle_bias', allowNow: false, capWatch: true });
  });

  it('maioria de ENTER_NOW com um NO_TRADE tambem fica no maximo WATCH; sem NO_TRADE nada muda', () => {
    expect(resolveVote([vote('ENTER_NOW', 'long'), vote('ENTER_NOW', 'long'), vote('NO_TRADE', null)], strongLong))
      .toMatchObject({ decidedBy: 'majority', chosen: 0, allowNow: false, capWatch: true });
    const clean = resolveVote([vote('ENTER_NOW', 'long'), vote('WATCH', 'short')], strongLong);
    expect(clean).toMatchObject({ decidedBy: 'candle_bias', allowNow: true });
    expect(clean.capWatch).toBeUndefined();
    expect(resolveVote([vote('NO_TRADE', null)], strongLong)).toMatchObject({ decidedBy: 'single', capWatch: true, allowNow: false });
  });
});

describe('leitor de exibicao (25/11/2026)', () => {
  const r = (label: string, state: string, direction: 'long' | 'short' | null) => ({ label, raw: { state, direction } });
  const xau = [r('openai-1', 'NO_TRADE', null), r('openai-2', 'ENTER_NOW', 'short'), r('anthropic-1', 'WATCH', 'short')];

  it('caso XAUUSD: decisao ENTER_NOW venda mostra o leitor que pediu ENTER_NOW venda, nunca o do NO_TRADE', () => {
    expect(pickDisplayReader(xau, { state: 'ENTER_NOW', direction: 'short' })).toBe('openai-2');
    expect(pickDisplayReader(xau, { state: 'WATCH', direction: 'short' })).toBe('anthropic-1');
    expect(pickDisplayReader(xau, { state: 'NO_TRADE', direction: 'neutral' })).toBe('openai-1');
  });

  it('sem o mesmo estado vale a mesma direcao (empate, o primeiro); nenhum bate = null', () => {
    expect(pickDisplayReader([r('a', 'WATCH', 'short'), r('b', 'ENTER_NOW', 'short')], { state: 'NO_TRADE', direction: 'neutral' })).toBeNull();
    expect(pickDisplayReader([r('a', 'NO_TRADE', null), r('b', 'ENTER_NOW', 'short'), r('c', 'ENTER_NOW', 'short')], { state: 'WATCH', direction: 'short' })).toBe('b');
    expect(pickDisplayReader([r('a', 'WATCH', 'long'), r('b', 'NO_TRADE', null)], { state: 'WATCH', direction: 'short' })).toBeNull();
  });
});

describe('regras de 23/11/2026 (filter-2026-11-23)', () => {
  it('escada de tempos: direcao e setup pelo tempo do print', () => {
    expect(timeframeLadder('1m')).toEqual({ chart: '1m', direction: '15m', setup: '5m' });
    expect(timeframeLadder('5m')).toEqual({ chart: '5m', direction: '1h', setup: '15m' });
    expect(timeframeLadder('15m')?.direction).toBe('4h');
    expect(timeframeLadder('30m')?.direction).toBe('4h');
    expect(timeframeLadder('1h')?.direction).toBe('1d');
    expect(timeframeLadder('4h')?.direction).toBe('1w');
    expect(timeframeLadder('1w')).toBeNull();
    expect(timeframeLadder(null)).toBeNull();
  });

  it('vies forte = pontuacao 2+ com a tendencia do tempo de direcao na mesma direcao', () => {
    expect(isStrongBias({ direction: 'short', score: -2, htfTrend: 'downtrend' })).toBe(true);
    expect(isStrongBias({ direction: 'short', score: -2, htfTrend: 'range' })).toBe(false);
    expect(isStrongBias({ direction: 'long', score: 1.5, htfTrend: 'uptrend' })).toBe(false);
    expect(isStrongBias({ direction: 'neutral', score: 0, htfTrend: 'uptrend' })).toBe(false);
  });

  it('filtro de tendencia: tempo de direcao em tendencia e preco do mesmo lado da EMA50 barra a entrada contra', () => {
    expect(againstTrend({ htfTrend: 'uptrend', vsEma50: 'above' }, 'short')).toBe(true);
    expect(againstTrend({ htfTrend: 'uptrend', vsEma50: 'below' }, 'short')).toBe(false);
    expect(againstTrend({ htfTrend: 'downtrend', vsEma50: 'below' }, 'long')).toBe(true);
    expect(againstTrend({ htfTrend: 'downtrend', vsEma50: 'below' }, 'short')).toBe(false);
    expect(againstTrend({ htfTrend: 'range', vsEma50: 'above' }, 'short')).toBe(false);
  });

  const vote = (state: string, direction: 'long' | 'short' | null, outDir: 'long' | 'short' | 'neutral' = direction ?? 'neutral'): ReaderVote =>
    ({ raw: { state, direction }, outcome: { state, direction: outDir } });
  // Vies pelo tempo de direcao da escada. Tendencia do 1h calculada por summarizeHigherTimeframe sobre
  // velas publicas de 1h (PAXGUSDT para o ouro, BTCUSDT) fechadas antes de cada analise.
  const biasAt = (view: Partial<CandleView>): CandleBias => candleBias({ ...up, rangePosPct: 50, late: null, ...view });

  it('ouro 5M 23/11 12:55 (cmwt9rc4j): ENTER_NOW long x WATCH short, 1h em alta: nunca venda', () => {
    // estrutura do 5M mista (sem swings), preco abaixo da EMA50 do 5M; 1h uptrend acima da EMA50
    const bias = biasAt({ swings: [], htfTrend: 'uptrend', vsEma50: 'below', htfVsEma50: 'above' });
    expect(bias.direction).toBe('long');
    expect(isStrongBias(bias)).toBe(false);
    const r = resolveVote([vote('ENTER_NOW', 'long'), vote('WATCH', 'short')], bias);
    expect(r).toMatchObject({ decidedBy: 'no_majority', noMajority: true });
    // com o vies gravado do 4h (score -2, downtrend) a venda saia; a mesma divergencia agora so desempata com vies forte
    const old4h = biasAt({ swings: [], htfTrend: 'downtrend', vsEma50: 'below', htfVsEma50: 'below' });
    const r4h = resolveVote([vote('ENTER_NOW', 'long'), vote('WATCH', 'short')], old4h);
    expect(r4h).toMatchObject({ decidedBy: 'candle_bias', allowNow: false });
  });

  it('ouro 5M 23/11 13:02 (cmwta01tf): ENTER_NOW short x WATCH short sem maioria, 1h em range: aguardar', () => {
    const bias = biasAt({ swings: [], htfTrend: 'range', vsEma50: 'above', htfVsEma50: 'above' });
    expect(isStrongBias(bias)).toBe(false);
    expect(resolveVote([vote('ENTER_NOW', 'short'), vote('WATCH', 'short')], bias)).toMatchObject({ decidedBy: 'no_majority' });
  });

  it('BTC 5M 23/11 13:07 (cmwta5ys9): WATCH long x NO_TRADE: nunca ENTER_NOW', () => {
    const stored = biasAt({
      swings: [{ kind: 'high', price: 110 }, { kind: 'low', price: 104 }, { kind: 'high', price: 108 }, { kind: 'low', price: 102 }],
      htfTrend: 'uptrend', vsEma50: 'below', htfVsEma50: 'above',
    });
    expect(isStrongBias(stored)).toBe(false);
    const r = resolveVote([vote('WATCH', 'long'), vote('NO_TRADE', null)], stored);
    expect(r.decidedBy).toBe('no_majority');
    expect(r.allowNow).toBeFalsy();
  });

  it('maioria vale; desempate forte so libera o agora com 1 leitor que pediu ENTER_NOW na direcao; leitor unico precisa do vies forte', () => {
    const strongLong = biasAt({ htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: 'above' });
    expect(isStrongBias(strongLong)).toBe(true);
    expect(resolveVote([vote('WATCH', 'long'), vote('WATCH', 'long'), vote('NO_TRADE', null)], strongLong)).toMatchObject({ decidedBy: 'majority', chosen: 0 });
    expect(resolveVote([vote('ENTER_NOW', 'long'), vote('WATCH', 'short')], strongLong)).toMatchObject({ decidedBy: 'candle_bias', chosen: 0, allowNow: true });
    expect(resolveVote([vote('WATCH', 'short'), vote('WATCH', 'long', 'neutral')], strongLong)).toMatchObject({ decidedBy: 'candle_bias', chosen: 1, allowNow: false });
    expect(resolveVote([vote('ENTER_NOW', 'long')], strongLong)).toMatchObject({ decidedBy: 'single', allowNow: true });
    expect(resolveVote([vote('ENTER_NOW', 'short')], strongLong)).toMatchObject({ decidedBy: 'single', allowNow: false });
    expect(resolveVote([vote('ENTER_NOW', 'long')], null)).toEqual({ decidedBy: 'single', chosen: 0 });
  });
});
