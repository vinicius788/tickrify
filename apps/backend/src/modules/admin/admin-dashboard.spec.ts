import { escapeLike, percentile, readersOf, startOfUtcDay, summarizeAnalyses, type HomeAnalysisRow } from './admin-dashboard';

const row = (over: Partial<HomeAnalysisRow> = {}): HomeAnalysisRow => ({
  createdAt: new Date('2026-11-23T10:00:00Z'),
  status: 'completed',
  signalState: 'ENTER_NOW',
  action: 'buy_now',
  agreement: '3/3',
  strongRead: true,
  readers: [
    { status: 'used', costUsd: 0.01 },
    { status: 'used', costUsd: 0.005 },
    { status: 'failed', costUsd: null },
  ],
  totalMs: 15000,
  ...over,
});

describe('admin-dashboard: contas puras', () => {
  it('percentil por posicao, lista vazia = null', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10, 30, 20], 0.5)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([7], 0.9)).toBe(7);
  });

  it('resume estados, tipos de entrada, concordancia, falhas, tempo e custo', () => {
    const w = summarizeAnalyses([
      row(),
      row({ signalState: 'WATCH', action: 'wait', agreement: '2/3', strongRead: false, readers: [{ status: 'used', costUsd: 0.02 }], totalMs: 20000 }),
      row({ status: 'failed', signalState: null, action: null, agreement: null, strongRead: null, readers: null, totalMs: null }),
    ]);
    expect(w.analyses).toBe(2);
    expect(w.failed).toBe(1);
    expect(w.byState).toEqual({ ENTER_NOW: 1, WATCH: 1 });
    expect(w.byAction).toEqual({ buy_now: 1, wait: 1 });
    expect(w.agreement).toEqual({ '3/3': 1, '2/3': 1 });
    expect(w.strongRead).toBe(1);
    expect(w.readersSeen).toBe(4);
    expect(w.readerFailures).toBe(1);
    expect(w.costUsd).toBeCloseTo(0.035, 6);
    expect(w.costPerAnalysisUsd).toBeCloseTo(0.0175, 6);
    expect(w.totalMsP50).toBe(15000);
    expect(w.totalMsP90).toBe(20000);
  });

  it('sem analise: tudo zerado e nulo, nunca NaN', () => {
    const w = summarizeAnalyses([]);
    expect(w).toMatchObject({ analyses: 0, failed: 0, costUsd: 0, costPerAnalysisUsd: null, totalMsP50: null });
  });

  it('leitores fora do formato viram lista vazia', () => {
    expect(readersOf(null)).toEqual([]);
    expect(readersOf('x')).toEqual([]);
    expect(readersOf([null, 1, { status: 'used' }])).toEqual([{ status: 'used' }]);
  });

  it('escapa % e _ da busca e acha o inicio do dia UTC', () => {
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
    expect(startOfUtcDay(new Date('2026-11-23T23:59:59Z')).toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });
});
