import { BellPlus, BellRing } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { APIError, type LevelMap, type LevelMapSide, type WatchSummary } from '@/lib/api';
import { formatAlertLevel, formatTimeLeft, isWatchOpen, useAlertActions, useSetupAlerts, type AlertLabel } from '@/lib/setups';

// WATCH pendente e mapa de niveis do NO_TRADE (03/11/2026). Arquivo proprio
// porque My Trades, Diario, Today, setups e o resultado mostram o mesmo bloco.
// Nunca acerto, P&L ou "win": o WATCH nao e operacao.

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type Surface = 'trades' | 'journal' | 'today' | 'setups' | 'setup_page' | 'result';

const sameLevel = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9;

/**
 * "Alert me at <nivel>": cria o SetupAlert de sempre (mesmas regras, tetos e
 * 402 de conta travada, conferidos no servidor) e segue o setup no mesmo clique.
 */
export function AlertLevelButton({
  analysisId,
  level,
  label,
  surface,
  kind,
  format,
}: {
  analysisId: string;
  level: number;
  label: AlertLabel;
  surface: Surface;
  kind: 'watch' | 'level_map';
  /** Formato do preco do bloco em volta; sem ele, o dos alertas. */
  format?: (value: number) => string;
}) {
  const { t, language } = useLanguage();
  const p = t.pending;
  const a = t.alerts;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const { toast } = useToast();
  const alerts = useSetupAlerts(true);
  const { create } = useAlertActions();
  const price = format ? format(level) : formatAlertLevel(level, locale);
  const active = (alerts.data?.items ?? []).some(
    (alert) => alert.status === 'active' && alert.analysisId === analysisId && sameLevel(alert.level, level),
  );

  if (active) {
    return (
      <span key="active" className="inline-flex items-center gap-1.5 font-terminal text-[11px] text-[var(--text-secondary)]">
        <BellRing className="h-3.5 w-3.5 text-[var(--accent-green)]" />
        <span>{p.alertActive.replace('{price}', price)}</span>
      </span>
    );
  }

  const onClick = () => {
    track('pending_alert_clicked', { surface, kind });
    create.mutate(
      { analysisId, label, level },
      {
        onSuccess: () => toast({ title: a.created.replace('{level}', price) }),
        onError: (error) => {
          const code = error instanceof APIError ? error.code : undefined;
          const status = error instanceof APIError ? error.status : 0;
          if (status === 402) toast({ title: p.alertPaused });
          else if (code === 'alert_limit' || code === 'alert_setup_limit' || code === 'setup_limit') toast({ title: a.limitDesc });
          else if (code === 'alert_level_out_of_range' || code === 'alert_level_at_price' || code === 'alert_level_mismatch') {
            toast({ title: a.invalidLevel, variant: 'destructive' });
          } else toast({ title: a.failed, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <button
      key="create"
      type="button"
      onClick={onClick}
      disabled={create.isPending}
      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)] disabled:opacity-60"
    >
      <BellPlus className="h-3.5 w-3.5" />
      <span>{p.alertMe.replace('{price}', price)}</span>
    </button>
  );
}

/**
 * O WATCH como item pendente: direcao e nivel, invalidacao, validade com o
 * tempo que falta e, depois da janela, o desfecho que o rastreador gravou.
 */
export function WatchPending({
  analysisId,
  watch,
  surface,
  alerts = true,
  now = Date.now(),
  alignEnd = false,
}: {
  analysisId: string;
  watch: WatchSummary;
  surface: Surface;
  /** false: so a leitura, sem o botao (demo, exemplo). */
  alerts?: boolean;
  now?: number;
  /** Coluna da direita (My Trades): alinha a direita a partir do sm. */
  alignEnd?: boolean;
}) {
  const { t, language } = useLanguage();
  const p = t.pending;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const price = (v: number) => formatAlertLevel(v, locale);
  const open = isWatchOpen(watch, now);
  const left = watch.expiresAt ? Date.parse(watch.expiresAt) - now : null;
  const validity = open && left !== null
    ? p.validLeft.replace('{n}', String(watch.validForCandles)).replace('{time}', formatTimeLeft(left, locale))
    : watch.outcome === 'pending' && watch.expiresAt === null
      ? p.validFor.replace('{n}', String(watch.validForCandles))
      : null;
  const status =
    watch.outcome === 'reached' ? p.reached
      : watch.outcome === 'expired' ? p.expired
        : watch.outcome === 'invalidated' ? p.invalidated
          : watch.outcome === 'unavailable' ? p.unavailable
            : p.statusPending;
  const closedNote = watch.outcome === 'pending' && !open && watch.expiresAt !== null ? p.windowClosed : null;

  return (
    <div data-testid="watch-pending" data-outcome={watch.outcome} className={`flex flex-col gap-1.5 ${alignEnd ? 'sm:items-end sm:text-right' : ''}`}>
      <span className="w-fit rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5 py-1 font-terminal text-[11px] text-[var(--text-secondary)]">
        {status}
      </span>
      <p className="font-terminal text-xs text-[var(--text-primary)]">
        {(watch.direction === 'long' ? p.possibleBuy : p.possibleSell).replace('{price}', price(watch.level))}
      </p>
      <p className="font-terminal text-[11px] text-[var(--text-secondary)]">
        {[p.invalidation.replace('{price}', price(watch.invalidation)), validity, closedNote].filter(Boolean).join(' · ')}
      </p>
      {alerts && open && watch.alertAvailable ? (
        <AlertLevelButton analysisId={analysisId} level={watch.level} label="entry" surface={surface} kind="watch" />
      ) : null}
    </div>
  );
}

const atrText = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** NO_TRADE com velas reais: os dois lados do preco, montados pelo codigo. Nao e sinal. */
export function LevelMapCard({
  levelMap,
  analysisId,
  alerts,
  formatPrice,
}: {
  levelMap: LevelMap;
  analysisId: string | null;
  alerts: boolean;
  formatPrice: (value: number | null) => string;
}) {
  const { t } = useLanguage();
  const p = t.pending;
  // "$ 78,310.00" nunca quebra entre o simbolo e o numero.
  const price = (v: number) => formatPrice(v).replace(/ /g, '\u00a0');
  const line = (side: LevelMapSide, up: boolean) =>
    side.next !== null && side.nextAtr !== null
      ? (up ? p.above : p.below)
          .replace('{level}', price(side.level))
          .replace('{next}', price(side.next))
          .replace('{n}', atrText(side.nextAtr))
      : (up ? p.aboveEdge : p.belowEdge).replace('{level}', price(side.level));
  const sides: Array<{ key: 'above' | 'below'; side: LevelMapSide; up: boolean }> = [];
  if (levelMap.above) sides.push({ key: 'above', side: levelMap.above, up: true });
  if (levelMap.below) sides.push({ key: 'below', side: levelMap.below, up: false });

  return (
    <section data-testid="level-map" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
      <h4 className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{p.levelMapTitle}</h4>
      <ul className="mt-2 flex flex-col gap-3">
        {sides.map(({ key, side, up }) => (
          <li key={key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="font-terminal text-sm text-[var(--text-primary)]">{line(side, up)}</p>
            {alerts && analysisId ? (
              <AlertLevelButton analysisId={analysisId} level={side.level} label="custom" surface="result" kind="level_map" format={price} />
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{p.levelMapNote}</p>
    </section>
  );
}
