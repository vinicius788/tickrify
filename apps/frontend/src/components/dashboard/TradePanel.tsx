import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { useIncrementAnalysis } from '@/hooks/useAnalysisLimit';
import {
  APIError,
  displayAsset,
  tradeQueryKey,
  useAPIClient,
  type TradeAction,
  type TradeCheckResult,
  type TradeCloseReason,
  type TradeSituation,
  type TradeStatus,
  type TradeView,
} from '@/lib/api';

/** Mesma constante do servidor (TRADE_RULES.managementCheckCost): so para o texto. */
const CHECK_COST = 1;
const OPEN: TradeStatus[] = ['pending_order', 'in_trade'];


const parsePrice = (value: string): number | null => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Estado da operacao na tela da analise (13/10/2026): "Order pending", "I'm in
 * this trade" (com o preco real de entrada) e "Close trade" (motivo em lista
 * fechada), a linha do tempo e a conferencia com um grafico novo (modo
 * gerenciamento). So BUY/SELL da propria pessoa. O resultado do My Trades e o
 * mesmo dado: marcar aqui aparece la, e vice-versa.
 */
const TradePanel = ({ analysisId }: { analysisId: string }) => {
  const { t, language } = useLanguage();
  const tr = t.trade;
  const api = useAPIClient();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const refreshUsage = useIncrementAnalysis();
  const [entry, setEntry] = useState('');
  const [askEntry, setAskEntry] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState<TradeCloseReason>('target_hit');
  const [file, setFile] = useState<File | null>(null);
  const [currentPrice, setCurrentPrice] = useState('');
  const [lastCheck, setLastCheck] = useState<TradeCheckResult | null>(null);

  const query = useQuery({ queryKey: tradeQueryKey(analysisId), queryFn: () => api.getTrade(analysisId), retry: false });

  const onError = (error: unknown) => {
    const message = error instanceof APIError ? error.message : '';
    toast({ title: tr.error, description: message || undefined, variant: 'destructive' });
  };
  const applyView = (view: TradeView) => {
    queryClient.setQueryData(tradeQueryKey(analysisId), view);
    // My Trades, diario e a lista de operacoes abertas leem o mesmo dado.
    void queryClient.invalidateQueries({ queryKey: ['analyses'] });
    void queryClient.invalidateQueries({ queryKey: ['trades-open'] });
  };

  const mark = useMutation({
    mutationFn: (body: Parameters<typeof api.markTrade>[1]) => api.markTrade(analysisId, body),
    onSuccess: (view) => {
      applyView(view);
      setAskEntry(false);
      setClosing(false);
    },
    onError,
  });
  const check = useMutation({
    mutationFn: () =>
      api.checkTrade(analysisId, {
        imageFile: file ?? undefined,
        currentPrice: parsePrice(currentPrice),
        userLanguage: language,
      }),
    onSuccess: ({ result, view }) => {
      setLastCheck(result);
      applyView(view);
      refreshUsage();
    },
    onError,
  });

  const view = query.data;
  if (query.isLoading || query.isError || !view) return null;

  const statusLabel: Record<TradeStatus, string> = {
    suggested: tr.statusSuggested,
    pending_order: tr.statusPending,
    in_trade: tr.statusInTrade,
    closed: tr.statusClosed,
    cancelled: tr.statusCancelled,
    expired: tr.statusExpired,
  };
  const reasonLabel: Record<TradeCloseReason, string> = {
    target_hit: tr.reasonTarget,
    stop_hit: tr.reasonStop,
    breakeven: tr.reasonBreakeven,
    manual: tr.reasonManual,
    invalidated: tr.reasonInvalidated,
    cancelled: tr.reasonCancelled,
  };
  const situationLabel: Record<TradeSituation, string> = {
    on_track: tr.sitOnTrack,
    near_target: tr.sitNearTarget,
    near_stop: tr.sitNearStop,
    invalidated: tr.sitInvalidated,
    target_hit: tr.sitTargetHit,
    stop_hit: tr.sitStopHit,
    unclear: tr.sitUnclear,
  };
  const actionLabel: Record<TradeAction, string> = {
    hold: tr.actHold,
    move_stop_to_breakeven: tr.actBreakeven,
    partial_exit: tr.actPartial,
    exit: tr.actExit,
    cancel_order: tr.actCancel,
    wait: tr.actWait,
  };
  const busy = mark.isPending || check.isPending;
  const isOpen = OPEN.includes(view.status);
  const shown = lastCheck ?? view.checks[0]?.result ?? null;
  // A typed-price comparison proves a threshold relation, not a pending-order fill.
  let shownSituationLabel = shown ? situationLabel[shown.situation] : '';
  if (view.status === 'pending_order' && shown?.decidedByPrice) {
    if (shown.situation === 'target_hit') shownSituationLabel = tr.reportedPriceAtTarget;
    if (shown.situation === 'stop_hit') shownSituationLabel = tr.reportedPriceAtStop;
  }
  const inputClass =
    'h-10 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-primary)] sm:w-44';

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          <span>{`${tr.title} · ${displayAsset(view.symbol)} ${view.direction}`}</span>
        </p>
        <span className="rounded-full border border-[var(--border-default)] px-3 py-1 font-terminal text-xs text-[var(--text-secondary)]">
          <span key={view.status}>
            {view.closeReason && view.status === 'closed'
              ? `${statusLabel[view.status]} · ${reasonLabel[view.closeReason]}`
              : statusLabel[view.status]}
          </span>
        </span>
      </div>

      {/* Marcar estado */}
      {view.status === 'suggested' || view.status === 'pending_order' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {view.status === 'suggested' ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => mark.mutate({ status: 'pending_order' })}>
                {tr.markPending}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={busy} onClick={() => setAskEntry(true)}>
              {tr.markIn}
            </Button>
            {view.status === 'pending_order' ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => mark.mutate({ status: 'cancelled' })}>
                {tr.cancelOrder}
              </Button>
            ) : null}
          </div>
          {askEntry ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                {tr.entryPrice}
                <input
                  inputMode="decimal"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  placeholder={view.plannedEntry ? String(view.plannedEntry) : tr.entryPricePlaceholder}
                  className={inputClass}
                />
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const price = parsePrice(entry);
                  mark.mutate(price ? { status: 'in_trade', entryPrice: price } : { status: 'in_trade' });
                }}
              >
                {tr.save}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {view.status === 'in_trade' ? (
        closing ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              {tr.closeReason}
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as TradeCloseReason)}
                className={inputClass}
              >
                {(['target_hit', 'stop_hit', 'breakeven', 'manual', 'invalidated'] as TradeCloseReason[]).map((r) => (
                  <option key={r} value={r}>
                    {reasonLabel[r]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => mark.mutate({ status: 'closed', closeReason: reason })}>
                {tr.save}
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setClosing(false)}>
                {tr.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setClosing(true)}>
              {tr.closeTrade}
            </Button>
          </div>
        )
      ) : null}

      {/* Conferencia com grafico novo (modo gerenciamento) */}
      {isOpen ? (
        <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{tr.checkTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{tr.checkHint}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={tr.checkTitle}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-[var(--text-secondary)]"
            />
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              {tr.currentPrice}
              <input inputMode="decimal" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} className={inputClass} />
            </label>
            <Button type="button" size="sm" disabled={busy || !file || view.checksLeft <= 0} onClick={() => check.mutate()}>
              {check.isPending ? (
                <span key="checking" className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{tr.checking}</span>
                </span>
              ) : (
                <span key="cta">{tr.checkCta}</span>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)]">
            {tr.checksLeft.replace('{n}', String(view.checksLeft)).replace('{cost}', String(CHECK_COST))}
          </p>
        </div>
      ) : null}

      {shown ? (
        <div className="flex flex-col gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3 text-sm">
          <p className="font-semibold text-[var(--text-primary)]">
            <span>{`${shownSituationLabel} · ${tr.suggested}: ${actionLabel[shown.action]}`}</span>
          </p>
          <p className="text-[var(--text-secondary)]">{shown.reason}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            <span>{`${tr.watch}: ${shown.watch}`}</span>
          </p>
          {shown.decidedByPrice ? <p className="text-xs text-[var(--text-secondary)]">{tr.decidedByPrice}</p> : null}
          {shown.needsCurrentPrice ? <p className="text-xs text-[var(--tone-warn-3)]">{tr.needsPrice}</p> : null}
        </div>
      ) : null}

      {view.timeline.length > 0 ? (
        <div>
          <p className="tk-stat-label mb-2">{tr.timeline}</p>
          <ol className="flex flex-col gap-1">
            {view.timeline.map((step, index) => (
              <li key={`${step.at}-${index}`} className="font-terminal text-xs text-[var(--text-secondary)]">
                {`${new Date(step.at).toLocaleString()} · ${statusLabel[step.status]}${
                  step.entryPrice ? ` · ${tr.entryPrice} ${step.entryPrice}` : ''
                }${step.closeReason && step.status === 'closed' ? ` · ${reasonLabel[step.closeReason]}` : ''}`}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
};

export default TradePanel;
