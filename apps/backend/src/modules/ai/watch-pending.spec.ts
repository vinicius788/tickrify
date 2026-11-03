import { loadWatchTracks, storedWatchPlan, watchOutcomeOf, watchSummaryOf } from './watch-pending';

const plan = { direction: 'short', triggerType: 'zone_reaction', zoneLow: 77800, zoneHigh: 78000, invalidation: 78400,
  target1: 76900, target2: null, validForCandles: 12, trigger: 'Bearish close below 77,800' };
const watchResult = (over: Record<string, unknown> = {}) => ({
  signalState: 'WATCH', watchPlan: plan, analysis: { symbol: 'BTCUSDT', timeframe: '15m' }, ...over,
});
const created = new Date('2026-11-03T12:00:00Z');

describe('watchOutcomeOf (so leitura do AnalysisTrack)', () => {
  it('sem linha no rastreador: pending', () => {
    expect(watchOutcomeOf(null)).toBe('pending');
    expect(watchOutcomeOf(undefined)).toBe('pending');
  });
  it('tocou o nivel na validade: reached, qualquer que seja o resto', () => {
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'LOSS', touched: true })).toBe('reached');
    expect(watchOutcomeOf({ status: 'tracked', outcome: 'WIN', touched: true })).toBe('reached');
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

describe('watchSummaryOf', () => {
  it('WATCH: nivel = borda proxima, validade x tempo grafico a partir da analise, alerta pela fonte de preco', () => {
    expect(watchSummaryOf(watchResult(), 'WAIT', created, null)).toEqual({
      direction: 'short', level: 77800, invalidation: 78400, validForCandles: 12,
      expiresAt: '2026-11-03T15:00:00.000Z', outcome: 'pending', alertAvailable: true,
    });
    const long = watchSummaryOf(watchResult({ watchPlan: { ...plan, direction: 'long', invalidation: 77500, target1: 79000 } }), 'WAIT', created, null);
    expect(long?.level).toBe(78000);
  });
  it('desfecho do rastreador e tempo grafico desconhecido', () => {
    const s = watchSummaryOf(watchResult({ analysis: { symbol: 'BTCUSDT', timeframe: '?' } }), 'WAIT', created, { status: 'tracked', outcome: 'EXPIRED', touched: true });
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

describe('loadWatchTracks', () => {
  it('le as linhas e nunca derruba a lista se a tabela faltar', async () => {
    const ok = { $queryRaw: jest.fn().mockResolvedValue([{ analysisId: 'a1', status: 'tracked', outcome: 'EXPIRED', touched: false }]) };
    expect((await loadWatchTracks(ok as any, ['a1'])).get('a1')).toEqual({ status: 'tracked', outcome: 'EXPIRED', touched: false });
    const broken = { $queryRaw: jest.fn().mockRejectedValue(new Error('relation does not exist')) };
    expect((await loadWatchTracks(broken as any, ['a1'])).size).toBe(0);
    const none = { $queryRaw: jest.fn() };
    expect((await loadWatchTracks(none as any, [])).size).toBe(0);
    expect(none.$queryRaw).not.toHaveBeenCalled();
  });
});
