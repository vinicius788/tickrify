import { isTradeSignal, loadWatchContexts, loadWatchNext, loadWatchOrigins, watchJourneyOf, storedWatchPlan, watchAfterReachOf, watchOutcomeOf, watchSummaryOf, watchTargetROf } from './watch-pending';

const plan = { direction: 'short', triggerType: 'zone_reaction', zoneLow: 77800, zoneHigh: 78000, invalidation: 78400,
  target1: 76900, target2: null, validForCandles: 12, trigger: 'Bearish close below 77,800' };
const watchResult = (over: Record<string, unknown> = {}) => ({
  signalState: 'WATCH', watchPlan: plan, analysis: { symbol: 'BTCUSDT', timeframe: '15m' }, ...over,
});
const created = new Date('2026-11-03T12:00:00Z');

describe('watchAfterReachOf: aonde o preco foi depois de tocar o nivel', () => {
  const track = (outcome: string, touched = true) => ({ status: 'tracked', outcome, touched });
  it('alvo, invalidacao ou nenhum dos dois', () => {
    expect(watchAfterReachOf(track('WIN'))).toBe('target');
    expect(watchAfterReachOf(track('LOSS'))).toBe('invalidation');
    expect(watchAfterReachOf(track('TIMEOUT'))).toBe('neither');
  });
  it('sem toque, sem medicao ou encerrado antes do nivel: nada a dizer', () => {
    expect(watchAfterReachOf(null)).toBeNull();
    expect(watchAfterReachOf(track('WIN', false))).toBeNull();
    expect(watchAfterReachOf(track('INVALIDATED'))).toBeNull();
    expect(watchAfterReachOf(track('MISSED'))).toBeNull();
    expect(watchAfterReachOf({ status: 'skipped', outcome: null, touched: false })).toBeNull();
  });
});

describe('watchOutcomeOf (so leitura do AnalysisTrack)', () => {
  it('sem linha no rastreador: pending', () => {
    expect(watchOutcomeOf(null)).toBe('pending');
    expect(watchOutcomeOf(undefined)).toBe('pending');
  });
  it('tocou o nivel na validade: reached, qualquer que seja o resto', () => {
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'LOSS', touched: true })).toBe('reached');
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'WIN', touched: true })).toBe('reached');
  });
  it('toque posterior a invalidacao nao reabre a janela', () => {
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'INVALIDATED', touched: true })).toBe('invalidated');
  });
  it('nao tocou: invalidated ou expired', () => {
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'INVALIDATED', touched: false })).toBe('invalidated');
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'EXPIRED', touched: false })).toBe('expired');
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'NO_LEVELS', touched: false })).toBe('expired');
  });
  it('sem velas ou pulada: unavailable', () => {
    expect(watchOutcomeOf({ status: 'skipped', outcome: null, touched: false })).toBe('unavailable');
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'NO_CANDLES', touched: false })).toBe('unavailable');
  });
});

describe('watchTargetROf', () => {
  const base = { status: 'tracked', touched: true, fillPrice: 100, stopLoss: 98, takeProfit1: 105 };
  it('R bruto so quando bateu o alvo', () => {
    expect(watchTargetROf({ ...base, outcome: 'WIN' })).toBe(2.5);
    expect(watchTargetROf({ ...base, outcome: 'LOSS' })).toBeNull();
    expect(watchTargetROf({ ...base, outcome: 'TIMEOUT' })).toBeNull();
  });
  it('sem niveis gravados ou risco zero: sem numero', () => {
    expect(watchTargetROf({ status: 'tracked', touched: true, outcome: 'WIN' })).toBeNull();
    expect(watchTargetROf({ ...base, stopLoss: 100, outcome: 'WIN' })).toBeNull();
    expect(watchTargetROf(null)).toBeNull();
  });
});

describe('watchSummaryOf', () => {
  it('WATCH: nivel = borda proxima, validade x tempo grafico a partir da analise, alerta pela fonte de preco', () => {
    expect(watchSummaryOf(watchResult(), 'WAIT', created, null)).toEqual({
      direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12,
      expiresAt: '2026-11-03T15:00:00.000Z', outcome: 'pending', afterReach: null, targetR: null, alertAvailable: true, setupId: null, plan: null,
    });
    const long = watchSummaryOf(watchResult({ watchPlan: { ...plan, direction: 'long', invalidation: 77500, target1: 79000 } }), 'WAIT', created, null);
    expect(long?.level).toBe(78000);
  });
  it('desfecho do rastreador e tempo grafico desconhecido', () => {
    const s = watchSummaryOf(watchResult({ analysis: { symbol: 'BTCUSDT', timeframe: '?' } }), 'WAIT', created, { track: { status: 'tracked', outcome: 'EXPIRED', touched: true }, groundingInterval: null, setupId: null });
    expect(s).toMatchObject({ expiresAt: null, outcome: 'reached' });
  });
  it('ativo sem fonte de preco: sem alerta', () => {
    expect(watchSummaryOf(watchResult({ analysis: { symbol: 'Volatility 75 Index', timeframe: '1h' } }), 'WAIT', created, null)?.alertAvailable).toBe(false);
  });
  it('fora do WATCH ou analise antiga sem plano: null', () => {
    expect(watchSummaryOf(watchResult({ signalState: 'NO_TRADE' }), 'WAIT', created, null)).toBeNull();
    expect(watchSummaryOf(watchResult({ signalState: 'ENTER_NOW' }), 'SELL', created, null)).toBeNull();
    expect(watchSummaryOf(watchResult({ watchPlan: null }), 'WAIT', created, null)).toBeNull();
    expect(storedWatchPlan({ signalState: 'WATCH', watchPlan: { ...plan, zoneLow: 79000 } }, 'WAIT')).toBeNull();
  });
});

