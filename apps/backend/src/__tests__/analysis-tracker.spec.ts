/**
 * Rastreador de resultado (28/10/2026): janela, regua do replay
 * (trackPlan) e o que fica para a volta seguinte.
 */
import { TRACKER_RULES, TRACKER_SQL, startAnalysisTracker, trackAnalysis } from '../../worker/analysis-tracker';
import type { CandleFetch, StoredCandle, fetchWindow } from '../modules/market/candle-store';
import { ENGINE_RULES, stopMarginAtr } from '../common/utils/plan-engine';
import { STOP_MARGIN_P80 } from '../common/utils/engine-calibration';
import { calibrationPair } from '../common/utils/signal-decision';

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
    // Revisao mensal: lado, ATR e a referencia de direcao (a mercado, 1 ATR).
    expect(row).toMatchObject({ direction: 'long', atr: 1, refOutcome: 'WIN', refFillPrice: 100 });
  });

  it('NO_TRADE tambem ganha linha (skipped) com o estado e a versao do motor', async () => {
    const row = await trackAnalysis(candidate({ signalState: 'NO_TRADE', watchPlan: null }), after, fetchOk);
    expect(row).toMatchObject({ status: 'skipped', reason: 'no_plan', signalState: 'NO_TRADE', engineVersion: '4.0.0', direction: null });
    expect(fetchOk).not.toHaveBeenCalled();
  });

  it('usa o intervalo do grounding mesmo com outro timeframe no resultado', async () => {
    const row = await trackAnalysis(candidate({ analysis: { symbol: 'BTCUSDT', timeframe: '1h' } }), after, fetchOk);
    expect(row?.timeframe).toBe('15m');
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

describe('medicao prospectiva A e B', () => {
  const bar = (minute: number, open: number, high: number, low: number, close: number): StoredCandle =>
    [t0 + minute * M, open, high, low, close, 0];
  const touch = bar(14, 99.4, 99.6, 98, 99.3);
  const next = bar(15, 99.3, 102, 99.2, 101);
  const later = bar(16, 101, 102, 100, 101);
  async function measure(tf: StoredCandle[], candles = [touch, next, later]) {
    const fetch: typeof fetchWindow = async (_symbol, interval) =>
      ({ candles: interval === '15m' ? tf : candles, source: 'binance', denied: null });
    const row = await trackAnalysis(candidate({ signalState: 'NO_TRADE' }), after, fetch);
    return row?.confirmation;
  }

  it('entra no fechamento mesmo fora do WATCH; ignora o stop antes dele e aplica stop_only na vela seguinte', async () => {
    const tf = [bar(0, 100, 101, 98, 99.3)];
    const b = await measure(tf, [touch, next]);
    expect(b).toMatchObject({ confirmed: true, entryAt: new Date(t0 + 15*M), entryPrice: 99.3, outcome: 'TIMEOUT',
      firstTouch: { entryPrice: 99.4, outcome: 'LOSS' } });
    expect(b?.rNet).toBeCloseTo(-99.3 * 0.0002 / (99.3 - 98.55));
    expect(await measure(tf)).toMatchObject({ outcome: 'WIN' });
  });

  it('fechamento alem da invalidacao cancela B antes de uma recuperacao', async () => {
    expect(await measure([bar(0, 100, 100, 98, 98.7), bar(15, 98.7, 100, 98.5, 99.4)]))
      .toMatchObject({ confirmed: false, entryAt: null, firstTouch: { outcome: 'LOSS' } });
  });

  it('nao confirma depois da validade, mesmo com toque dentro dela', async () => {
    expect(await measure([bar(0, 100, 100, 98.9, 99), bar(90, 99, 100, 99, 99.4)]))
      .toMatchObject({ confirmed: false, entryAt: null, firstTouch: { outcome: 'LOSS' } });
  });

  it('primeira confirmacao sem geometria fica sem entrada, mesmo com outra vela favoravel', async () => {
    expect(await measure([bar(0, 100, 102, 98, 101), bar(15, 101, 101, 99, 99.3)]))
      .toMatchObject({ confirmed: true, entryAt: null, rNet: null });
  });
});

describe('margem do stop do WATCH = a do validador', () => {
  it('BTCUSDT no regime normal: stop na P80 calibrada (98,483), nao no padrao de 0,25 ATR (98,75)', async () => {
    const watch = { ...plan, zoneLow: 99.2, zoneHigh: 99.5, invalidation: 99 };
    const row = await trackAnalysis(
      candidate({ watchPlan: watch }, { groundingStats: { interval: '15m', coverage: 'injected', numbers: { atr14: 1, volRegime: 'normal' } } }),
      after,
      fetchOk,
    );
    expect(stopMarginAtr(calibrationPair('BTCUSDT'), 'normal')).toBe(STOP_MARGIN_P80['BTCUSDT:normal']);
    expect(row).toMatchObject({ status: 'tracked', entry: 99.5 });
    expect(row?.stopLoss).toBeCloseTo(98.483, 6);
  });

  it('sem regime gravado (analise antiga): o mesmo padrao do validador', async () => {
    const watch = { ...plan, zoneLow: 99.2, zoneHigh: 99.5, invalidation: 99 };
    const row = await trackAnalysis(candidate({ watchPlan: watch }), after, fetchOk);
    expect(row?.stopLoss).toBeCloseTo(99 - ENGINE_RULES.stopMarginAtr, 6);
  });
});

describe('startAnalysisTracker (DDL do boot)', () => {
  afterEach(() => jest.useRealTimers());

  it('DDL com lock_timeout de 5 s; falhou, tenta de novo a cada 10 min e so entao agenda a varredura', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const executed: string[] = [];
    let failures = 2;
    const prisma = {
      $executeRawUnsafe: jest.fn((sql: string) => sql),
      $transaction: jest.fn(async (ops: string[]) => {
        if (failures > 0) { failures--; throw new Error('canceling statement due to lock timeout'); }
        executed.push(...ops);
      }),
      $queryRawUnsafe: jest.fn(async () => []),
    };
    try {
      startAnalysisTracker(prisma as never);
      await jest.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('tentativa 1');
      expect(String(warn.mock.calls[0][0])).toContain('lock timeout');

      // Sem colunas, nada de varredura.
      await jest.advanceTimersByTimeAsync(TRACKER_RULES.ddlRetryMs - 1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toContain('tentativa 2');

      await jest.advanceTimersByTimeAsync(TRACKER_RULES.ddlRetryMs);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Tabela pronta na tentativa 3'));
      expect(executed).toHaveLength(TRACKER_SQL.length * 2);
      TRACKER_SQL.forEach((sql, i) => {
        expect(executed[2 * i]).toBe("SET LOCAL lock_timeout = '5s'");
        expect(executed[2 * i + 1]).toBe(sql);
      });
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(TRACKER_RULES.firstDelayMs);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
