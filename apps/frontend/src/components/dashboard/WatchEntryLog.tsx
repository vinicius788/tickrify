import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { useAPIClient, type WatchEntry, type WatchLevels } from '@/lib/api';
import { PriceTemplate } from './CopyPrice';

/**
 * "I entered this plan" num WATCH (11/11/2026). O trader registra que entrou
 * no plano; a operacao passa a aparecer no My Trades e no Diario. Stop e
 * alvo sao os do plano (o servidor relê do resultado gravado); a tela so manda
 * o plano e o preco de entrada. A leitura continua WATCH.
 */
export function WatchEntryLog({
  analysisId,
  plan,
  levels,
  entry,
  onChange,
  formatPrice,
  base,
  closed = false,
}: {
  analysisId: string;
  plan: WatchEntry['plan'];
  levels: WatchLevels;
  /** Entrada ja registrada nesta leitura. */
  entry: WatchEntry | null;
  onChange: (entry: WatchEntry | null) => void;
  formatPrice: (value: number | null) => string;
  base: string;
  closed?: boolean;
}) {
  const { t } = useLanguage();
  const w = t.analysis.result.watch;
  const { setWatchEntry, clearWatchEntry } = useAPIClient();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(levels.entry));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['analyses'] });
    void queryClient.invalidateQueries({ queryKey: ['journal'] });
  };
  const money = (n: number) => formatPrice(n).replace(/ /g, ' ');

  if (entry) {
    const undo = async () => {
      setBusy(true);
      setError(null);
      try {
        await clearWatchEntry(analysisId);
        track('watch_entry_removed', { analysisId, plan });
        onChange(null);
        refresh();
      } catch {
        setError(w.entryFailed);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div data-testid="watch-entry-logged" className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--fill-2)] px-4 py-3">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          <PriceTemplate template={entry.direction === 'long' ? w.entryLoggedBuy : w.entryLoggedSell} prices={{ price: { value: entry.entry, text: money(entry.entry) } }} />
        </p>
        <p className="tk-meta mt-0.5">{w.entryLoggedSub}</p>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <Link to={`${base}/trades`} className="text-sm font-medium text-[var(--text-primary)] underline underline-offset-4">{w.entryOpenTrades}</Link>
          <button type="button" onClick={undo} disabled={busy} className="text-sm text-[var(--text-tertiary)] underline underline-offset-4 hover:text-[var(--text-primary)] disabled:opacity-50">
            {w.entryUndo}
          </button>
        </div>
        {error ? <p role="status" className="mt-2 text-sm" style={{ color: 'var(--signal-sell)' }}>{error}</p> : null}
      </div>
    );
  }

  // Janela encerrada sem entrada registrada: nada a oferecer.
  if (closed) return null;

  if (!open) {
    return (
      <button
        type="button"
        data-testid="watch-entry-button"
        onClick={() => {
          track('watch_entry_clicked', { analysisId, plan });
          setValue(String(levels.entry));
          setError(null);
          setOpen(true);
        }}
        className="mt-4 rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
      >
        {w.entryButton}
      </button>
    );
  }

  const price = Number(value.replace(',', '.'));
  const long = levels.takeProfit1 > levels.stopLoss;
  const valid = Number.isFinite(price) && price > 0 && (long ? price > levels.stopLoss && price < levels.takeProfit1 : price < levels.stopLoss && price > levels.takeProfit1);
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await setWatchEntry(analysisId, { plan, entry: price });
      track('watch_entry_logged', { analysisId, plan });
      setOpen(false);
      onChange(saved.watchEntry);
      refresh();
    } catch {
      setError(w.entryFailed);
    } finally {
      setBusy(false);
    }
  };
  const inputId = `watch-entry-${plan}`;
  return (
    <div data-testid="watch-entry-form" className="mt-4 rounded-xl border border-[var(--border-default)] px-4 py-3">
      <p className="text-sm font-medium text-[var(--text-primary)]">{w.entryFormTitle}</p>
      <p className="tk-meta mt-0.5">{w.entryFormSub}</p>
      <label htmlFor={inputId} className="tk-meta mt-3 block">{w.entryPriceLabel}</label>
      <input
        id={inputId}
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-transparent px-3 py-2 text-base tabular-nums text-[var(--text-primary)]"
      />
      <p className="tk-meta mt-1 tabular-nums">
        <PriceTemplate
          template={w.entryPlanLine}
          prices={{
            stop: { value: levels.stopLoss, text: money(levels.stopLoss) },
            target: { value: levels.takeProfit1, text: money(levels.takeProfit1) },
          }}
        />
      </p>
      {!valid ? <p key="range" className="mt-1 text-xs" style={{ color: 'var(--signal-hold)' }}>{w.entryRange}</p> : null}
      {error ? <p key="error" role="status" className="mt-1 text-sm" style={{ color: 'var(--signal-sell)' }}>{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-[var(--text-tertiary)] underline underline-offset-4 hover:text-[var(--text-primary)]">{w.entryCancel}</button>
        <button
          type="button"
          onClick={submit}
          disabled={!valid || busy}
          className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <span key={busy ? 'saving' : 'save'}>{busy ? w.entrySaving : w.entrySave}</span>
        </button>
      </div>
    </div>
  );
}