describe('loadWatchContexts', () => {
  it('le as linhas e nunca derruba a lista se a tabela faltar', async () => {
    const ok = { $queryRaw: jest.fn().mockResolvedValue([{ analysisId: 'a1', status: 'tracked', outcome: 'EXPIRED', touched: false }]) };
    expect((await loadWatchContexts(ok as any, ['a1'])).get('a1')?.track).toEqual({ status: 'tracked', outcome: 'EXPIRED', touched: false });
    const broken = { $queryRaw: jest.fn().mockRejectedValue(new Error('relation does not exist')) };
    expect((await loadWatchContexts(broken as any, ['a1'])).size).toBe(0);
    const none = { $queryRaw: jest.fn() };
    expect((await loadWatchContexts(none as any, [])).size).toBe(0);
    expect(none.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('watchJourneyOf: Watching -> Price reached -> Re-checked -> fim', () => {
  const next = (over: Record<string, unknown> = {}) => ({ analysisId: 'n1', createdAt: created, signalState: 'ENTER_NOW', recommendation: 'BUY', userVerdict: null, ...over });
  it('sem reanalise: o fim vem do rastreador', () => {
    expect(watchJourneyOf({ outcome: 'pending' }, false, null)).toEqual({ priceReached: false, recheck: null, entered: null, end: null });
    expect(watchJourneyOf({ outcome: 'reached' }, false, null)).toMatchObject({ priceReached: true, end: null });
    expect(watchJourneyOf({ outcome: 'invalidated' }, false, null).end).toBe('invalidated');
    expect(watchJourneyOf({ outcome: 'expired' }, false, null).end).toBe('expired');
  });
  it('o alerta disparado ja conta como preco chegou', () => {
    expect(watchJourneyOf({ outcome: 'pending' }, true, null).priceReached).toBe(true);
  });
  it('entrou so com a marcacao do trader na reanalise', () => {
    for (const v of ['open', 'tp1', 'tp2', 'stop']) {
      expect(watchJourneyOf({ outcome: 'reached' }, true, next({ userVerdict: v }))).toMatchObject({ entered: { analysisId: 'n1' }, end: 'entered' });
    }
  });
  it('entrada proposta sem marcacao: decisao pendente', () => {
    expect(watchJourneyOf({ outcome: 'pending' }, true, next())).toMatchObject({ recheck: { analysisId: 'n1' }, entered: null, end: null });
  });
  it('reanalise sem entrada ou no_fill: pulou', () => {
    expect(watchJourneyOf({ outcome: 'reached' }, true, next({ signalState: 'NO_TRADE', recommendation: 'WAIT' })).end).toBe('skipped');
    expect(watchJourneyOf({ outcome: 'reached' }, true, next({ signalState: 'WATCH', recommendation: 'WAIT' })).end).toBe('skipped');
    expect(watchJourneyOf({ outcome: 'reached' }, true, next({ userVerdict: 'no_fill' })).end).toBe('skipped');
  });
  it('isTradeSignal: estado do copiloto vence; sem estado, BUY/SELL', () => {
    expect(isTradeSignal('ENTER_NOW', 'WAIT')).toBe(true);
    expect(isTradeSignal('WATCH', 'BUY')).toBe(false);
    expect(isTradeSignal(null, 'SELL')).toBe(true);
    expect(isTradeSignal(null, 'WAIT')).toBe(false);
  });
});

describe('loadWatchNext e loadWatchOrigins', () => {
  it('mapeiam pelo id e nunca derrubam a lista', async () => {
    const db = { $queryRaw: jest.fn().mockResolvedValue([{ watchId: 'w1', analysisId: 'n1', createdAt: created, signalState: 'NO_TRADE', recommendation: 'WAIT', userVerdict: null }]) };
    expect((await loadWatchNext(db as any, 'u1', ['w1'])).get('w1')).toMatchObject({ analysisId: 'n1' });
    const origins = { $queryRaw: jest.fn().mockResolvedValue([{ id: 't1', analysisId: 'w1', createdAt: created }]) };
    expect((await loadWatchOrigins(origins as any, 'u1', ['t1'])).get('t1')).toEqual({ analysisId: 'w1', createdAt: created });
    const broken = { $queryRaw: jest.fn().mockRejectedValue(new Error('x')) };
    expect((await loadWatchNext(broken as any, 'u1', ['w1'])).size).toBe(0);
    expect((await loadWatchOrigins(broken as any, 'u1', ['t1'])).size).toBe(0);
    const none = { $queryRaw: jest.fn() };
    await loadWatchNext(none as any, 'u1', []);
    await loadWatchOrigins(none as any, 'u1', []);
    expect(none.$queryRaw).not.toHaveBeenCalled();
  });
});
