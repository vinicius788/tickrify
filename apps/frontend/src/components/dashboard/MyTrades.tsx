import { useMemo, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Calculator, Check, ExternalLink, Filter, ImageOff, Maximize2, Star, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WatchPending } from './PendingLevels';
import { entrySide, getScenarioMeta, resolveSignalState, signalStateLabel, signalStateTone, type SignalStateCanonical } from '@/lib/trading-ui';
import { useAnalyses } from '@/hooks/useAnalyses';
import { asRecord } from '@/lib/utils';
import { useAPIClient } from '@/lib/api';
import type { AIAnalysisResponse } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import EmptyState from '@/components/dashboard/EmptyState';
import { PositionSizingCalculator } from '@/components/dashboard/PositionSizingCalculator';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { TradeShareButton } from '@/components/dashboard/ShareCard';
import {
  VERDICT_CFG,
  outcomeFromVerdict,
  isTradeCall,
  resolveVerdict,
  withoutPending,
  type Verdict,
} from '@/lib/verdict';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

// ── Verdict (sincronizado com o backend; localStorage = fallback offline) ────
// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(n);
}

function toLevel(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractLevels(a: AIAnalysisResponse) {
  const full = asRecord(a.fullResponse);
  const analysis = asRecord(full.analysis);
  // O GET /api/ai/analyses devolve os niveis NO TOPO da linha (entry, stopLoss,
  // takeProfit1/2) e nao manda fullResponse. So ler fullResponse.analysis fazia
  // as linhas reais sairem sem nenhum preco; so o DEMO os mostrava.
  const flat = a as unknown as Record<string, unknown>;
  return {
    symbol:      String(analysis.symbol || full.symbol || a.symbol || 'N/A').trim(),
    timeframe:   String(analysis.timeframe || full.timeframe || a.timeframe || '-').trim(),
    entry:       toLevel(analysis.entry ?? flat.entry),
    stopLoss:    toLevel(analysis.stopLoss ?? flat.stopLoss),
    takeProfit1: toLevel(analysis.takeProfit1 ?? flat.takeProfit1),
    takeProfit2: toLevel(analysis.takeProfit2 ?? flat.takeProfit2),
    confluence:  analysis.confluenceScore ?? null,
    factorsPresent: analysis.factorsPresent ?? null,
  };
}

type ClosedVerdict = 'TP1' | 'TP2' | 'SL';
const isClosed = (v: Verdict): v is ClosedVerdict => v === 'TP1' || v === 'TP2' || v === 'SL';

function omitKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

function fmtPnl(n: number): string {
  const abs = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${abs}`;
}

// ── Valor da operacao ────────────────────────────────────────────────────────
// Ganho ou perda, escolhido pelo trader. O lado vem pre-selecionado pelo
// resultado (TP = ganho, Stop = perda), mas pode ser trocado: TP1 que devolveu
// o resto no stop pode fechar no negativo. Digitar "-" tambem vira perda.
// Valor na moeda da conta do trader: nao ha simbolo de proposito.
interface PnlFieldProps {
  verdict: ClosedVerdict;
  saved: number | null;
  labels: {
    logTitle: string; logDesc: string; gain: string; loss: string;
    amountLabel: string; save: string; saving: string; edit: string;
  };
  onSave: (amount: number | null) => Promise<void>;
}

function PnlField({ verdict, saved, labels, onSave }: PnlFieldProps) {
  const [editing, setEditing] = useState(saved === null);
  const [side, setSide] = useState<'gain' | 'loss'>(
    saved !== null ? (saved < 0 ? 'loss' : 'gain') : verdict === 'SL' ? 'loss' : 'gain',
  );
  const [draft, setDraft] = useState(saved !== null ? String(Math.abs(saved)) : '');
  const [busy, setBusy] = useState(false);

  const parsed = Number(draft.replace(',', '.'));
  const valid = draft.trim() !== '' && Number.isFinite(parsed);

  const handleChange = (raw: string) => {
    // "-" digitado vira o lado de perda; o numero fica sempre positivo no campo.
    if (raw.trim().startsWith('-')) {
      setSide('loss');
      setDraft(raw.trim().slice(1));
      return;
    }
    setDraft(raw);
  };

  const submit = async () => {
    if (!valid) return;
    const amount = side === 'loss' ? -Math.abs(parsed) : Math.abs(parsed);
    setBusy(true);
    try {
      await onSave(amount);
      setEditing(false);
    } catch {
      // o toast ja foi mostrado por quem chamou; o campo continua aberto
    } finally {
      setBusy(false);
    }
  };

  if (!editing && saved !== null) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{labels.logTitle}</p>
          <p
            className="font-terminal text-xl font-semibold"
            style={{ color: saved < 0 ? 'var(--signal-sell)' : 'var(--signal-buy)' }}
          >
            {fmtPnl(saved)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]"
        >
          {labels.edit}
        </button>
      </div>
    );
  }

  const sideBtn = (value: 'gain' | 'loss') => {
    const active = side === value;
    const color = value === 'gain' ? 'var(--signal-buy)' : 'var(--signal-sell)';
    return (
      <button
        key={value}
        type="button"
        data-active={active}
        aria-pressed={active}
        onClick={() => setSide(value)}
        className="tk-verdict-btn flex-1 rounded-md border px-3 py-1.5 font-terminal text-xs font-semibold"
        style={
          active
            ? { color, borderColor: color, background: value === 'gain' ? 'var(--signal-buy-bg)' : 'var(--signal-sell-bg)' }
            : { color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)', background: 'var(--bg-overlay)' }
        }
      >
        {value === 'gain' ? `+ ${labels.gain}` : `− ${labels.loss}`}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{labels.logTitle}</p>
        <p className="text-xs text-[var(--text-secondary)]">{labels.logDesc}</p>
      </div>
      <div className="flex gap-2">
        {sideBtn('gain')}
        {sideBtn('loss')}
      </div>
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 focus-within:border-[var(--signal-buy)]">
          <span
            className="font-terminal text-base font-semibold"
            style={{ color: side === 'loss' ? 'var(--signal-sell)' : 'var(--signal-buy)' }}
          >
            {side === 'loss' ? '−' : '+'}
          </span>
          {/* 16px de proposito: abaixo disso o iPhone da zoom no campo ao digitar
              e a pagina inteira balanca. Nao voltar para text-sm. */}
          <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="0.00"
            aria-label={labels.amountLabel}
            className="w-full bg-transparent px-1.5 py-1.5 font-terminal text-base text-[var(--text-primary)] outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || busy}
          className="tk-verdict-btn min-w-[88px] shrink-0 rounded-md bg-[var(--inverse-bg)] px-4 py-1.5 text-xs font-semibold text-[var(--inverse-fg)] disabled:opacity-40"
        >
          {busy ? labels.saving : labels.save}
        </button>
      </div>
    </div>
  );
}

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
/** 'favorites' mostra so as analises com estrela (antes era a aba Watchlist); `state:` filtra pelo estado do copiloto. */
type TradesFilter = 'all' | 'pending' | 'favorites' | `state:${SignalStateCanonical}` | Verdict;
const STATE_FILTERS: readonly SignalStateCanonical[] = ['ENTER_NOW', 'ARMED', 'WATCH', 'NO_TRADE'];

const stateOf = (a: AIAnalysisResponse): SignalStateCanonical => {
  const full = asRecord(a.fullResponse);
  const analysis = asRecord(full.analysis);
  return resolveSignalState(a.signalState ?? full.signalState, a.recommendation, analysis.entryType, analysis.alternativeScenario);
};

interface MyTradesProps {
  onStartAnalysis?: () => void;
  /** Filtro pré-aplicado ao abrir — usado pelo "ver todas" do bloco de cobrança. */
  initialFilter?: TradesFilter;
}

const MyTrades = ({ onStartAnalysis, initialFilter }: MyTradesProps) => {
  const { user } = useUser();
  const isDemo = !user;
  // Mesmo limite do Dashboard (40) → as três telas compartilham UM único cache
  // do React Query. Assim esta aba abre na hora (reaproveita o que já foi
  // carregado) em vez de disparar uma nova busca de 100 registros no servidor.
  const { analyses, loading, hasMore, loadingMore, loadMore, refetch } = useAnalyses(40);
  const { setOutcome, setFavorite } = useAPIClient();
  const { t, language } = useLanguage();
  const tr = t.trades;
  const dateLocale = DATE_LOCALES[language] ?? 'en-US';
  const { toast } = useToast();
  const resultButtons: Array<{ value: ClosedVerdict; short: string; label: string }> = [
    { value: 'TP1', short: 'TP1', label: tr.tp1Hit },
    { value: 'TP2', short: 'TP2', label: tr.tp2Hit },
    { value: 'SL', short: 'Stop', label: tr.slHit },
  ];

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterVerdict, setFilterVerdict] = useState<TradesFilter>(initialFilter ?? 'all');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  // Valor da operacao alterado nesta tela (sobrepoe o que veio do banco ate o refetch).
  const [pnls, setPnls] = useState<Record<string, number | null>>({});
  const [calcOpen, setCalcOpen] = useState<Record<string, boolean>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);

  const getPnl = (a: AIAnalysisResponse): number | null => {
    if (Object.prototype.hasOwnProperty.call(pnls, a.id)) return pnls[a.id];
    const n = Number(a.pnlAmount);
    return a.pnlAmount !== null && a.pnlAmount !== undefined && Number.isFinite(n) ? n : null;
  };

  const rows = isDemo ? DEMO : analyses.filter((a) => a.status === 'completed');

  // Verdict efetivo — mesma função usada pelo Dashboard (lib/verdict.ts).
  const getVerdict = (a: AIAnalysisResponse): Verdict => isTradeCall(a.recommendation, stateOf(a)) ? resolveVerdict(a, verdicts) : null;

  // Estrela alterada nesta tela vale ate o refetch confirmar; depois, a do banco.
  const getFavorite = (a: AIAnalysisResponse): boolean => {
    if (Object.prototype.hasOwnProperty.call(favorites, a.id)) {
      return favorites[a.id];
    }
    return (a as unknown as Record<string, unknown>).isFavorite === true;
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
      if (filterVerdict === 'favorites') return getFavorite(a);
      if (typeof filterVerdict === 'string' && filterVerdict.startsWith('state:')) return `state:${stateOf(a)}` === filterVerdict;
      const v = getVerdict(a);
      if (filterVerdict === 'pending' && (v !== null || !isTradeCall(a.recommendation, stateOf(a)))) return false;
      if (filterVerdict !== 'all' && filterVerdict !== 'pending' && v !== filterVerdict) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, verdicts, favorites, filterSymbol, filterVerdict]);

  // Resumo de performance (a partir das análises carregadas).
  const perf = useMemo(() => {
    let wins = 0, losses = 0, open = 0, pending = 0, rrSum = 0, rrCount = 0, pnlSum = 0, pnlCount = 0;
    for (const a of rows) {
      if (!isTradeCall(a.recommendation, stateOf(a))) continue;
      const v = getVerdict(a);
      const pnl = isClosed(v) ? getPnl(a) : null;
      if (pnl !== null) { pnlSum += pnl; pnlCount += 1; }
      if (v === 'TP1' || v === 'TP2') wins += 1;
      else if (v === 'SL') losses += 1;
      else if (v === 'OPEN') open += 1;
      // Aguardar (WAIT/HOLD) nao e operacao: nunca fica "pendente" de resultado.
      // Entrada nao atingida tambem nao: nao houve trade, nao entra em nada.
      else if (v === null) pending += 1;
      const rr = Number((a as unknown as Record<string, unknown>).riskRewardTp2 ?? (a as unknown as Record<string, unknown>).riskRewardTp1);
      if (Number.isFinite(rr) && rr > 0) { rrSum += rr; rrCount += 1; }
    }
    const decided = wins + losses;
    return {
      wins, losses, open, pending,
      pnlTotal: pnlCount > 0 ? Math.round(pnlSum * 100) / 100 : null,
      pnlCount,
      winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
      avgRr: rrCount > 0 ? Math.round((rrSum / rrCount) * 100) / 100 : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, verdicts, pnls]);

  // O backend grava resultado E valor juntos (o UPDATE sobrescreve os dois), entao
  // toda escrita leva o par. Trocar o resultado preserva o valor ja informado;
  // voltar para aberto/pendente o apaga, porque trade sem fechamento nao tem P&L.
  const handleVerdict = (a: AIAnalysisResponse, v: Verdict) => {
    const nextPnl = isClosed(v) ? getPnl(a) : null;
    setVerdicts((prev) => ({ ...prev, [a.id]: v }));
    setPnls((prev) => ({ ...prev, [a.id]: nextPnl }));
    if (isDemo) return;
    // Servidor e a fonte da verdade (lib/verdict.ts): confirmada a gravacao e
    // relida a lista, a marcacao otimista sai; se ele recusar, a tela desfaz.
    const settle = () => {
      setVerdicts((prev) => withoutPending(prev, a.id));
      setPnls((prev) => omitKey(prev, a.id));
    };
    void setOutcome(a.id, { outcome: outcomeFromVerdict(v), pnlAmount: nextPnl })
      .then(() => refetch())
      .then(settle)
      .catch(() => {
        settle();
        toast({ title: tr.resultSaveFailed, variant: 'destructive' });
      });
  };

  const handleSavePnl = async (a: AIAnalysisResponse, amount: number | null) => {
    const v = getVerdict(a);
    if (!isDemo) {
      try {
        await setOutcome(a.id, { outcome: outcomeFromVerdict(v), pnlAmount: amount });
      } catch (err) {
        toast({ title: tr.saveFailed, variant: 'destructive' });
        throw err;
      }
      // So devolve depois da lista relida: o campo fecha ja mostrando o valor
      // que o servidor gravou.
      await refetch();
      setPnls((prev) => omitKey(prev, a.id));
      return;
    }
    setPnls((prev) => ({ ...prev, [a.id]: amount }));
  };

  // ── Favoritos: estrela no card + filtro "Favoritas" (substituiu a aba
  // Watchlist em 24/09/2026). Otimista, com rollback se o backend falhar.
  const handleFavorite = (a: AIAnalysisResponse) => {
    if (isDemo) return;
    const next = !getFavorite(a);
    setFavorites((prev) => ({ ...prev, [a.id]: next }));
    void setFavorite(a.id, next)
      .then(() => {
        // Invalida o cache da lista para o filtro de favoritas e o painel refletirem na hora.
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
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">{t.productClarity.personalMetrics}</p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <select
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-terminal text-base text-[var(--text-primary)] outline-none sm:text-xs"
            >
              <option value="">{tr.allAssets}</option>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterVerdict ?? 'all'}
              onChange={(e) => setFilterVerdict(e.target.value as typeof filterVerdict)}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-terminal text-base text-[var(--text-primary)] outline-none sm:text-xs"
            >
              <option value="all">{tr.allResults}</option>
              <option value="favorites">{tr.favorites}</option>
              <option value="pending">{tr.pending}</option>
              <option value="TP1">{tr.tp1Hit}</option>
              <option value="TP2">{tr.tp2Hit}</option>
              <option value="SL">{tr.slHit}</option>
              <option value="OPEN">{tr.open}</option>
              <option value="NO_FILL">{tr.noFill}</option>
              {STATE_FILTERS.map((st) => (
                <option key={st} value={`state:${st}`}>{t.analysis.states[st]}</option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* ── Resumo de performance ─────────────────────────────── */}
        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-px border-y border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-5">
            <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.winRate}</p>
              <p className="font-terminal text-lg font-semibold text-[var(--signal-buy)]">
                {perf.winRate !== null ? `${perf.winRate}%` : '-'}
              </p>
              <p className="font-terminal text-[10px] text-[var(--text-secondary)]">{perf.wins}{tr.winShort} / {perf.losses}{tr.lossShort}</p>
            </div>
            <div className="bg-[var(--bg-surface)] px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.avgRr}</p>
              <p className="font-terminal text-lg font-semibold text-[var(--text-primary)]">
                {perf.avgRr !== null ? `${perf.avgRr.toFixed(1)}:1` : '-'}
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
            <div className="col-span-2 bg-[var(--bg-surface)] px-3 py-2.5 text-center sm:col-span-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.loggedPnl}</p>
              <p
                className="font-terminal text-lg font-semibold"
                style={{
                  color: perf.pnlTotal === null
                    ? 'var(--text-secondary)'
                    : perf.pnlTotal < 0 ? 'var(--signal-sell)' : 'var(--signal-buy)',
                }}
              >
                {perf.pnlTotal !== null ? fmtPnl(perf.pnlTotal) : '-'}
              </p>
              <p className="font-terminal text-[10px] text-[var(--text-secondary)]">
                {perf.pnlTotal !== null ? tr.loggedPnlSub.replace('{n}', String(perf.pnlCount)) : tr.noPnlSub}
              </p>
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
              const scenario = getScenarioMeta(a.bias ?? asRecord(a.fullResponse).bias, a.recommendation);
              const state = stateOf(a);
              const stateTone = signalStateTone(state, a.recommendation);
              const verdict = getVerdict(a);
              const closed = isClosed(verdict);
              // Aguardar sem resultado marcado: nada a marcar. Se um WAIT ja tiver
              // resultado (marcado antes desta regra), os botoes seguem visiveis
              // para a pessoa poder limpar.
              const noTrade = !isTradeCall(a.recommendation, stateOf(a)) && verdict === null;
              const hasLevels = entry !== null && stopLoss !== null && entry !== stopLoss;
              const showCalc = hasLevels && calcOpen[a.id] === true;
              const imageUrl = typeof a.imageUrl === 'string' && a.imageUrl.trim() ? a.imageUrl : null;
              const imageBroken = brokenImages[a.id] === true;
              const chartTitle = `${symbol}${timeframe && timeframe !== '-' ? ` · ${timeframe}` : ''}`;
              const toggleCalc = () => setCalcOpen((prev) => ({ ...prev, [a.id]: !prev[a.id] }));

              const signalBg = stateTone === 'buy'
                ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
                : stateTone === 'sell'
                  ? 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
                  : 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]';

              return (
                <div key={a.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">

                    {/* Print do grafico enviado. Clique abre em tamanho grande. */}
                    <button
                      type="button"
                      onClick={() => imageUrl && !imageBroken && setViewer({ url: imageUrl, title: chartTitle })}
                      disabled={!imageUrl || imageBroken}
                      aria-label={`${tr.viewChart}: ${chartTitle}`}
                      title={imageUrl && !imageBroken ? tr.viewChart : undefined}
                      className="group relative h-20 w-full shrink-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] transition-colors enabled:hover:border-[var(--text-secondary)] sm:h-[72px] sm:w-28"
                    >
                      {imageUrl && !imageBroken ? (
                        <>
                          <img
                            src={imageUrl}
                            alt={chartTitle}
                            loading="lazy"
                            width={112}
                            height={72}
                            onError={() => setBrokenImages((prev) => ({ ...prev, [a.id]: true }))}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-[var(--scrim-soft)] opacity-0 transition-opacity group-hover:opacity-100">
                            <Maximize2 className="h-4 w-4 text-[var(--on-scrim)]" />
                          </span>
                        </>
                      ) : (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-[10px] leading-tight text-[var(--text-secondary)]">
                          <ImageOff className="h-4 w-4" />
                          {imageBroken ? tr.chartUnavailable : tr.noChart}
                        </span>
                      )}
                    </button>

                    {/* MEIO — sinal + meta */}
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
                              className={`h-4 w-4 ${getFavorite(a) ? 'fill-[var(--tone-star)] text-[var(--tone-star)]' : 'text-[var(--text-secondary)]'}`}
                            />
                          </button>
                        )}
                        <span className="font-terminal font-bold text-[var(--text-primary)]">{symbol}</span>
                        {timeframe && timeframe !== '-' && (
                          <span className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-1.5 py-0.5 font-terminal text-xs text-[var(--text-secondary)]">
                            {timeframe}
                          </span>
                        )}
                        <Badge variant="outline" className={`border text-xs font-bold uppercase tracking-widest ${signalBg}`}>
                          {signalStateLabel(t.analysis, state, entrySide(asRecord(a.fullResponse).watchPlan, a.recommendation))}
                        </Badge>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {t.analysis.bias}: <span className="font-semibold text-[var(--text-primary)]">{scenario.label}</span>
                        </span>
                        {confluence !== null && (
                          <span className="text-xs text-[var(--text-secondary)]">
                            {`${Number(factorsPresent)}/7 ${tr.factors}`}
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

                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-terminal text-[10px] text-[var(--text-secondary)] opacity-60">
                          {new Date(a.createdAt).toLocaleString(dateLocale, { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                        </span>
                        {hasLevels && (
                          <button
                            type="button"
                            onClick={toggleCalc}
                            aria-expanded={showCalc}
                            className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                          >
                            <Calculator className="h-3 w-3" />
                            {tr.calcToggle}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* DIREITA — resultado: TP1 / TP2 / Stop */}
                    {noTrade && a.watch && !isDemo ? (
                      <div className="flex-shrink-0 sm:max-w-[260px]">
                        <WatchPending analysisId={a.id} watch={a.watch} surface="trades" alignEnd />
                      </div>
                    ) : noTrade ? (
                      <div className="flex flex-shrink-0 flex-col gap-1 sm:items-end">
                        <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-1.5 font-terminal text-xs text-[var(--text-secondary)]">
                          {tr.noTrade}
                        </span>
                        <span className="text-[11px] text-[var(--text-secondary)] opacity-70 sm:text-right">{tr.noTradeHint}</span>
                      </div>
                    ) : (
                      <div className="flex flex-shrink-0 flex-col gap-1.5 sm:items-end">
                        <span className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">{tr.markResult}</span>
                        <div className="flex gap-1.5">
                          {resultButtons.map((b) => {
                            const active = verdict === b.value;
                            const c = VERDICT_CFG[b.value];
                            return (
                              <button
                                key={b.value}
                                type="button"
                                data-active={active}
                                aria-pressed={active}
                                aria-label={b.label}
                                title={b.label}
                                onClick={() => handleVerdict(a, active ? null : b.value)}
                                className="tk-verdict-btn inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-3 py-1.5 font-terminal text-xs font-semibold sm:flex-none"
                                style={
                                  active
                                    ? { background: c.bg, borderColor: c.border, color: c.text, boxShadow: `0 0 16px ${c.border}` }
                                    : { background: 'var(--bg-overlay)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                                }
                              >
                                {active && <Check className="h-3 w-3" />}
                                {b.short}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-3 text-[11px]">
                          <button
                            type="button"
                            onClick={() => handleVerdict(a, verdict === 'OPEN' ? null : 'OPEN')}
                            aria-pressed={verdict === 'OPEN'}
                            className="transition-colors hover:text-[var(--text-primary)]"
                            style={{ color: verdict === 'OPEN' ? VERDICT_CFG.OPEN.text : 'var(--text-secondary)' }}
                          >
                            {verdict === 'OPEN' ? `● ${tr.open}` : tr.markOpen}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleVerdict(a, verdict === 'NO_FILL' ? null : 'NO_FILL')}
                            aria-pressed={verdict === 'NO_FILL'}
                            className="transition-colors hover:text-[var(--text-primary)]"
                            style={{ color: verdict === 'NO_FILL' ? VERDICT_CFG.NO_FILL.text : 'var(--text-secondary)' }}
                          >
                            {verdict === 'NO_FILL' ? `● ${tr.noFill}` : tr.noFill}
                          </button>
                          {verdict !== null && (
                            <button
                              type="button"
                              onClick={() => handleVerdict(a, null)}
                              className="text-[var(--text-secondary)] opacity-70 transition-opacity hover:opacity-100"
                            >
                              {tr.clearResult}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Painel: valor da operacao + calculadora de posicao */}
                  {(closed || showCalc) && (
                    <div className={`tk-verdict-panel mt-3 grid gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 ${closed && showCalc ? 'md:grid-cols-2' : ''}`}>
                      {closed && (
                        <div className="space-y-2">
                          <PnlField
                            key={`${a.id}-${verdict}`}
                            verdict={verdict}
                            saved={getPnl(a)}
                            labels={tr}
                            onSave={(amount) => handleSavePnl(a, amount)}
                          />
                          {hasLevels && !showCalc && (
                            <button
                              type="button"
                              onClick={toggleCalc}
                              className="inline-flex items-start gap-1.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                            >
                              <Calculator className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="underline decoration-dotted underline-offset-2">{tr.calcNudge}</span>
                            </button>
                          )}
                          {!isDemo && (
                            <div>
                              <TradeShareButton
                                analysisId={a.id}
                                trade={{
                                  symbol,
                                  side: entrySide(asRecord(a.fullResponse).watchPlan, a.recommendation),
                                  verdict,
                                  pnlAmount: getPnl(a),
                                  pnlPercent: typeof a.pnlPercent === 'number' && Number.isFinite(a.pnlPercent) ? a.pnlPercent : null,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      {showCalc && (
                        <PositionSizingCalculator entry={entry} stopLoss={stopLoss} defaultOpen />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Historico paginado. Sem isto o usuario so alcancava a primeira pagina:
            uma conta com centenas de analises exibia 40 e o resto era invisivel.
            O botao some sozinho quando a ultima pagina chega incompleta. */}
        {hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {loadingMore ? tr.loadingMore : tr.loadMore}
            </button>
          </div>
        )}
      </CardContent>

      {/* Visualizador da print. A URL e assinada (vale 1h); se expirar, o onError
          da miniatura ja marca como indisponivel e o refetch traz uma nova. */}
      <Dialog open={viewer !== null} onOpenChange={(open) => { if (!open) setViewer(null); }}>
        <DialogContent className="max-w-5xl border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
          <DialogTitle className="font-terminal text-sm text-[var(--text-primary)]">{viewer?.title}</DialogTitle>
          <DialogDescription className="sr-only">{tr.viewChart}</DialogDescription>
          {viewer && (
            <>
              <img
                src={viewer.url}
                alt={viewer.title}
                className="max-h-[75vh] w-full rounded-md object-contain"
              />
              <a
                href={viewer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 justify-self-start text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {tr.openFull}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default MyTrades;
