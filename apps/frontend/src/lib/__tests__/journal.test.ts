import { describe, expect, it } from 'vitest';
import { buildMonthGrid, computeAiComparison, computeMonthStats, dayKey, monthRange, summarizeByDay, weekStartFor } from '@/lib/journal';
import { outcomeFromVerdict, verdictFromOutcome, type Verdict } from '@/lib/verdict';

type Row = { id: string; createdAt: string; verdict: Verdict; pnl: number | null };
const row = (id: string, createdAt: Date, verdict: Verdict, pnl: number | null = null): Row => ({
  id,
  createdAt: createdAt.toISOString(),
  verdict,
  pnl,
});
const summarize = (rows: Row[]) => summarizeByDay(rows, (r) => r.verdict, (r) => r.pnl);

describe('journal: grade do mes', () => {
  it('setembro/2026 comeca numa terca: 1 casa vazia com semana na segunda, 2 no domingo', () => {
    const monday = buildMonthGrid(2026, 8, 1);
    const sunday = buildMonthGrid(2026, 8, 0);
    expect(monday.slice(0, 2).map((c) => c?.getDate() ?? null)).toEqual([null, 1]);
    expect(sunday.slice(0, 3).map((c) => c?.getDate() ?? null)).toEqual([null, null, 1]);
    for (const grid of [monday, sunday]) {
      expect(grid.length % 7).toBe(0);
      expect(grid.filter(Boolean)).toHaveLength(30);
    }
  });

  it('fevereiro de ano bissexto tem 29 dias', () => {
    expect(buildMonthGrid(2028, 1, 1).filter(Boolean)).toHaveLength(29);
  });

  it('o intervalo vai da meia-noite local do dia 1 ate a do mes seguinte, inclusive na virada do ano', () => {
    const { from, to } = monthRange(2026, 11);
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()]).toEqual([2026, 11, 1, 0]);
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2027, 0, 1]);
  });

  it('semana comeca no domingo em ingles e japones, na segunda no resto', () => {
    expect(['en', 'ja'].map(weekStartFor)).toEqual([0, 0]);
    expect(['pt', 'es', 'fr', 'de'].map(weekStartFor)).toEqual([1, 1, 1, 1]);
  });
});

describe('journal: soma por dia', () => {
  it('usa o dia LOCAL, nao o do UTC', () => {
    // 23:30 local continua no mesmo dia, mesmo que em UTC ja seja o seguinte.
    const late = new Date(2026, 8, 10, 23, 30);
    const { days } = summarize([row('a', late, null)]);
    expect([...days.keys()]).toEqual([dayKey(late)]);
    expect(dayKey(late)).toBe('2026-09-10');
  });

  it('ganho e TP1/TP2, perda e Stop; aberta e pendente contam so como analise', () => {
    const d = new Date(2026, 8, 10, 12);
    const { days, totals } = summarize([
      row('a', d, 'TP1'), row('b', d, 'TP2'), row('c', d, 'SL'), row('d', d, 'OPEN'), row('e', d, null),
    ]);
    expect(days.get('2026-09-10')).toMatchObject({ count: 5, wins: 2, losses: 1 });
    expect(totals).toMatchObject({ count: 5, wins: 2, losses: 1, activeDays: 1 });
  });

  it('soma so valor de trade fechado e nao inventa zero onde nada foi registrado', () => {
    const d1 = new Date(2026, 8, 10, 12);
    const d2 = new Date(2026, 8, 11, 12);
    const { days, totals } = summarize([
      row('a', d1, 'TP1', 120.5),
      row('b', d1, 'SL', -40.25),
      // Valor preso num trade marcado de volta como aberto nao conta.
      row('c', d1, 'OPEN', 999),
      row('d', d2, 'TP2', null),
    ]);
    expect(days.get('2026-09-10')?.pnl).toBe(80.25);
    expect(days.get('2026-09-11')?.pnl).toBeNull();
    expect(totals.pnl).toBe(80.25);
    expect(totals.activeDays).toBe(2);
  });

  it('arredonda a soma em centavos (0.1 + 0.2 nao vira 0.30000000000000004)', () => {
    const d = new Date(2026, 8, 10, 12);
    const { totals } = summarize([row('a', d, 'TP1', 0.1), row('b', d, 'TP1', 0.2)]);
    expect(totals.pnl).toBe(0.3);
  });

  it('mes vazio: tudo zerado e P&L nulo', () => {
    expect(summarize([]).totals).toEqual({ count: 0, wins: 0, losses: 0, pnl: null, activeDays: 0 });
  });

  it('entrada nao atingida conta como analise, mas nao e ganho, perda nem P&L', () => {
    const d = new Date(2026, 8, 10, 12);
    const { totals } = summarize([row('a', d, 'NO_FILL', 50), row('b', d, 'TP1', 20)]);
    expect(totals).toMatchObject({ count: 2, wins: 1, losses: 0, pnl: 20 });
  });
});

describe('verdict: entrada nao atingida', () => {
  it('ida e volta com o valor do backend', () => {
    expect(outcomeFromVerdict('NO_FILL')).toBe('no_fill');
    expect(verdictFromOutcome('no_fill')).toBe('NO_FILL');
  });
});

