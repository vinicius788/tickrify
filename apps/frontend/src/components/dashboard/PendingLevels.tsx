import { BellPlus, BellRing } from 'lucide-react';
import { formatNumber } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { formatAssetPrice } from '@/lib/trading-ui';
import { APIError, type AiLevel, type LevelMap, type LevelMapSide, type WatchSummary } from '@/lib/api';
import {
  formatAlertLevel,
  formatTimeLeft,
  hasActiveLevel,
  useExpiryClock,
  useAlertOptions,
  isWatchOpen,
  watchTone,
  WATCH_TONE_CLASSES,
  type WatchTone,
  useAlertActions,
  useSetupAlerts,
  type AlertLabel,
} from '@/lib/setups';

// WATCH pendente e mapa de niveis do NO_TRADE (03/11/2026). Arquivo proprio
// porque Today, setups, a aba Watching e o resultado mostram o mesmo bloco.
// Nunca acerto, P&L ou "win": o WATCH nao e operacao.

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type Surface = 'today' | 'setups' | 'setup_page' | 'result';

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
      <span key="active" className="inline-flex items-center gap-1.5 tabular-nums text-[11px] text-[var(--text-secondary)]">
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

/** O desfecho do WATCH: verde no alvo, vermelho no stop, cinza no resto. Sempre "o que o mercado fez". */
export function WatchVerdict({ watch, tone, caption = true, alignEnd = false }: { watch: WatchSummary; tone: WatchTone; caption?: boolean; alignEnd?: boolean }) {
  const { t, language } = useLanguage();
  const p = t.pending;
  const label =
    tone === 'target'
      ? watch.targetR
        ? p.targetHitR.replace('{r}', `+${formatNumber(watch.targetR, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}`)
        : p.targetHit
      : tone === 'stopped' ? p.stopped
        : tone === 'checking' ? p.checking
          : watch.outcome === 'reached' ? (watch.afterReach === 'neither' ? p.reachedNeither : p.reached)
            : watch.outcome === 'invalidated' ? p.invalidated
              : watch.outcome === 'expired' ? p.expired
                : p.unavailable;
  return (
    <div data-testid="watch-outcome" data-tone={tone} data-outcome={watch.outcome} className={`flex flex-col gap-1 ${alignEnd ? 'sm:items-end' : 'items-start'}`}>
      {caption ? <span key="caption" className="tabular-nums text-xs text-[var(--text-tertiary)]">{p.marketDid}</span> : null}
      <span className={`w-fit rounded-lg border px-2.5 py-1 tabular-nums text-[11px] ${WATCH_TONE_CLASSES[tone]}`}>{label}</span>
    </div>
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
  symbol,
  caption = true,
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
  /** false: o bloco em volta ja diz que e o que o mercado fez. */
  caption?: boolean;
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
  const tone = watchTone(watch, now);
  // Janela fechada: so o nivel e a direcao, sem mandar esperar algo que ja passou.
  const closed = tone !== 'watching';
  const levelLine = closed
    ? (watch.direction === 'long' ? p.buyLevel : p.sellLevel)
    : (watch.direction === 'long' ? p.watchBuy : p.watchSell);

  return (
    <div data-testid="watch-pending" data-outcome={watch.outcome} className={`flex flex-col gap-1.5 ${alignEnd ? 'sm:items-end sm:text-right' : ''}`}>
      {closed ? (
        <WatchVerdict key="verdict" watch={watch} tone={tone} caption={caption} alignEnd={alignEnd} />
      ) : (
        <span key="status" className={`w-fit rounded-lg border px-2.5 py-1 tabular-nums text-[11px] ${WATCH_TONE_CLASSES.watching}`}>{p.statusPending}</span>
      )}
      <p className="tabular-nums text-xs text-[var(--text-primary)]">
        {levelLine.replace('{price}', price(watch.level))}
      </p>
      {!closed && conditionalPlan && <p data-testid="conditional-plan" className="tabular-nums text-[11px] text-[var(--text-primary)]">{conditionalPlan}</p>}
      {!closed && waitingFor && <p className="text-xs text-[var(--text-secondary)]">{waitingFor}</p>}
      {!closed && <p className="tabular-nums text-[11px] text-[var(--text-secondary)]">
        {[p.invalidation.replace('{price}', price(watch.invalidation)), validity].filter(Boolean).join(' · ')}
      </p>}
      {alerts && open && watch.alertAvailable ? (
        <AlertLevelButton analysisId={analysisId} setupId={watch.setupId} level={watch.level} label="entry" surface={surface} kind="watch" />
      ) : null}
    </div>
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
      <h4 className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">{p.levelMapTitle}</h4>
      <ul className="mt-2 flex flex-col gap-3">
        {aiLevel ? (
          <li key="ai" data-testid="ai-level" className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              {aiLevel.direction ? (
                <>
                  <p className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">{p.aiLevelLabel}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-primary)]">
                    <span>{(aiLevel.direction === 'long' ? p.aiLevelBuy : p.aiLevelSell).replace('{price}', price(aiLevel.price))}</span>
                    {alerts && analysisId ? <AiLevelAlertNote analysisId={analysisId} level={aiLevel.price} /> : null}
                  </p>
                </>
              ) : (
                <>
                  <p className="tabular-nums text-sm text-[var(--text-primary)]">{p.aiLevel.replace('{price}', price(aiLevel.price))}</p>
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
            <p className="tabular-nums text-sm text-[var(--text-primary)]">{line(side, up)}</p>
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
