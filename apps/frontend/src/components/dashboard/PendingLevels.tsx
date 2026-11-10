import { useNavigate } from 'react-router-dom';
import { BellPlus, BellRing, RefreshCw } from 'lucide-react';
import { formatNumber } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { formatAssetDistance, formatAssetPrice } from '@/lib/trading-ui';
import { APIError, displayAsset, type AiLevel, type LevelMap, type LevelMapSide, type WatchSummary } from '@/lib/api';
import {
  alertDistancePct,
  checkFrequencyText,
  formatAlertLevel,
  formatTimeLeft,
  formatUtcTime,
  hasActiveLevel,
  useExpiryClock,
  useAlertOptions,
  isWatchOpen,
  useAlertActions,
  useSetupAlerts,
  useWatching,
  type AlertLabel,
  type WatchingItem,
} from '@/lib/setups';

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
export function AlertLevelButton({
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

/** "Plan if price reaches X": condicional, nunca ordem executada. Sem geometria valida, nada. */
function useConditionalPlan() {
  const { t, language } = useLanguage();
  const p = t.pending;
  return (direction: WatchSummary['direction'], plan: WatchSummary['plan'], price: (v: number) => string) =>
    plan
      ? p.planIf
          .replace(/\{level\}/g, price(plan.entry))
          .replace('{side}', direction === 'long' ? p.sideBuy : p.sideSell)
          .replace('{stop}', price(plan.stopLoss))
          .replace('{target}', price(plan.takeProfit1))
          .replace('{r}', formatNumber(plan.tp1R, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false }))
      : null;
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
  symbol,
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
  /** Ativo, para a unidade do preco (indice sem "$"). */
  symbol?: string | null;
}) {
  const { t, language } = useLanguage();
  const p = t.pending;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const price = (v: number) => (symbol ? formatAssetPrice(v, symbol, locale) : formatAlertLevel(v, locale));
  const conditionalPlan = useConditionalPlan()(watch.direction, watch.plan, price);
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
    : (watch.direction === 'long' ? p.watchBuy : p.watchSell);

  return (
    <div data-testid="watch-pending" data-outcome={watch.outcome} className={`flex flex-col gap-1.5 ${alignEnd ? 'sm:items-end sm:text-right' : ''}`}>
      <span className="w-fit rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5 py-1 font-terminal text-[11px] text-[var(--text-secondary)]">
        {closedNote ?? status}
      </span>
      <p className="font-terminal text-xs text-[var(--text-primary)]">
        {levelLine.replace('{price}', price(watch.level))}
      </p>
      {!closed && conditionalPlan && <p data-testid="conditional-plan" className="font-terminal text-[11px] text-[var(--text-primary)]">{conditionalPlan}</p>}
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

function WatchingRow({ item, now, surface }: { item: WatchingItem; now: number; surface: 'trades' | 'journal' }) {
  const { t, language } = useLanguage();
  const w = t.watching;
  const p = t.pending;
  const a = t.alerts;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const navigate = useNavigate();
  const { seen } = useAlertActions();
  const { watch, alert } = item;
  const price = (v: number) => formatAssetPrice(v, item.symbol, locale);
  const conditionalPlan = useConditionalPlan()(watch.direction, watch.plan, price);
  const open = isWatchOpen(watch, now);
  const closed = watch.outcome !== 'pending' || (watch.expiresAt !== null && !open);
  const triggered = alert?.status === 'triggered';

  // Disparo dentro da janela ja diz que o preco chegou, antes da linha do rastreador existir.
  const hitInWindow = triggered && alert.triggeredAt !== null && (watch.expiresAt === null || Date.parse(alert.triggeredAt) <= Date.parse(watch.expiresAt));
  const closedLabel =
    watch.outcome === 'reached' ? w.levelReached
      : watch.outcome === 'invalidated' ? w.invalidatedBefore
        : watch.outcome === 'expired' ? w.windowClosed
          : watch.outcome === 'unavailable' ? w.unavailable
            : hitInWindow ? w.levelReached : w.outcomePending;
  const after =
    watch.afterReach === 'target' ? w.afterTarget
      : watch.afterReach === 'invalidation' ? w.afterInvalidation
        : watch.afterReach === 'neither' ? w.afterNeither : null;
  const alertLabel = triggered ? w.alertTriggered : alert?.status === 'active' ? w.alertWatching : alert?.status === 'cancelled' ? w.alertCancelled : null;
  // Alerta automatico e cancelado ao fim da janela: depois dela, o que importa e o que o preco fez.
  const pill = closed ? closedLabel : alertLabel;
  const left = open ? Date.parse(watch.expiresAt as string) - now : null;

  const pct = closed ? null : alertDistancePct({ level: watch.level, lastPrice: item.lastPrice });
  const distance = pct === null
    ? null
    : w.distance
        .replace('{pct}', `${formatNumber(Math.abs(pct), language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })}%`)
        .replace('{price}', formatAssetDistance(Math.abs(watch.level - (item.lastPrice as number)), item.symbol, locale, t.analysis.result.watch));
  const levelText = (closed
    ? (watch.direction === 'long' ? p.buyLevel : p.sellLevel)
    : (watch.direction === 'long' ? p.watchBuy : p.watchSell)
  ).replace('{price}', price(watch.level));
  const checked = closed
    ? null
    : [
        item.checkedAt ? a.lastChecked.replace('{time}', formatUtcTime(item.checkedAt)) : null,
        checkFrequencyText(a, item),
      ].filter(Boolean).join(' · ');

  const updateChart = () => {
    if (!alert) return;
    track('setup_alert_opened', { source: 'dashboard', alertId: alert.id, setupId: alert.setupId });
    track('setup_alert_update_clicked', { alertId: alert.id, setupId: alert.setupId, surface });
    seen.mutate(alert.id);
    navigate(`/dashboard/new?setup=${encodeURIComponent(alert.setupId)}&alert=${encodeURIComponent(alert.id)}`);
  };

  return (
    <li data-testid="watching-item" data-state={closed ? 'closed' : 'open'} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-terminal text-sm text-[var(--text-primary)]">
          {`${displayAsset(item.symbol)}${item.timeframe ? ` ${item.timeframe}` : ''}`}
        </p>
        <p className="mt-0.5 font-terminal text-xs text-[var(--text-primary)]">
          {[levelText, distance].filter(Boolean).join(' · ')}
        </p>
        {!closed && conditionalPlan ? <p key="plan" data-testid="conditional-plan" className="mt-0.5 font-terminal text-[11px] text-[var(--text-primary)]">{conditionalPlan}</p> : null}
        {!closed ? (
          <p key="invalidation" className="mt-0.5 font-terminal text-[11px] text-[var(--text-secondary)]">
            {[p.invalidation.replace('{price}', price(watch.invalidation)), left !== null ? w.timeLeft.replace('{time}', formatTimeLeft(left, locale)) : null].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {closed && after ? <p key="after" className="mt-0.5 text-xs text-[var(--text-secondary)]">{after}</p> : null}
        {checked ? <p key="checked" className="mt-0.5 font-terminal text-[11px] text-[var(--text-secondary)]">{checked}</p> : null}
        {triggered && !closed ? <p key="not-signal" className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{a.notSignal}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {pill ? (
          <span key="pill" className="w-fit rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5 py-1 font-terminal text-[11px] text-[var(--text-secondary)]">
            {pill}
          </span>
        ) : null}
        {triggered && (open || !alert.seenAt) ? (
          <button
            key="update"
            type="button"
            onClick={updateChart}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--inverse-bg)] px-3 py-2 text-xs font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{a.updateChart}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Secao "Watching" no topo do My Trades e do Diario (09/11/2026): os niveis
 * sendo vigiados e o que o preco fez nos encerrados. Informacao de mercado:
 * nada aqui entra em acerto, P&L ou estatistica, nem fala como ordem executada.
 */
export function WatchingSection({ surface, enabled }: { surface: 'trades' | 'journal'; enabled: boolean }) {
  const { t } = useLanguage();
  const w = t.watching;
  const items = useWatching(enabled).data?.items ?? [];
  const current = Date.now();
  const nextExpiry = items.reduce((next, item) => (isWatchOpen(item.watch, current) ? Math.min(next, Date.parse(item.watch.expiresAt as string)) : next), Infinity);
  const now = useExpiryClock(nextExpiry);
  if (items.length === 0) return null;
  return (
    <section data-testid="watching-section" aria-label={w.title} className="border-b border-[var(--border-subtle)] p-4">
      <h3 className="tk-stat-label">{w.title}</h3>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{w.note}</p>
      <ul className="mt-3 divide-y divide-[var(--border-subtle)]">
        {items.map((item) => (
          <WatchingRow key={item.analysisId} item={item} now={now} surface={surface} />
        ))}
      </ul>
    </section>
  );
}

function MapAlertButton({ analysisId, level, format }: { analysisId: string; level: number; format: (value: number) => string }) {
  const options = useAlertOptions(analysisId);
  if (!options.data?.available || options.isError) return null;
  return <AlertLevelButton analysisId={analysisId} setupId={options.data.setupId} level={level} label="custom" surface="result" kind="level_map" format={format} />;
}

/** So promete o aviso quando o alerta existe de verdade. */
function AiLevelAlertNote({ analysisId, level }: { analysisId: string; level: number }) {
  const { t } = useLanguage();
  const options = useAlertOptions(analysisId);
  const alerts = useSetupAlerts(true);
  if (!hasActiveLevel(alerts.data?.items ?? [], options.data?.setupId, analysisId, level)) return null;
  return <span data-testid="ai-level-alert">{` ${t.pending.aiLevelAlert}`}</span>;
}

/** NO_TRADE com velas reais: os dois lados do preco, montados pelo codigo. Nao e sinal. */
export function LevelMapCard({
  levelMap,
  aiLevel = null,
  analysisId,
  alerts,
  formatPrice,
}: {
  levelMap: LevelMap | null;
  aiLevel?: AiLevel | null;
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
  if (levelMap?.above) sides.push({ key: 'above', side: levelMap.above, up: true });
  if (levelMap?.below) sides.push({ key: 'below', side: levelMap.below, up: false });

  return (
    <section data-testid="level-map" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
      <h4 className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{p.levelMapTitle}</h4>
      <ul className="mt-2 flex flex-col gap-3">
        {aiLevel ? (
          <li key="ai" data-testid="ai-level" className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              {aiLevel.direction ? (
                <>
                  <p className="font-terminal text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">{p.aiLevelLabel}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-primary)]">
                    <span>{(aiLevel.direction === 'long' ? p.aiLevelBuy : p.aiLevelSell).replace('{price}', price(aiLevel.price))}</span>
                    {alerts && analysisId ? <AiLevelAlertNote analysisId={analysisId} level={aiLevel.price} /> : null}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-terminal text-sm text-[var(--text-primary)]">{p.aiLevel.replace('{price}', price(aiLevel.price))}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{p.aiLevelNote}</p>
                </>
              )}
            </div>
            {alerts && analysisId ? (
              <MapAlertButton analysisId={analysisId} level={aiLevel.price} format={price} />
            ) : null}
          </li>
        ) : null}
        {sides.map(({ key, side, up }) => (
          <li key={key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="font-terminal text-sm text-[var(--text-primary)]">{line(side, up)}</p>
            {alerts && analysisId ? (
              <MapAlertButton analysisId={analysisId} level={side.level} format={price} />
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{p.levelMapNote}</p>
    </section>
  );
}
