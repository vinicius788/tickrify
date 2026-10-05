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

/**
 * Desempenho do mes (05/10/2026): curva de resultado, R medio, fator de lucro,
 * maior queda, melhor e pior dia e recortes por ativo, tempo grafico, direcao
 * e dia da semana. So com o que o Diario ja recebe; nada aqui vai ao servidor.
 *
 * Mesmas regras do calendario: trade fechado = TP1, TP2 ou Stop; valor so de
 * trade fechado; tudo pelo dia em que a analise foi FEITA. R e o PLANEJADO
 * pela leitura: TP1 vale o R:R do TP1, TP2 o do TP2, Stop vale -1. Trade sem
 * R:R conhecido fica fora do R medio (o `rTrades` diz quantos entraram).
 */
export interface GroupRow {
  key: string;
  closed: number;
  wins: number;
  /** null quando nenhum trade fechado do grupo tem valor registrado. */
  pnl: number | null;
}

export interface MonthStats {
  closed: number;
  avgR: number | null;
  rTrades: number;
  /** Ganho bruto / perda bruta registrados. null sem perda registrada (nao ha divisor). */
  profitFactor: number | null;
  /** Maior queda da curva, do pico ao fundo (<= 0). null sem curva. */
  maxDrawdown: number | null;
  /** P&L acumulado trade a trade (fechados com valor), em ordem de criacao. */
  equity: Array<{ at: string; value: number }>;
  bestDay: { day: string; pnl: number } | null;
  worstDay: { day: string; pnl: number } | null;
  bySymbol: GroupRow[];
  byTimeframe: GroupRow[];
  bySide: GroupRow[];
  /** Chave = dia da semana local (0 = domingo). */
  byWeekday: GroupRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeMonthStats<T extends { createdAt: string; symbol?: string | null; timeframe?: string | null }>(
  items: T[],
  verdictOf: (item: T) => Verdict,
  pnlOf: (item: T) => number | null,
  sideOf: (item: T) => 'BUY' | 'SELL' | null,
  rrOf: (item: T, verdict: 'TP1' | 'TP2') => number | null,
): MonthStats {
  const groups = {
    bySymbol: new Map<string, GroupRow>(),
    byTimeframe: new Map<string, GroupRow>(),
    bySide: new Map<string, GroupRow>(),
    byWeekday: new Map<string, GroupRow>(),
  };
  const dayPnl = new Map<string, number>();
  const trades: Array<{ at: number; iso: string; amount: number }> = [];
  let closed = 0;
  let rSum = 0;
  let rTrades = 0;
  let gross = 0;
  let loss = 0;

  const add = (map: Map<string, GroupRow>, key: string, win: boolean, amount: number | null) => {
    const row = map.get(key) ?? { key, closed: 0, wins: 0, pnl: null };
    row.closed += 1;
    if (win) row.wins += 1;
    if (amount !== null) row.pnl = (row.pnl ?? 0) + amount;
    map.set(key, row);
  };

  for (const item of items) {
    const verdict = verdictOf(item);
    if (verdict !== 'TP1' && verdict !== 'TP2' && verdict !== 'SL') continue;
    const created = new Date(item.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    closed += 1;
    const win = verdict !== 'SL';

    const r = verdict === 'SL' ? -1 : rrOf(item, verdict);
    if (r !== null && Number.isFinite(r)) {
      rSum += r;
      rTrades += 1;
    }

    const raw = pnlOf(item);
    const amount = raw !== null && Number.isFinite(raw) ? raw : null;
    if (amount !== null) {
      const key = dayKey(created);
      dayPnl.set(key, (dayPnl.get(key) ?? 0) + amount);
      trades.push({ at: created.getTime(), iso: item.createdAt, amount });
      if (amount > 0) gross += amount;
      if (amount < 0) loss += -amount;
    }

    const symbol = String(item.symbol || '').trim();
    const timeframe = String(item.timeframe || '').trim();
    if (symbol && symbol !== 'N/A') add(groups.bySymbol, symbol, win, amount);
    if (timeframe && timeframe !== 'N/A') add(groups.byTimeframe, timeframe, win, amount);
    const side = sideOf(item);
    if (side) add(groups.bySide, side, win, amount);
    add(groups.byWeekday, String(created.getDay()), win, amount);
  }

  // Trade a trade, nao dia a dia: dois trades no mesmo dia ja formam curva, e
  // a queda dentro do dia aparece na maior queda.
  trades.sort((a, b) => a.at - b.at);
  const equity: Array<{ at: string; value: number }> = [];
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    running += trade.amount;
    equity.push({ at: trade.iso, value: round2(running) });
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, running - peak);
  }

  const days = [...dayPnl.keys()].sort();

  let bestDay: MonthStats['bestDay'] = null;
  let worstDay: MonthStats['worstDay'] = null;
  for (const day of days) {
    const pnl = round2(dayPnl.get(day) ?? 0);
    if (pnl > 0 && (!bestDay || pnl > bestDay.pnl)) bestDay = { day, pnl };
    if (pnl < 0 && (!worstDay || pnl < worstDay.pnl)) worstDay = { day, pnl };
  }

  const finish = (map: Map<string, GroupRow>) =>
    [...map.values()]
      .map((row) => ({ ...row, pnl: row.pnl === null ? null : round2(row.pnl) }))
      .sort((a, b) => b.closed - a.closed || (b.pnl ?? 0) - (a.pnl ?? 0) || a.key.localeCompare(b.key));

  return {
    closed,
    avgR: rTrades > 0 ? Math.round((rSum / rTrades) * 100) / 100 : null,
    rTrades,
    profitFactor: loss > 0 ? Math.round((gross / loss) * 100) / 100 : null,
    maxDrawdown: equity.length > 0 ? round2(maxDrawdown) : null,
    equity,
    bestDay,
    worstDay,
    bySymbol: finish(groups.bySymbol),
    byTimeframe: finish(groups.byTimeframe),
    bySide: finish(groups.bySide),
    byWeekday: finish(groups.byWeekday).sort((a, b) => Number(a.key) - Number(b.key)),
  };
}
