import { useNavigate } from 'react-router-dom';
import { BellPlus, BellRing } from 'lucide-react';
import { formatNumber } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { APIError, type LevelMap, type LevelMapSide, type WatchSummary } from '@/lib/api';
import { formatAlertLevel, formatTimeLeft, hasActiveLevel, useExpiryClock, useAlertOptions, useSetupActions, isWatchOpen, useAlertActions, useSetupAlerts, type AlertLabel } from '@/lib/setups';

// WATCH pendente e mapa de niveis do NO_TRADE (03/11/2026). Arquivo proprio
// porque My Trades, Diario, Today, setups e o resultado mostram o mesmo bloco.
// Nunca acerto, P&L ou "win": o WATCH nao e operacao.

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type Surface = 'trades' | 'journal' | 'today' | 'setups' | 'setup_page' | 'result';

/**
 * "Alert me at <nivel>": cria o SetupAlert de sempre (mesmas regras, tetos e
 * 402 de conta travada, conferidos no servidor) e segue o setup no mesmo clique.
 */
function AlertLevelButton({
  analysisId,
  setupId,
  level,
  label,
  surface,
  kind,
  format,
}: {
  analysisId: string;
  setupId?: string | null;
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
  const active = hasActiveLevel(alerts.data?.items ?? [], setupId, analysisId, level);

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
    if (surface === 'result') track('next_step_clicked', { step: 'alert' });
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
  now: fixedNow,
  waitingFor,
  alignEnd = false,
}: {
  analysisId: string;
  watch: WatchSummary;
  surface: Surface;
  /** false: so a leitura, sem o botao (demo, exemplo). */
  alerts?: boolean;
  now?: number;
  waitingFor?: string | null;
  /** Coluna da direita (My Trades): alinha a direita a partir do sm. */
  alignEnd?: boolean;
}) {
  const { t, language } = useLanguage();
  const p = t.pending;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const price = (v: number) => formatAlertLevel(v, locale);
  const now = useExpiryClock(Date.parse(watch.expiresAt ?? ''), fixedNow);
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
  // Janela fechada: so o nivel e a direcao, sem mandar esperar algo que ja passou.
  const closed = watch.outcome !== 'pending' || closedNote !== null;
  const levelLine = closed
    ? (watch.direction === 'long' ? p.buyLevel : p.sellLevel)
    : (watch.direction === 'long' ? p.possibleBuy : p.possibleSell);

  return (
    <div data-testid="watch-pending" data-outcome={watch.outcome} className={`flex flex-col gap-1.5 ${alignEnd ? 'sm:items-end sm:text-right' : ''}`}>
      <span className="w-fit rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5 py-1 font-terminal text-[11px] text-[var(--text-secondary)]">
        {closedNote ?? status}
      </span>
      <p className="font-terminal text-xs text-[var(--text-primary)]">
        {levelLine.replace('{price}', price(watch.level))}
      </p>
      {!closed && waitingFor && <p className="text-xs text-[var(--text-secondary)]">{waitingFor}</p>}
      {!closed && <p className="font-terminal text-[11px] text-[var(--text-secondary)]">
        {[p.invalidation.replace('{price}', price(watch.invalidation)), validity].filter(Boolean).join(' · ')}
      </p>}
      {alerts && open && watch.alertAvailable ? (
        <AlertLevelButton analysisId={analysisId} setupId={watch.setupId} level={watch.level} label="entry" surface={surface} kind="watch" />
      ) : null}
    </div>
  );
}

export function WatchNextSteps({ analysisId, watch }: { analysisId: string; watch: WatchSummary }) {
  const { t } = useLanguage();
  const options = useAlertOptions(analysisId);
  const { follow } = useSetupActions();
  const navigate = useNavigate();
  const { toast } = useToast();
  const now = useExpiryClock(Date.parse(watch.expiresAt ?? ''));
  if (!isWatchOpen(watch, now)) return null;
  if (options.error instanceof APIError && options.error.status === 402) return <p>{t.pending.alertPaused}</p>;
  if (!options.data) return null;
  const { available, setupId } = options.data;
  const update = () => {
    track('next_step_clicked', { step: 'update_chart' });
    const open = (id: string) => navigate('/dashboard/new?setup=' + encodeURIComponent(id));
    if (setupId) open(setupId);
    else follow.mutate(analysisId, {
      onSuccess: ({ setup }) => open(setup.id),
      onError: (error) => toast({ title: error instanceof APIError && error.status === 402 ? t.pending.alertPaused : t.setups.followFailed }),
    });
  };
  return <section className="space-y-2 rounded-xl border p-4">
    <h3 className="font-semibold">{t.pending.nextSteps}</h3>
    {!available && <p>{t.alerts.unavailable}</p>}
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {available && <li><AlertLevelButton analysisId={analysisId} setupId={setupId} level={watch.level} label="entry" surface="result" kind="watch" /><p>{t.pending.cadence}</p></li>}
      <li>{available && <p>{t.pending.fresh}</p>}<button className="underline" onClick={update} disabled={follow.isPending}>{t.alerts.updateChart}</button></li>
      <li>{t.pending.review}</li>
    </ol>
  </section>;
}

function MapAlertButton({ analysisId, level, format, first }: { first: boolean; analysisId: string; level: number; format: (value: number) => string }) {
  const { t } = useLanguage();
  const options = useAlertOptions(analysisId);
  if (options.error instanceof APIError && options.error.status === 402) return first ? <span>{t.pending.alertPaused}</span> : null;
  if (options.data && !options.data.available) return first ? <span>{t.alerts.unavailable}</span> : null;
  if (!options.data?.available || options.isError) return null;
  return <div><AlertLevelButton analysisId={analysisId} setupId={options.data.setupId} level={level} label="custom" surface="result" kind="level_map" format={format} />{first && <p className="text-xs">{t.pending.cadence}</p>}</div>;
}

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
  const { t, language } = useLanguage();
  const p = t.pending;
  // "$ 78,310.00" nunca quebra entre o simbolo e o numero.
  const price = (v: number) => formatPrice(v).replace(/ /g, '\u00a0');
  const line = (side: LevelMapSide, up: boolean) =>
    side.next !== null && side.nextAtr !== null
      ? (up ? p.above : p.below)
          .replace('{level}', price(side.level))
          .replace('{next}', price(side.next))
          .replace('{n}', formatNumber(Math.round(side.nextAtr * 10) / 10, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
      : (up ? p.aboveEdge : p.belowEdge).replace('{level}', price(side.level));
  const sides: Array<{ key: 'above' | 'below'; side: LevelMapSide; up: boolean }> = [];
  if (levelMap.above) sides.push({ key: 'above', side: levelMap.above, up: true });
  if (levelMap.below) sides.push({ key: 'below', side: levelMap.below, up: false });

  return (
    <section data-testid="level-map" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
      <h4 className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{p.levelMapTitle}</h4>
      <ul className="mt-2 flex flex-col gap-3">
        {sides.map(({ key, side, up }, index) => (
          <li key={key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="font-terminal text-sm text-[var(--text-primary)]">{line(side, up)}</p>
            {alerts && analysisId ? (
              <MapAlertButton first={index === 0} analysisId={analysisId} level={side.level} format={price} />
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{p.levelMapNote}</p>
    </section>
  );
}
