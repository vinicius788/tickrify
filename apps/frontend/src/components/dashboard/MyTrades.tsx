import { useMemo, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Filter, Star, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { confidenceToPercent, getRecommendationMeta } from '@/lib/trading-ui';
import { useAnalyses } from '@/hooks/useAnalyses';
import { asRecord } from '@/lib/utils';
import { useAPIClient } from '@/lib/api';
import type { AIAnalysisResponse } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import EmptyState from '@/components/dashboard/EmptyState';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

// ── Verdict (sincronizado com o backend; localStorage = fallback offline) ────
type Verdict = 'TP1' | 'TP2' | 'SL' | 'OPEN' | null;
const STORAGE_KEY = 'tickrify_verdicts';

// Verdict (UI) ↔ outcome (backend)
function verdictFromOutcome(o: unknown): Verdict {
  switch (String(o || '')) {
    case 'tp1': return 'TP1';
    case 'tp2': return 'TP2';
    case 'stop': return 'SL';
    case 'open': return 'OPEN';
    default: return null;
  }
}

function outcomeFromVerdict(v: Verdict): string | null {
  switch (v) {
    case 'TP1': return 'tp1';
    case 'TP2': return 'tp2';
    case 'SL': return 'stop';
    case 'OPEN': return 'open';
    default: return null;
  }
}

function loadVerdicts(): Record<string, Verdict> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function saveVerdict(id: string, verdict: Verdict) {
  const all = loadVerdicts();
  if (verdict === null) { delete all[id]; } else { all[id] = verdict; }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(n);
}

function extractLevels(a: AIAnalysisResponse) {
  const full = asRecord(a.fullResponse);
  const analysis = asRecord(full.analysis);
  return {
    symbol:      String(analysis.symbol || full.symbol || a.symbol || 'N/A').trim(),
    timeframe:   String(analysis.timeframe || full.timeframe || a.timeframe || '—').trim(),
    entry:       analysis.entry ?? null,
    stopLoss:    analysis.stopLoss ?? null,
    takeProfit1: analysis.takeProfit1 ?? null,
    takeProfit2: analysis.takeProfit2 ?? null,
    confluence:  analysis.confluenceScore ?? null,
    factorsPresent: analysis.factorsPresent ?? null,
  };
}

// Verdict badge config (cores; rótulos vêm do i18n)
const VERDICT_CFG = {
  TP1:  { bg: 'rgba(0,255,127,0.12)',   border: 'rgba(0,255,127,0.4)',  text: '#00FF7F' },
  TP2:  { bg: 'rgba(0,200,80,0.12)',    border: 'rgba(0,200,80,0.4)',   text: '#00C850' },
  SL:   { bg: 'rgba(255,68,68,0.12)',   border: 'rgba(255,68,68,0.4)',  text: '#FF4444' },
  OPEN: { bg: 'rgba(120,120,180,0.10)', border: 'rgba(120,120,180,0.3)', text: '#9999CC' },
} as const;

// ── Demo data (rotulada como demo na UI; confiancas dentro da faixa real do
// motor v7.3 — 62-78, >70 raro. Nao subir esses numeros.) ────────────────────────────────────────────────────────────────
const DEMO: AIAnalysisResponse[] = [
  { id: 'd1', status: 'completed', recommendation: 'BUY',  confidence: 68, symbol: 'XAUUSD', timeframe: '15M', createdAt: new Date(Date.now()-3600000).toISOString(), updatedAt: '', fullResponse: { recommendation:'BUY', bias:'bullish', confidence:68, reasoning:'', analysis:{ symbol:'XAUUSD', timeframe:'15M', entry:3310, stopLoss:3295, takeProfit1:3340, takeProfit2:3370, confluenceScore:83, factorsPresent:5 } } },
  { id: 'd2', status: 'completed', recommendation: 'SELL', confidence: 72, symbol: 'EURUSD', timeframe: '1H',  createdAt: new Date(Date.now()-7200000).toISOString(), updatedAt: '', fullResponse: { recommendation:'SELL', bias:'bearish', confidence:72, reasoning:'', analysis:{ symbol:'EURUSD', timeframe:'1H', entry:1.0820, stopLoss:1.0855, takeProfit1:1.0770, takeProfit2:1.0730, confluenceScore:67, factorsPresent:4 } } },
  { id: 'd3', status: 'completed', recommendation: 'BUY',  confidence: 66, symbol: 'BTCUSDT',timeframe: '4H', createdAt: new Date(Date.now()-86400000).toISOString(),updatedAt: '', fullResponse: { recommendation:'BUY',  bias:'bullish', confidence:66, reasoning:'', analysis:{ symbol:'BTCUSDT', timeframe:'4H', entry:104500, stopLoss:102000, takeProfit1:109000, takeProfit2:113000, confluenceScore:100, factorsPresent:6 } } },
];

// ── Component ────────────────────────────────────────────────────────────────
// onStartAnalysis: o DashboardPage passa o resetNewAnalysisView (mesma navegação
// por `activeView` usada no resto do painel — sem rota nova).
interface MyTradesProps {
  onStartAnalysis?: () => void;
}

const MyTrades = ({ onStartAnalysis }: MyTradesProps) => {
  const { user } = useUser();
  const isDemo = !user;
  // Mesmo limite do Dashboard (40) → as três telas compartilham UM único cache
  // do React Query. Assim esta aba abre na hora (reaproveita o que já foi
  // carregado) em vez de disparar uma nova busca de 100 registros no servidor.
  const { analyses, loading, refetch } = useAnalyses(40);
  const { setOutcome, setFavorite } = useAPIClient();
  const { t, language } = useLanguage();
  const tr = t.trades;
  const dateLocale = DATE_LOCALES[language] ?? 'en-US';
  const verdictLabel = (v: Verdict): string => {
    switch (v) {
      case 'TP1': return tr.tp1Hit;
      case 'TP2': return tr.tp2Hit;
      case 'SL': return tr.slHit;
      case 'OPEN': return tr.open;
      default: return tr.pending;
    }
  };
  const verdictOptions: Array<{ value: Verdict; label: string }> = [
    { value: null, label: tr.pending },
    { value: 'TP1', label: tr.tp1Hit },
    { value: 'TP2', label: tr.tp2Hit },
    { value: 'SL', label: tr.slHit },
    { value: 'OPEN', label: tr.open },
  ];

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(loadVerdicts);
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterVerdict, setFilterVerdict] = useState<'all' | 'pending' | Verdict>('all');

  const rows = isDemo ? DEMO : analyses.filter((a) => a.status === 'completed');

  // Verdict efetivo: estado local (alteração recente) tem prioridade; senão usa o do banco.
  const getVerdict = (a: AIAnalysisResponse): Verdict => {
    if (Object.prototype.hasOwnProperty.call(verdicts, a.id)) {
      return verdicts[a.id] ?? null;
    }
    return verdictFromOutcome((a as unknown as Record<string, unknown>).outcome);
  };

  // Unique symbols for filter dropdown
  const symbols = useMemo(() => {
    const set = new Set(rows.map((a) => extractLevels(a).symbol).filter((s) => s !== 'N/A'));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((a) => {
      const { symbol } = extractLevels(a);
      if (filterSymbol && symbol !== filterSymbol) return false;
      const v = getVerdict(a);
      if (filterVerdict === 'pending' && v !== null) return false;
      if (filterVerdict !== 'all' && filterVerdict !== 'pending' && v !== filterVerdict) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, verdicts, filterSymbol, filterVerdict]);

  // Resumo de performance (a partir das análises carregadas).
  const perf = useMemo(() => {
    let wins = 0, losses = 0, open = 0, pending = 0, rrSum = 0, rrCount = 0;
    for (const a of rows) {
      const v = getVerdict(a);
      if (v === 'TP1' || v === 'TP2') wins += 1;
      else if (v === 'SL') losses += 1;
      else if (v === 'OPEN') open += 1;
      else pending += 1;
      const rr = Number((a as unknown as Record<string, unknown>).riskRewardTp2 ?? (a as unknown as Record<string, unknown>).riskRewardTp1);
      if (Number.isFinite(rr) && rr > 0) { rrSum += rr; rrCount += 1; }
    }
    const decided = wins + losses;
    return {
      wins, losses, open, pending,
      winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
      avgRr: rrCount > 0 ? Math.round((rrSum / rrCount) * 100) / 100 : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, verdicts]);

  const handleVerdict = (id: string, v: Verdict) => {
    saveVerdict(id, v);
    setVerdicts((prev) => ({ ...prev, [id]: v }));
    if (!isDemo) {
      // Persiste no backend (sem bloquear a UI; falha silenciosa mantém o localStorage).
      void setOutcome(id, { outcome: outcomeFromVerdict(v) }).catch(() => {});
    }
  };

  // ── Favoritos (Watchlist) — otimista, com rollback se o backend falhar ──
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const getFavorite = (a: AIAnalysisResponse): boolean => {
    if (Object.prototype.hasOwnProperty.call(favorites, a.id)) {
      return favorites[a.id];
    }
    return (a as unknown as Record<string, unknown>).isFavorite === true;
  };
  const handleFavorite = (a: AIAnalysisResponse) => {
    if (isDemo) return;
    const next = !getFavorite(a);
    setFavorites((prev) => ({ ...prev, [a.id]: next }));
    void setFavorite(a.id, next)
      .then(() => {
        // Invalida o cache da lista para a Watchlist refletir na hora (sem esperar os 30s).
        refetch();
      })
      .catch(() => {
        // Rollback silencioso: backend indisponível, volta o estado anterior.
        setFavorites((prev) => ({ ...prev, [a.id]: !next }));
      });
  };

  return (
    <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="tk-display text-lg">{tr.title}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              {isDemo ? tr.demoData : `${filtered.length} ${tr.found}`}
            </CardDescription>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <select
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-terminal text-xs text-[var(--text-primary)] outline-none"
            >
              <option value="">{tr.allAssets}</option>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterVerdict ?? 'all'}
              onChange={(e) => setFilterVerdict(e.target.value as typeof filterVerdict)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-terminal text-xs text-[var(--text-primary)] outline-none"
            >
              <option value="all">{tr.allResults}</option>
              <option value="pending">{tr.pending}</option>
              <option value="TP1">{tr.tp1Hit}</option>
              <option value="TP2">{tr.tp2Hit}</option>
              <option value="SL">{tr.slHit}</option>
              <option value="OPEN">{tr.open}</option>
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* ── Resumo de performance ─────────────────────────────── */}
        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-px border-y border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
            <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.winRate}</p>
              <p className="font-terminal text-lg font-semibold text-[var(--signal-buy)]">
                {perf.winRate !== null ? `${perf.winRate}%` : '—'}
              </p>
              <p className="font-terminal text-[10px] text-[var(--text-secondary)]">{perf.wins}{tr.winShort} / {perf.losses}{tr.lossShort}</p>
            </div>
            <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.avgRr}</p>
              <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">
                {perf.avgRr !== null ? `${perf.avgRr.toFixed(1)}:1` : '—'}
              </p>
            </div>
            <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.open}</p>
              <p className="font-terminal text-lg font-semibold text-[var(--signal-hold)]">{perf.open}</p>
            </div>
            <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.pendingCount}</p>
              <p className="font-terminal text-lg font-semibold text-[var(--text-secondary)]">{perf.pending}</p>
            </div>
          </div>
        )}

        {loading ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">{tr.loadingAnalyses}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={t.empty.tradesTitle}
            description={t.empty.tradesDesc}
            ctaLabel={t.empty.tradesCta}
            onCta={() => onStartAnalysis?.()}
          />
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
            {tr.emptyFilter}
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {filtered.map((a) => {
              const { symbol, timeframe, entry, stopLoss, takeProfit1, takeProfit2, confluence, factorsPresent } = extractLevels(a);
              const meta = getRecommendationMeta(a.recommendation);
              const confidence = confidenceToPercent(a.confidence);
              const verdict = getVerdict(a);
              const vcfg = verdict ? VERDICT_CFG[verdict] : null;

              const signalBg = meta.tone === 'buy'
                ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
                : meta.tone === 'sell'
                  ? 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
                  : 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]';

              return (
                <div key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-4">

                  {/* LEFT — signal + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isDemo && (
                        <button
                          type="button"
                          onClick={() => handleFavorite(a)}
                          title={getFavorite(a) ? tr.unfavorite : tr.favorite}
                          aria-label={getFavorite(a) ? tr.unfavorite : tr.favorite}
                          className="shrink-0 rounded p-0.5 transition-colors hover:bg-[var(--bg-overlay)]"
                        >
                          <Star
                            className={`h-4 w-4 ${getFavorite(a) ? 'fill-yellow-400 text-yellow-400' : 'text-[var(--text-secondary)]'}`}
                          />
                        </button>
                      )}
                      <span className="font-terminal font-bold text-[var(--text-primary)]">{symbol}</span>
                      {timeframe && timeframe !== '—' && (
                        <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-1.5 py-0.5 font-terminal text-xs text-[var(--text-secondary)]">
                          {timeframe}
                        </span>
                      )}
                      <Badge variant="outline" className={`border text-xs font-bold tracking-widest ${signalBg}`}>
                        {meta.label}
                      </Badge>
                      {confidence > 0 && (
                        <span className="text-xs text-[var(--text-secondary)]">{confidence}% {tr.conf}</span>
                      )}
                      {confluence !== null && (
                        <span className="text-xs text-[var(--text-secondary)]">
                          {Number(factorsPresent)}/{6} {tr.factors}
                        </span>
                      )}
                    </div>

                    {/* Price levels */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-terminal text-xs">
                      {entry !== null && (
                        <span className="text-[var(--text-secondary)]">
                          {t.analysis.entry} <span className="text-[var(--text-primary)]">{fmt(entry)}</span>
                        </span>
                      )}
                      {stopLoss !== null && (
                        <span className="text-[var(--text-secondary)]">
                          SL <span className="text-[var(--signal-sell)]">{fmt(stopLoss)}</span>
                        </span>
                      )}
                      {takeProfit1 !== null && (
                        <span className="text-[var(--text-secondary)]">
                          TP1 <span className="text-[var(--signal-buy)]">{fmt(takeProfit1)}</span>
                        </span>
                      )}
                      {takeProfit2 !== null && (
                        <span className="text-[var(--text-secondary)]">
                          TP2 <span className="text-[var(--signal-buy)]">{fmt(takeProfit2)}</span>
                        </span>
                      )}
                    </div>

                    <span className="font-terminal text-[10px] text-[var(--text-secondary)] opacity-60">
                      {new Date(a.createdAt).toLocaleString(dateLocale, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                    </span>
                  </div>

                  {/* RIGHT — verdict selector */}
                  <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                    {vcfg && (
                      <span
                        className="rounded px-2 py-0.5 font-terminal text-xs font-semibold"
                        style={{ background: vcfg.bg, border: `1px solid ${vcfg.border}`, color: vcfg.text }}
                      >
                        {verdictLabel(verdict)}
                      </span>
                    )}
                    <select
                      value={verdict ?? ''}
                      onChange={(e) => handleVerdict(a.id, (e.target.value as Verdict) || null)}
                      className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-terminal text-xs text-[var(--text-secondary)] outline-none"
                    >
                      {verdictOptions.map((o) => (
                        <option key={String(o.value)} value={o.value ?? ''}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MyTrades;
