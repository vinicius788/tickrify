import { describe, expect, it } from 'vitest';
import { buildMonthGrid, dayKey, monthRange, summarizeByDay, weekStartFor } from '@/lib/journal';
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
