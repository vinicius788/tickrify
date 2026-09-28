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
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, ImageOff, Maximize2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import EmptyState from '@/components/dashboard/EmptyState';
import { useAPIClient, type AIAnalysisResponse } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getRecommendationMeta } from '@/lib/trading-ui';
import { VERDICT_CFG, isTradeCall, verdictFromOutcome, type Verdict } from '@/lib/verdict';
import { buildMonthGrid, dayKey, monthRange, summarizeByDay, weekStartFor } from '@/lib/journal';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

function fmtPnl(n: number, compact = false): string {
  const abs = new Intl.NumberFormat('en-US', compact
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
  const verdictOf = (a: AIAnalysisResponse): Verdict => verdictFromOutcome(a.outcome);
  const pnlOf = (a: AIAnalysisResponse): number | null => {
    const n = Number(a.pnlAmount);
    return a.pnlAmount === null || a.pnlAmount === undefined || !Number.isFinite(n) ? null : n;
  };
  const { days, totals } = useMemo(() => summarizeByDay(items, verdictOf, pnlOf), [items]);

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
    'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30';

  return (
    <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="tk-display text-lg">{j.title}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">{j.subtitle}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={goToday}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]"
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
        {/* ── Resumo do mes ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-px border-y border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.analyses}</p>
            <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">{totals.count}</p>
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.winRate}</p>
            <p className="font-terminal text-lg font-semibold text-[var(--signal-buy)]">
              {decided > 0 ? `${Math.round((totals.wins / decided) * 1000) / 10}%` : '—'}
            </p>
            <p className="font-terminal text-[10px] text-[var(--text-secondary)]">
              {totals.wins}{tr.winShort} / {totals.losses}{tr.lossShort}
            </p>
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.pnl}</p>
            <p className="font-terminal text-lg font-semibold" style={{ color: pnlColor(totals.pnl) }}>
              {totals.pnl !== null ? fmtPnl(totals.pnl) : '—'}
            </p>
          </div>
          <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{j.activeDays}</p>
            <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">{totals.activeDays}</p>
          </div>
        </div>

        {query.data?.truncated && (
          <p className="border-b border-[var(--border-subtle)] px-5 py-2 text-xs text-amber-500">{j.truncated}</p>
        )}

        {query.isError ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-[var(--text-secondary)]">{j.error}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-white/[0.04]"
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
                const tint = day?.pnl
                  ? day.pnl > 0 ? 'var(--signal-buy-bg)' : 'var(--signal-sell-bg)'
                  : day ? 'var(--bg-overlay)' : 'transparent';
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
                        isToday ? 'bg-white font-semibold text-[#050508]' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {day && (
                      <span className="mt-auto flex flex-col gap-0.5">
                        {day.pnl !== null && (
                          <span
                            className="truncate font-terminal text-[10px] font-semibold sm:text-sm"
                            style={{ color: pnlColor(day.pnl) }}
                          >
                            <span className="sm:hidden">{fmtPnl(day.pnl, true)}</span>
                            <span className="hidden sm:inline">{fmtPnl(day.pnl)}</span>
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
                            {fmtPnl(selectedDay.pnl)}
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
                            const meta = getRecommendationMeta(a.recommendation);
                            const verdict = verdictOf(a);
                            const vcfg = verdict ? VERDICT_CFG[verdict] : null;
                            const pnl = verdict === 'TP1' || verdict === 'TP2' || verdict === 'SL' ? pnlOf(a) : null;
                            const symbol = String(a.symbol || 'N/A');
                            const timeframe = a.timeframe && a.timeframe !== 'N/A' ? a.timeframe : '';
                            const title = `${symbol}${timeframe ? ` · ${timeframe}` : ''}`;
                            const imageUrl = typeof a.imageUrl === 'string' && a.imageUrl.trim() ? a.imageUrl : null;
                            const broken = brokenImages[a.id] === true;
                            const signalClass = meta.tone === 'buy'
                              ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
                              : meta.tone === 'sell'
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
                                      <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                                        <Maximize2 className="h-3.5 w-3.5 text-white" />
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
                                    <Badge variant="outline" className={`border text-[10px] font-bold tracking-widest ${signalClass}`}>
                                      {meta.label}
                                    </Badge>
                                  </div>
                                  <span className="font-terminal text-[10px] text-[var(--text-secondary)]">
                                    {new Date(a.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                  <span
                                    className="rounded px-2 py-0.5 font-terminal text-[10px] font-semibold"
                                    style={vcfg
                                      ? { background: vcfg.bg, border: `1px solid ${vcfg.border}`, color: vcfg.text }
                                      : { border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                                  >
                                    {verdictLabel(verdict, a.recommendation)}
                                  </span>
                                  {pnl !== null && (
                                    <span className="font-terminal text-xs font-semibold" style={{ color: pnlColor(pnl) }}>
                                      {fmtPnl(pnl)}
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
              </>
            )}
          </div>
        )}
      </CardContent>

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
