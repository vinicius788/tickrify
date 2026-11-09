/**
 * Diario — calendario do mes com as analises e o resultado de cada dia.
 *
 * Substituiu a aba Watchlist em 24/09/2026 (os favoritos viraram um filtro no
 * My Trades). Arquivo proprio porque e uma aba inteira, como MyTrades e
 * StrategyProfile; a conta de cada dia mora em `lib/journal.ts`, testada.
 *
 * Os dados vem de GET /api/ai/journal (so o mes aberto), nao da lista paginada
 * de 40: um mes cheio passaria disso e o total do mes sairia menor que o real.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, ImageOff, Maximize2, NotebookPen } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import EmptyState from '@/components/dashboard/EmptyState';
import TradeNoteDialog from '@/components/dashboard/TradeNoteDialog';
import { isEmptyTradeNote, type TradeNote } from '@/lib/trade-note';
import { useAPIClient, type AIAnalysisResponse } from '@/lib/api';
import { LOCALES } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { entrySide, getRecommendationMeta, resolveSignalState, signalStateLabel, signalStateTone } from '@/lib/trading-ui';
import { VERDICT_CFG, isTradeCall, verdictFromOutcome, type Verdict } from '@/lib/verdict';
import { buildMonthGrid, computeAiComparison, computeMonthStats, type AiComparison, dayKey, monthRange, summarizeByDay, weekStartFor, type GroupRow, type MonthStats } from '@/lib/journal';
import { WatchPending, WatchingSection } from './PendingLevels';
import { watchDayTint, watchTone, WATCH_TONE_CLASSES, WATCH_TONE_DOT, type WatchTone } from '@/lib/setups';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

function fmtPnl(n: number, locale: string, compact = false): string {
  const abs = new Intl.NumberFormat(locale, compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${abs}`;
}

/**
 * So a primeira letra maiuscula. A classe `capitalize` do CSS poe maiuscula em
 * TODA palavra e saia "Setembro De 2026" / "Quinta-Feira, 3 De Setembro".
 */
const upperFirst = (text: string, locale: string) =>
  text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : text;

const pnlColor = (n: number | null) =>
  n === null || n === 0 ? 'var(--text-secondary)' : n > 0 ? 'var(--signal-buy)' : 'var(--signal-sell)';

type JournalCopy = ReturnType<typeof useLanguage>['t']['journal'];

/** R:R planejado do alvo atingido, lido do item da lista (numero ou "1:2.5"). */
function plannedRr(a: AIAnalysisResponse, verdict: 'TP1' | 'TP2'): number | null {
  const raw = (a as unknown as Record<string, unknown>)[verdict === 'TP1' ? 'riskRewardTp1' : 'riskRewardTp2'];
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/^1:/, ''));
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) || n <= 0 ? null : n;
}

function sideOf(a: AIAnalysisResponse): 'BUY' | 'SELL' | null {
  if (!isTradeCall(a.recommendation, a.signalState)) return null;
  const tone = getRecommendationMeta(a.recommendation).tone;
  return tone === 'buy' ? 'BUY' : tone === 'sell' ? 'SELL' : null;
}

/** Curva do P&L acumulado: linha simples com o zero tracejado. */
function EquityCurve({ points }: { points: MonthStats['equity'] }) {
  const values = [0, ...points.map((p) => p.value)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 600;
  const H = 120;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => 8 + (1 - (v - min) / span) * (H - 16);
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none" aria-hidden="true">
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-subtle)" strokeDasharray="4 5" />
      <polyline
        fill="none"
        stroke={last >= 0 ? 'var(--signal-buy)' : 'var(--signal-sell)'}
        strokeWidth={2.5}
        vectorEffect="non-scaling-stroke"
        points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
      />
    </svg>
  );
}

