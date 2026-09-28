/**
 * Diario (calendario do mes) — logica pura, sem tela.
 *
 * Arquivo proprio pelo mesmo motivo do `lib/verdict.ts`: separar a conta do
 * desenho deixa a conta testavel. Aqui mora o que decide o NUMERO que o trader
 * ve em cada dia; se isso errar, o calendario mente sobre o resultado dele.
 *
 * Regras fixadas com o dono (24/09/2026):
 * - cada analise conta no dia em que foi FEITA (`createdAt`), no fuso do
 *   navegador do trader, nao no dia em que ele marcou o resultado;
 * - ganho = TP1 ou TP2, perda = Stop; aberta e pendente nao contam em nenhum;
 * - valor so entra na soma se o trade estiver fechado (TP1/TP2/Stop), mesma
 *   regra do My Trades. Dia sem valor registrado mostra "sem valor", nunca 0.
 */
import type { Verdict } from '@/lib/verdict';

/** Inicio do mes e inicio do mes seguinte, meia-noite LOCAL. Intervalo [from, to). */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  return { from: new Date(year, month, 1), to: new Date(year, month + 1, 1) };
}

/** Chave do dia no fuso local (YYYY-MM-DD). `toISOString` usaria UTC e mudaria o dia. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Semana comeca no domingo em ingles e japones, na segunda nos outros idiomas. */
export function weekStartFor(language: string): 0 | 1 {
  return language === 'en' || language === 'ja' ? 0 : 1;
}

/**
 * Grade do mes: `null` nas casas antes do dia 1 e depois do ultimo dia, para
 * completar semanas inteiras de 7 casas.
 */
export function buildMonthGrid(year: number, month: number, weekStartsOn: 0 | 1): Array<Date | null> {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: Array<Date | null> = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface DaySummary<T> {
  count: number;
  wins: number;
  losses: number;
  /** Soma dos valores registrados em trades fechados; null quando nenhum tem valor. */
  pnl: number | null;
  items: T[];
}

export interface MonthTotals {
  count: number;
  wins: number;
  losses: number;
  pnl: number | null;
  activeDays: number;
}

const isClosed = (v: Verdict) => v === 'TP1' || v === 'TP2' || v === 'SL';

export function summarizeByDay<T extends { createdAt: string }>(
  items: T[],
  verdictOf: (item: T) => Verdict,
  pnlOf: (item: T) => number | null,
): { days: Map<string, DaySummary<T>>; totals: MonthTotals } {
  const days = new Map<string, DaySummary<T>>();
  const totals: MonthTotals = { count: 0, wins: 0, losses: 0, pnl: null, activeDays: 0 };

  for (const item of items) {
    const created = new Date(item.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const key = dayKey(created);
    let day = days.get(key);
    if (!day) {
      day = { count: 0, wins: 0, losses: 0, pnl: null, items: [] };
      days.set(key, day);
    }

    const verdict = verdictOf(item);
    day.count += 1;
    day.items.push(item);
    totals.count += 1;
    if (verdict === 'TP1' || verdict === 'TP2') { day.wins += 1; totals.wins += 1; }
    if (verdict === 'SL') { day.losses += 1; totals.losses += 1; }

    const amount = isClosed(verdict) ? pnlOf(item) : null;
    if (amount !== null && Number.isFinite(amount)) {
      day.pnl = (day.pnl ?? 0) + amount;
      totals.pnl = (totals.pnl ?? 0) + amount;
    }
  }

  totals.activeDays = days.size;
  // Arredonda no fim, nao a cada soma: 0.1 + 0.2 nao pode virar 0.30000000000000004 na tela.
  const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  for (const day of days.values()) day.pnl = round(day.pnl);
  totals.pnl = round(totals.pnl);
  return { days, totals };
}