describe('journal: desempenho do mes', () => {
  type T = { createdAt: string; symbol: string; timeframe: string; side: 'BUY' | 'SELL' | null; v: Verdict; pnl: number | null; rr1: number | null; rr2: number | null };
  const t = (day: number, hour: number, symbol: string, timeframe: string, side: 'BUY' | 'SELL' | null, v: Verdict, pnl: number | null, rr1: number | null = 1.5, rr2: number | null = 3): T => ({
    createdAt: new Date(2026, 9, day, hour).toISOString(), symbol, timeframe, side, v, pnl, rr1, rr2,
  });
  const stats = (rows: T[]) =>
    computeMonthStats(rows, (r) => r.v, (r) => r.pnl, (r) => r.side, (r, v) => (v === 'TP1' ? r.rr1 : r.rr2));

  const rows = [
    t(1, 9, 'XAUUSD', '15M', 'BUY', 'TP1', 300),
    t(1, 14, 'XAUUSD', '15M', 'BUY', 'TP2', 200),
    t(2, 10, 'BTCUSD', '1H', 'SELL', 'SL', -150),
    t(5, 11, 'EURJPY', '5M', 'BUY', 'SL', -100, null),
    t(6, 9, 'XAUUSD', '5M', 'SELL', 'TP1', 400),
    t(6, 12, 'BTCUSD', '1H', null, null, 999),
    t(7, 9, 'BTCUSD', '1H', 'BUY', 'NO_FILL', 50),
    t(7, 10, 'BTCUSD', '1H', 'BUY', 'OPEN', 70),
    t(8, 9, 'XAUUSD', '15M', 'BUY', 'TP1', null),
  ];

  it('so trade fechado conta; R e o planejado (Stop = -1) e trade sem R:R fica fora da media', () => {
    const s = stats(rows);
    expect(s.closed).toBe(6);
    // Stop vale -1 mesmo sem R:R (EURJPY): os 6 fechados entram na media.
    expect(s.rTrades).toBe(6);
    expect(s.avgR).toBe(Math.round(((1.5 + 3 - 1 - 1 + 1.5 + 1.5) / 6) * 100) / 100);
  });

  it('fator de lucro, curva, maior queda, melhor e pior dia saem so dos valores registrados', () => {
    const s = stats(rows);
    expect(s.profitFactor).toBe(Math.round((900 / 250) * 100) / 100);
    // Trade a trade: 300, 500, 350, 250, 650 (o TP1 do dia 8 nao tem valor).
    expect(s.equity.map((p) => p.value)).toEqual([300, 500, 350, 250, 650]);
    expect(s.maxDrawdown).toBe(-250);
    expect(s.bestDay).toEqual({ day: '2026-10-01', pnl: 500 });
    expect(s.worstDay).toEqual({ day: '2026-10-02', pnl: -150 });
  });

  it('recortes por ativo, tempo grafico, direcao e dia da semana', () => {
    const s = stats(rows);
    expect(s.bySymbol[0]).toEqual({ key: 'XAUUSD', closed: 4, wins: 4, pnl: 900 });
    expect(s.bySymbol.find((r) => r.key === 'BTCUSD')).toEqual({ key: 'BTCUSD', closed: 1, wins: 0, pnl: -150 });
    expect(s.byTimeframe.find((r) => r.key === '5M')).toEqual({ key: '5M', closed: 2, wins: 1, pnl: 300 });
    expect(s.bySide).toEqual([
      { key: 'BUY', closed: 4, wins: 3, pnl: 400 },
      { key: 'SELL', closed: 2, wins: 1, pnl: 250 },
    ]);
    // 01/10/2026 e quinta (4); a lista sai em ordem de dia da semana.
    expect(s.byWeekday.map((r) => r.key)).toEqual(['1', '2', '4', '5']);
  });

  it('sem trade fechado: nada inventado', () => {
    const s = stats([t(3, 9, 'XAUUSD', '15M', 'BUY', 'OPEN', 10), t(3, 10, 'XAUUSD', '15M', null, null, null)]);
    expect(s).toMatchObject({ closed: 0, avgR: null, profitFactor: null, maxDrawdown: null, equity: [], bestDay: null, worstDay: null });
  });

  it('sem perda registrada o fator de lucro fica vazio (nao e infinito)', () => {
    expect(stats([t(1, 9, 'XAUUSD', '15M', 'BUY', 'TP1', 100)]).profitFactor).toBeNull();
  });
});

describe('journal: voce x IA (resultado do mercado 48h)', () => {
  type C = { side: 'BUY' | 'SELL' | null; v: Verdict; m: string | null };
  const compare = (rows: C[]) => computeAiComparison(rows, (r) => r.v, (r) => r.side, (r) => r.m);

  it('separa medidos, pendentes, sem decisao e sem medicao; WAIT fica de fora', () => {
    const c = compare([
      { side: 'BUY', v: 'TP1', m: 'WIN' },
      { side: 'SELL', v: 'SL', m: 'LOSS' },
      { side: 'BUY', v: 'TP2', m: 'LOSS' },
      { side: 'BUY', v: 'SL', m: 'WIN' },
      { side: 'BUY', v: null, m: 'WIN' },
      { side: 'SELL', v: null, m: 'LOSS' },
      { side: 'BUY', v: 'OPEN', m: 'WIN' },
      { side: 'BUY', v: null, m: 'TIMEOUT' },
      { side: 'SELL', v: null, m: 'NO_FILL' },
      { side: 'BUY', v: null, m: null },
      { side: 'BUY', v: null, m: 'UNTRACKABLE' },
      { side: null, v: null, m: 'ABSTAIN' },
    ]);
    expect(c).toEqual({
      plans: 11, measured: 7, marketWins: 4, pending: 1, undecided: 2, unmeasured: 1,
      both: 4, agree: 2, beatPlan: 1, missedPlan: 1, untaken: 2, untakenWins: 1,
    });
  });

  it('sem planos, tudo zero', () => {
    expect(compare([{ side: null, v: null, m: 'ABSTAIN' }]).plans).toBe(0);
  });
});