function GroupCard({ title, rows, label, j }: { title: string; rows: GroupRow[]; label: (key: string) => string; j: JournalCopy }) {
  const { language } = useLanguage();
  const locale = LOCALES[language];
  if (rows.length === 0) return null;
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] p-3">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{title}</p>
      <div className="flex flex-col gap-1.5">
        {rows.slice(0, 6).map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-terminal text-[var(--text-primary)]">{label(row.key)}</span>
            <span className="flex shrink-0 items-center gap-3 font-terminal">
              <span className="text-[var(--text-secondary)]">{j.closedTrades.replace('{n}', String(row.closed))}</span>
              <span className="w-10 text-right text-[var(--text-primary)]">{`${Math.round((row.wins / row.closed) * 100)}%`}</span>
              <span className="w-20 text-right font-semibold" style={{ color: pnlColor(row.pnl) }}>
                {row.pnl !== null ? fmtPnl(row.pnl, locale) : '·'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Desempenho do mes (05/10/2026). A conta mora em `computeMonthStats` (testada). */
function JournalStats({ stats, j, locale }: { stats: MonthStats; j: JournalCopy; locale: string }) {
  if (stats.closed === 0) {
    return <p className="mt-4 rounded-lg border border-[var(--border-subtle)] px-4 py-4 text-center text-xs text-[var(--text-secondary)]">{j.statsEmpty}</p>;
  }
  const dayLabel = (key: string) =>
    upperFirst(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(`${key}T12:00:00`)), locale);
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  // 04/01/2026 foi domingo: chave 0 = domingo, como `Date.getDay()`.
  const weekdayLabel = (key: string) => upperFirst(weekdayFmt.format(new Date(2026, 0, 4 + Number(key))), locale);
  const sideLabel = (key: string) => getRecommendationMeta(key).label;
  const tile = 'bg-[var(--bg-surface)] px-3 py-2.5';
  return (
    <section className="mt-4" aria-labelledby="journal-stats-title">
      <h3 id="journal-stats-title" className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{j.statsTitle}</h3>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
        <div className={tile}>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.avgR}</p>
          <p className="font-terminal text-lg font-semibold" style={{ color: pnlColor(stats.avgR) }}>
            {stats.avgR !== null ? `${stats.avgR > 0 ? '+' : ''}${stats.avgR.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}R` : '·'}
          </p>
          <p className="text-[10px] text-[var(--text-secondary)]">{j.avgRSub.replace('{n}', String(stats.rTrades))}</p>
        </div>
        <div className={tile}>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.profitFactor}</p>
          <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">
            {stats.profitFactor !== null ? stats.profitFactor.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '·'}
          </p>
          <p className="text-[10px] text-[var(--text-secondary)]">{j.profitFactorSub}</p>
        </div>
        <div className={tile}>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.maxDrawdown}</p>
          <p className="font-terminal text-lg font-semibold" style={{ color: pnlColor(stats.maxDrawdown) }}>
            {stats.maxDrawdown !== null ? fmtPnl(stats.maxDrawdown, locale) : '·'}
          </p>
          <p className="text-[10px] text-[var(--text-secondary)]">{j.maxDrawdownSub}</p>
        </div>
        <div className={tile}>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.bestDay}</p>
          <p className="font-terminal text-sm font-semibold" style={{ color: pnlColor(stats.bestDay?.pnl ?? null) }}>
            {stats.bestDay ? `${dayLabel(stats.bestDay.day)} ${fmtPnl(stats.bestDay.pnl, locale)}` : '·'}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.worstDay}</p>
          <p className="font-terminal text-sm font-semibold" style={{ color: pnlColor(stats.worstDay?.pnl ?? null) }}>
            {stats.worstDay ? `${dayLabel(stats.worstDay.day)} ${fmtPnl(stats.worstDay.pnl, locale)}` : '·'}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-[var(--border-subtle)] p-3">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.equity}</p>
        {stats.equity.length > 0 ? (
          <EquityCurve points={stats.equity} />
        ) : (
          <p className="py-4 text-center text-xs text-[var(--text-secondary)]">{j.equityHint}</p>
        )}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <GroupCard title={j.byAsset} rows={stats.bySymbol} label={(k) => k} j={j} />
        <GroupCard title={j.byTimeframe} rows={stats.byTimeframe} label={(k) => k} j={j} />
        <GroupCard title={j.bySide} rows={stats.bySide} label={sideLabel} j={j} />
        <GroupCard title={j.byWeekday} rows={stats.byWeekday} label={weekdayLabel} j={j} />
        <GroupCard title={j.bySetup} rows={stats.bySetup} label={(k) => (j.setupLabels as Record<string, string>)[k] ?? k} j={j} />
        <GroupCard title={j.byMistake} rows={stats.byMistake} label={(k) => (j.mistakeLabels as Record<string, string>)[k] ?? k} j={j} />
      </div>
    </section>
  );
}

