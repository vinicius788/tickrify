/**
 * Rastreador de resultado (28/10/2026): janela, regua do replay
 * (trackPlan) e o que fica para a volta seguinte.
 */
import { TRACKER_RULES, trackAnalysis } from '../../worker/analysis-tracker';
import type { CandleFetch, StoredCandle, fetchWindow } from '../modules/market/candle-store';

const M = 60_000;
const created = new Date('2026-10-20T10:00:00Z');
const plan = {
  direction: 'long', triggerType: 'zone_reaction', zoneLow: 99, zoneHigh: 99.5, invalidation: 98.8,
  target1: 101.5, target2: 103, validForCandles: 4, trigger: '',
};

function candidate(result: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'an_1', createdAt: created, promptVer: 14,
    result: {
      signalState: 'WATCH', dataMode: 'real_data', watchPlan: plan, engine: { version: '4.0.0' },
      analysis: { symbol: 'BTCUSDT', timeframe: '15m' },
      ...result,
    },
    groundingStats: { interval: '15m', coverage: 'injected', numbers: { atr14: 1 } },
    ...extra,
  };
}

/** Janela fina: toca a zona no 2o minuto e vai ao TP1 logo depois. */
const t0 = created.getTime();
const fine: StoredCandle[] = [
  [t0, 100, 100.2, 99.8, 100, 0],
  [t0 + M, 99.8, 99.9, 99.4, 99.6, 0],
  [t0 + 2 * M, 99.6, 101.5, 99.5, 101.4, 0],
];
const fetchOk = jest.fn(async (): Promise<CandleFetch> => ({ candles: fine, source: 'binance', denied: null })) as unknown as typeof fetchWindow;
const after = t0 + 7 * 24 * 60 * M;

describe('trackAnalysis', () => {
  beforeEach(() => (fetchOk as unknown as jest.Mock).mockClear());

  it('WATCH com ATR real: niveis do plano, toque, fill e TP1, ligado a versao do prompt', async () => {
    const row = await trackAnalysis(candidate({}), after, fetchOk);
    expect(row).toMatchObject({
      analysisId: 'an_1', promptVer: 14, engineVersion: '4.0.0', signalState: 'WATCH', dataMode: 'real_data',
      status: 'tracked', outcome: 'WIN', touched: true, filled: true, fillPrice: 99.5, entry: 99.5, missed: false, candleInterval: '1m',
    });
    expect(row?.touchedAt?.getTime()).toBe(t0 + M);
  });

  it('janela ainda aberta: fica para a volta seguinte, sem buscar velas', async () => {
    expect(await trackAnalysis(candidate({}), t0 + 60 * M, fetchOk)).toBeNull();
    expect(fetchOk).not.toHaveBeenCalled();
  });

  it('forex/metal ganha a folga do fim de semana na janela', async () => {
    const gold = candidate({ analysis: { symbol: 'XAUUSD', timeframe: '15m' } });
    const crypto = (6 + 2) * 15 * M + TRACKER_RULES.resolveMs;
    expect(await trackAnalysis(gold, t0 + crypto + M, fetchOk)).toBeNull();
    expect(await trackAnalysis(gold, t0 + crypto + TRACKER_RULES.fxWeekendMs + M, fetchOk)).toMatchObject({ status: 'tracked' });
  });

  it('cota do Twelve Data recusada: fica para depois; sem velas: skipped', async () => {
    const denied = jest.fn(async (): Promise<CandleFetch> => ({ candles: null, source: null, denied: 'budget' })) as unknown as typeof fetchWindow;
    expect(await trackAnalysis(candidate({}), after, denied)).toBeNull();
    const empty = jest.fn(async (): Promise<CandleFetch> => ({ candles: null, source: null, denied: null })) as unknown as typeof fetchWindow;
    expect(await trackAnalysis(candidate({}), after, empty)).toMatchObject({ status: 'skipped', reason: 'no_candles' });
  });

  it('ARMED usa os niveis gravados; sem plano, sem tempo grafico ou sem fonte: skipped com o motivo', async () => {
    const armed = candidate({ signalState: 'ARMED', analysis: { symbol: 'BTCUSDT', timeframe: '15m', entry: 99.5, stopLoss: 98.5, takeProfit1: 101 } });
    expect(await trackAnalysis(armed, after, fetchOk)).toMatchObject({ entry: 99.5, stopLoss: 98.5, takeProfit1: 101, outcome: 'WIN' });
    expect(await trackAnalysis(candidate({ watchPlan: null }), after, fetchOk)).toMatchObject({ status: 'skipped', reason: 'no_plan' });
    expect(await trackAnalysis(candidate({ analysis: { symbol: 'BTCUSDT', timeframe: '?' } }, { groundingStats: null }), after, fetchOk))
      .toMatchObject({ reason: 'no_timeframe' });
    expect(await trackAnalysis(candidate({ analysis: { symbol: 'NAS100', timeframe: '15m' } }), after, fetchOk)).toMatchObject({ reason: 'no_source' });
  });
});