/**
 * Voce x o plano da IA (05/10/2026): o que o trader marcou contra o que o
 * mercado fez nas 48h (sweeper). A conta mora em `computeAiComparison`.
 */
function AiComparisonCard({ c, j }: { c: AiComparison; j: JournalCopy }) {
  if (c.plans === 0) return null;
  const n = (text: string, values: Record<string, number>) =>
    Object.entries(values).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), text);
  const row = 'flex items-start justify-between gap-3 text-xs';
  return (
    <section className="mt-3 rounded-lg border border-[var(--border-subtle)] p-3" aria-labelledby="journal-vs-title">
      <h3 id="journal-vs-title" className="text-sm font-semibold text-[var(--text-primary)]">{j.vsTitle}</h3>
      <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{j.vsSub}</p>
      <div className="mt-3 flex flex-col gap-2">
        <div className={row}>
          <span className="text-[var(--text-secondary)]">{j.vsPlans}</span>
          <span className="text-right font-terminal text-[var(--text-primary)]">
            {c.measured > 0 ? n(j.vsPlansValue, { w: c.marketWins, n: c.measured }) : '·'}
          </span>
        </div>
        {c.both > 0 && (
          <>
            <div className={row}>
              <span className="text-[var(--text-secondary)]">{j.vsSame}</span>
              <span className="text-right font-terminal text-[var(--text-primary)]">{n(j.vsSameValue, { k: c.agree, n: c.both })}</span>
            </div>
            {c.beatPlan > 0 && <p className="text-xs text-[var(--signal-buy)]">{n(j.vsBeatPlan, { n: c.beatPlan })}</p>}
            {c.missedPlan > 0 && <p className="text-xs text-[var(--signal-sell)]">{n(j.vsMissedPlan, { n: c.missedPlan })}</p>}
          </>
        )}
        {c.untaken > 0 && (
          <div className={row}>
            <span className="text-[var(--text-secondary)]">{j.vsUntaken}</span>
            <span className="text-right font-terminal text-[var(--text-primary)]">{n(j.vsUntakenValue, { n: c.untaken, w: c.untakenWins })}</span>
          </div>
        )}
        <div className="flex flex-col gap-0.5 text-[11px] text-[var(--text-secondary)]">
          {c.pending > 0 && <span>{n(j.vsPending, { n: c.pending })}</span>}
          {c.undecided > 0 && <span>{n(j.vsUndecided, { n: c.undecided })}</span>}
          {c.unmeasured > 0 && <span>{n(j.vsUnmeasured, { n: c.unmeasured })}</span>}
        </div>
      </div>
    </section>
  );
}

interface JournalCalendarProps {
  onStartAnalysis?: () => void;
}

const JournalCalendar = ({ onStartAnalysis }: JournalCalendarProps) => {
  const { user } = useUser();
  const { getJournal } = useAPIClient();
  const { t, language } = useLanguage();
  const j = t.journal;
  const tr = t.trades;
  const locale = DATE_LOCALES[language] ?? 'en-US';

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(dayKey(now));
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [noteFor, setNoteFor] = useState<{ id: string; title: string; note: TradeNote | null } | null>(null);
  const queryClient = useQueryClient();

  const { from, to } = monthRange(cursor.year, cursor.month);
  const isCurrentMonth = cursor.year === now.getFullYear() && cursor.month === now.getMonth();

  const query = useQuery({
    queryKey: ['journal', from.toISOString()],
    queryFn: () => getJournal(from.toISOString(), to.toISOString()),
    enabled: Boolean(user),
    // Sempre relido ao abrir a aba: o trader acabou de lancar um valor no
    // My Trades e espera ve-lo no dia certo.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  // O Diario so le: o resultado e o do servidor (lib/verdict.ts).
  const verdictOf = (a: AIAnalysisResponse): Verdict => sideOf(a) ? verdictFromOutcome(a.outcome) : null;
  const pnlOf = (a: AIAnalysisResponse): number | null => {
    const n = Number(a.pnlAmount);
    return a.pnlAmount === null || a.pnlAmount === undefined || !Number.isFinite(n) ? null : n;
  };
  const { days, totals } = useMemo(() => summarizeByDay(items, verdictOf, pnlOf), [items]);
  const stats = useMemo(() => computeMonthStats(items, verdictOf, pnlOf, sideOf, plannedRr, (a) => a.tradeNote), [items]);
  const comparison = useMemo(() => computeAiComparison(items, verdictOf, sideOf, (a) => a.marketOutcome), [items]);

  const weekStart = weekStartFor(language);
  const grid = useMemo(() => buildMonthGrid(cursor.year, cursor.month, weekStart), [cursor, weekStart]);
  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 04/01/2026 foi domingo: base fixa para gerar os 7 nomes na ordem certa.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2026, 0, 4 + ((i + weekStart) % 7))));
  }, [locale, weekStart]);
  const monthLabel = upperFirst(new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(from), locale);

  const goMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
    setSelected(null);
  };
  const goToday = () => {
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(dayKey(now));
  };

  const decided = totals.wins + totals.losses;
  const todayKey = dayKey(now);
  const selectedDay = selected ? days.get(selected) : undefined;
  // Aguardar sem resultado mostra "sem operacao", nao "sem resultado": nao ha o
  // que registrar, mesma regra do My Trades (isTradeCall em lib/verdict.ts).
  const verdictLabel = (v: Verdict, recommendation: unknown): string =>
    v === 'TP1' ? tr.tp1Hit : v === 'TP2' ? tr.tp2Hit : v === 'SL' ? tr.slHit : v === 'OPEN' ? tr.open
      : v === 'NO_FILL' ? tr.noFill
      : isTradeCall(recommendation) ? j.noResult : tr.noTrade;

  const navBtn =
    'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30';

  return (
    <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="tk-display text-lg">{j.title}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">{j.subtitle}</CardDescription>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">{t.productClarity.personalMetrics}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={goToday}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]"
              >
                {j.today}
              </button>
            )}
            <button type="button" onClick={() => goMonth(-1)} className={navBtn} aria-label={j.prev} title={j.prev}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center font-terminal text-sm text-[var(--text-primary)]">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => goMonth(1)}
              disabled={isCurrentMonth}
              className={navBtn}
              aria-label={j.next}
              title={j.next}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <WatchingSection surface="journal" enabled={Boolean(user)} />
        {/* ── Resumo do mes ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-px border-y border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.analyses}</p>
            <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">{totals.count}</p>
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.winRate}</p>
            <p className="font-terminal text-lg font-semibold text-[var(--signal-buy)]">
              {decided > 0 ? `${Math.round((totals.wins / decided) * 1000) / 10}%` : '-'}
            </p>
            <p className="font-terminal text-[10px] text-[var(--text-secondary)]">
              {totals.wins}{tr.winShort} / {totals.losses}{tr.lossShort}
            </p>
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.pnl}</p>
            <p className="font-terminal text-lg font-semibold" style={{ color: pnlColor(totals.pnl) }}>
              {totals.pnl !== null ? fmtPnl(totals.pnl, locale) : '-'}
            </p>
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.activeDays}</p>
            <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">{totals.activeDays}</p>
          </div>
        </div>

        {query.data?.truncated && (
          <p className="border-b border-[var(--border-subtle)] px-5 py-2 text-xs text-[var(--tone-warn-3)]">{j.truncated}</p>
        )}

        {query.isError ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-[var(--text-secondary)]">{j.error}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
            >
              {j.retry}
            </button>
          </div>
        ) : (
          <div className="p-3 sm:p-5">
            {/* ── Grade ─────────────────────────────────────────── */}
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5" aria-busy={query.isLoading}>
              {weekdayLabels.map((label) => (
                <div
                  key={label}
                  className="pb-1 text-center font-terminal text-[10px] uppercase tracking-wide text-[var(--text-secondary)]"
                >
                  {label}
                </div>
              ))}
              {grid.map((date, index) => {
                if (!date) return <div key={`pad-${index}`} aria-hidden="true" />;
                const key = dayKey(date);
                const day = days.get(key);
                const isToday = key === todayKey;
                const isSelected = key === selected;
                const isFuture = date.getTime() > now.getTime() && !isToday;
                // WATCH e o que o mercado fez: nunca soma no P&L do dia, que continua mandando no fundo.
                const watchTones: WatchTone[] = day ? day.items.flatMap((a) => (a.watch && verdictOf(a) === null ? [watchTone(a.watch, now.getTime())] : [])) : [];
                const tint = day?.pnl
                  ? day.pnl > 0 ? 'var(--signal-buy-bg)' : 'var(--signal-sell-bg)'
                  : watchDayTint(watchTones) ?? (day ? 'var(--bg-overlay)' : 'transparent');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    disabled={isFuture}
                    aria-pressed={isSelected}
                    aria-label={`${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date)}${
                      day ? `, ${day.count === 1 ? j.dayAnalysis : j.dayAnalyses.replace('{n}', String(day.count))}` : ''
                    }`}
                    className={`flex min-h-[52px] flex-col items-stretch rounded-lg border p-1 text-left transition-colors sm:min-h-[96px] sm:p-2 ${
                      isSelected
                        ? 'border-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] hover:border-[var(--text-secondary)]'
                    } ${isFuture ? 'opacity-35' : ''} ${query.isLoading ? 'animate-pulse' : ''}`}
                    style={{ background: tint }}
                  >
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center self-start rounded-full font-terminal text-[11px] sm:h-6 sm:w-6 sm:text-xs ${
                        isToday ? 'bg-[var(--inverse-bg)] font-semibold text-[var(--inverse-fg)]' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {day && (
                      <span className="mt-auto flex flex-col gap-0.5">
                        {watchTones.length > 0 && (
                          <span key="watch" data-testid="day-watch" className="flex gap-1">
                            {[...new Set(watchTones)].map((tone) => (
                              <span key={tone} data-tone={tone} className={`h-1.5 w-1.5 rounded-full ${WATCH_TONE_DOT[tone]}`} />
                            ))}
                          </span>
                        )}
                        {day.pnl !== null && (
                          <span
                            className="truncate font-terminal text-[10px] font-semibold sm:text-sm"
                            style={{ color: pnlColor(day.pnl) }}
                          >
                            <span className="sm:hidden">{fmtPnl(day.pnl, locale, true)}</span>
                            <span className="hidden sm:inline">{fmtPnl(day.pnl, locale)}</span>
                          </span>
                        )}
                        <span className="hidden truncate font-terminal text-[10px] text-[var(--text-secondary)] sm:block">
                          {day.count === 1 ? j.dayAnalysis : j.dayAnalyses.replace('{n}', String(day.count))}
                        </span>
                        {(day.wins > 0 || day.losses > 0) && (
                          <span className="hidden font-terminal text-[10px] sm:block">
                            <span className="text-[var(--signal-buy)]">{day.wins}{tr.winShort}</span>
                            <span className="text-[var(--text-secondary)]"> / </span>
                            <span className="text-[var(--signal-sell)]">{day.losses}{tr.lossShort}</span>
                          </span>
                        )}
                        {day.pnl === null && (
                          <span className="font-terminal text-[10px] text-[var(--text-secondary)] sm:hidden">{day.count}</span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {!query.isLoading && totals.count === 0 ? (
              <div className="mt-4">
                <EmptyState
                  icon={CalendarDays}
                  title={j.emptyMonth}
                  description={j.pnlHint}
                  ctaLabel={j.cta}
                  onCta={() => onStartAnalysis?.()}
                />
              </div>
            ) : (
              <>
                <p className="mt-3 text-[11px] text-[var(--text-secondary)]">
                  {j.byDateNote} {totals.pnl === null && totals.count > 0 ? j.pnlHint : ''}
                </p>

                {/* ── Dia escolhido ─────────────────────────────── */}
                <div className="mt-4 rounded-lg border border-[var(--border-subtle)]">
                  {!selected ? (
                    <p className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">{j.selectDay}</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {upperFirst(
                            new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
                              new Date(`${selected}T12:00:00`),
                            ),
                            locale,
                          )}
                        </span>
                        {selectedDay?.pnl != null && (
                          <span className="font-terminal text-sm font-semibold" style={{ color: pnlColor(selectedDay.pnl) }}>
                            {fmtPnl(selectedDay.pnl, locale)}
                          </span>
                        )}
                      </div>
                      {!selectedDay ? (
                        <p className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                          {query.isLoading ? j.loading : j.emptyDay}
                        </p>
                      ) : (
                        <div className="divide-y divide-[var(--border-subtle)]">
                          {selectedDay.items.map((a) => {
                            const state = resolveSignalState(a.signalState, a.recommendation);
                            const stateTone = signalStateTone(state, a.recommendation);
                            const verdict = verdictOf(a);
                            const vcfg = verdict ? VERDICT_CFG[verdict] : null;
                            const pnl = verdict === 'TP1' || verdict === 'TP2' || verdict === 'SL' ? pnlOf(a) : null;
                            const symbol = String(a.symbol || 'N/A');
                            const timeframe = a.timeframe && a.timeframe !== 'N/A' ? a.timeframe : '';
                            const title = `${symbol}${timeframe ? ` · ${timeframe}` : ''}`;
                            const imageUrl = typeof a.imageUrl === 'string' && a.imageUrl.trim() ? a.imageUrl : null;
                            const broken = brokenImages[a.id] === true;
                            const signalClass = state === 'WATCH' && a.watch
                              ? WATCH_TONE_CLASSES[watchTone(a.watch, now.getTime())]
                              : stateTone === 'buy'
                              ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
                              : stateTone === 'sell'
                                ? 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
                                : 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]';
                            return (
                              <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => imageUrl && !broken && setViewer({ url: imageUrl, title })}
                                  disabled={!imageUrl || broken}
                                  aria-label={`${j.viewChart}: ${title}`}
                                  className="group relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] sm:h-14 sm:w-20"
                                >
                                  {imageUrl && !broken ? (
                                    <>
                                      <img
                                        src={imageUrl}
                                        alt={title}
                                        loading="lazy"
                                        width={80}
                                        height={56}
                                        onError={() => setBrokenImages((prev) => ({ ...prev, [a.id]: true }))}
                                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                                      />
                                      <span className="absolute inset-0 flex items-center justify-center bg-[var(--scrim-soft)] opacity-0 transition-opacity group-hover:opacity-100">
                                        <Maximize2 className="h-3.5 w-3.5 text-[var(--on-scrim)]" />
                                      </span>
                                    </>
                                  ) : (
                                    <span className="flex h-full w-full items-center justify-center text-[var(--text-secondary)]">
                                      <ImageOff className="h-4 w-4" />
                                    </span>
                                  )}
                                </button>
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-terminal text-sm font-bold text-[var(--text-primary)]">{symbol}</span>
                                    {timeframe && (
                                      <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-1.5 py-0.5 font-terminal text-[10px] text-[var(--text-secondary)]">
                                        {timeframe}
                                      </span>
                                    )}
                                    <Badge variant="outline" className={`border text-[10px] font-bold uppercase tracking-widest ${signalClass}`}>
                                      {signalStateLabel(t.analysis, state, entrySide(a.fullResponse?.watchPlan, a.recommendation))}
                                    </Badge>
                                  </div>
                                  <span className="font-terminal text-[10px] text-[var(--text-secondary)]">
                                    {new Date(a.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {!isEmptyTradeNote(a.tradeNote) && (
                                    <span className="flex flex-wrap gap-1 text-[10px] text-[var(--text-secondary)]">
                                      {a.tradeNote?.setup && (
                                        <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">{(j.setupLabels as Record<string, string>)[a.tradeNote.setup] ?? a.tradeNote.setup}</span>
                                      )}
                                      {a.tradeNote?.emotion && (
                                        <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5">{(j.emotionLabels as Record<string, string>)[a.tradeNote.emotion] ?? a.tradeNote.emotion}</span>
                                      )}
                                      {a.tradeNote?.mistakes.map((m) => (
                                        <span key={m} className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[var(--tone-warn-3)]">{(j.mistakeLabels as Record<string, string>)[m] ?? m}</span>
                                      ))}
                                    </span>
                                  )}
                                  {a.tradeNote?.note && (
                                    <span className="line-clamp-2 text-xs text-[var(--text-secondary)]">{a.tradeNote.note}</span>
                                  )}
                                  {a.watch && verdict === null && <WatchPending analysisId={a.id} watch={a.watch} surface="journal" symbol={a.symbol} />}
                                  {sideOf(a) && (
                                    <button
                                      type="button"
                                      onClick={() => setNoteFor({ id: a.id, title, note: a.tradeNote ?? null })}
                                      className="inline-flex w-fit items-center gap-1 text-[11px] text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline"
                                    >
                                      <NotebookPen className="h-3 w-3" />
                                      <span>{isEmptyTradeNote(a.tradeNote) ? j.noteAdd : j.noteEdit}</span>
                                    </button>
                                  )}
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  {a.watch && verdict === null ? null : <span
                                    className="rounded px-2 py-0.5 font-terminal text-[10px] font-semibold"
                                    style={vcfg
                                      ? { background: vcfg.bg, border: `1px solid ${vcfg.border}`, color: vcfg.text }
                                      : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                                  >
                                    {verdictLabel(verdict, a.recommendation)}
                                  </span>}
                                  {pnl !== null && (
                                    <span className="font-terminal text-xs font-semibold" style={{ color: pnlColor(pnl) }}>
                                      {fmtPnl(pnl, locale)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <JournalStats stats={stats} j={j} locale={locale} />
                <AiComparisonCard c={comparison} j={j} />
              </>
            )}
          </div>
        )}
      </CardContent>

      {noteFor && (
        <TradeNoteDialog
          analysisId={noteFor.id}
          title={noteFor.title}
          initial={noteFor.note}
          onClose={() => setNoteFor(null)}
          onSaved={() => {
            setNoteFor(null);
            void queryClient.invalidateQueries({ queryKey: ['journal'] });
          }}
        />
      )}

      <Dialog open={viewer !== null} onOpenChange={(open) => { if (!open) setViewer(null); }}>
        <DialogContent className="max-w-5xl border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <DialogTitle className="font-terminal text-sm text-[var(--text-primary)]">{viewer?.title}</DialogTitle>
          <DialogDescription className="sr-only">{j.viewChart}</DialogDescription>
          {viewer && (
            <>
              <img src={viewer.url} alt={viewer.title} className="max-h-[75vh] w-full rounded-md object-contain" />
              <a
                href={viewer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 justify-self-start text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {j.openFull}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default JournalCalendar;
