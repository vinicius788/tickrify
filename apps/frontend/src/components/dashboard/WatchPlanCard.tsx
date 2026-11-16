import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, BookmarkCheck, BookmarkPlus, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { LOCALES, formatNumber } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { APIError, type WatchLevels, type WatchPlan, type WatchReach, type WatchSummary } from '@/lib/api';
import { formatAssetDistance } from '@/lib/trading-ui';
import {
  formatTimeLeft,
  formatUtcTime,
  useAlertActions,
  useAlertOptions,
  useSetupActions,
  useSetupForAnalysis,
  watchTone,
} from '@/lib/setups';
import { AlertLevelButton, WatchVerdict } from './PendingLevels';

// Cartao do plano do WATCH: o que a pessoa faz se o preco chegar la, com os
// numeros do servidor num lugar so. Aberto, nunca usa as cores de compra/venda:
// nao e um sinal ativo. Verde e vermelho so no desfecho, com a janela encerrada.

const LADDER_HEIGHT = 196;
const LADDER_PAD = 10;
const LADDER_GAP = 26;
const LABEL_GAP = 13;

export function isWatchPlan(value: unknown): value is WatchPlan {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return (p.direction === 'long' || p.direction === 'short') &&
    (p.triggerType === 'zone_reaction' || p.triggerType === 'sweep_reclaim' || p.triggerType === 'breakout_close') &&
    n(p.zoneLow) && n(p.zoneHigh) && n(p.invalidation) && n(p.target1) &&
    (p.target2 === null || n(p.target2)) && typeof p.validForCandles === 'number';
}

export function isWatchLevels(value: unknown): value is WatchLevels {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return n(l.entry) && n(l.stopLoss) && n(l.takeProfit1) && (l.takeProfit2 === null || n(l.takeProfit2)) && n(l.tp1R) && n(l.riskAtr);
}

/** A janela do WATCH ainda vale: passou da validade ou ja tem desfecho, acabou. */
export function watchWindowOpen(watch: WatchSummary | null | undefined, now: number): boolean {
  const expires = Date.parse(watch?.expiresAt ?? '');
  return !(Number.isFinite(expires) && expires <= now) && (watch?.outcome ?? 'pending') === 'pending';
}

/** Borda da area que o preco alcanca primeiro: o nivel do alerta. */
export const watchPlanLevel = (plan: WatchPlan) => (plan.direction === 'long' ? plan.zoneHigh : plan.zoneLow);

/**
 * Afasta rotulos de niveis proximos: na ordem vertical, cada rotulo fica a pelo
 * menos `gap` do anterior, dentro do desenho.
 */
export function spreadLabels(ys: readonly number[], min = 14, max = 166, gap = LABEL_GAP): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(ys.length);
  let last = -Infinity;
  for (const { y, i } of order) {
    out[i] = Math.max(y, last + gap, min);
    last = out[i];
  }
  // Passou do fundo: empurra de baixo para cima.
  let next = Infinity;
  for (const { i } of [...order].reverse()) {
    out[i] = Math.min(out[i], next - gap, max);
    next = out[i];
  }
  return out;
}

/** Posicao vertical (de cima para baixo): quase proporcional, com um pouco de ordem para nao abrir buraco. */
export function ladderPositions(prices: readonly number[]): number[] {
  const top = Math.max(...prices);
  const span = top - Math.min(...prices) || 1;
  const order = prices.map((price, i) => ({ price, i })).sort((a, b) => b.price - a.price);
  const rank = new Array<number>(prices.length);
  order.forEach(({ i }, position) => { rank[i] = prices.length > 1 ? position / (prices.length - 1) : 0; });
  const usable = LADDER_HEIGHT - 2 * LADDER_PAD;
  const ys = prices.map((price, i) => LADDER_PAD + (0.75 * ((top - price) / span) + 0.25 * rank[i]) * usable);
  return spreadLabels(ys, LADDER_PAD, LADDER_HEIGHT - LADDER_PAD, LADDER_GAP);
}

type LadderKind = 'target' | 'price' | 'zone' | 'stop';

function LadderMarker({ kind }: { kind: LadderKind }) {
  if (kind === 'price') return <span className="block h-2 w-2 rounded-full bg-[var(--text-primary)]" />;
  if (kind === 'zone') return <span className="block h-3.5 w-3 rounded-[2px] border border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]" />;
  return <span className={`block h-px w-3 ${kind === 'stop' ? 'bg-[var(--tone-warn-2)]' : 'bg-[var(--text-secondary)]'}`} />;
}

function WatchPlanActions({
  analysisId,
  level,
  price,
  base,
}: {
  analysisId: string;
  level: number;
  price: string;
  base: string;
}) {
  const { t } = useLanguage();
  const w = t.analysis.result.watch;
  const a = t.alerts;
  const s = t.setups;
  const { toast } = useToast();
  const options = useAlertOptions(analysisId);
  const setupQuery = useSetupForAnalysis(analysisId);
  const { follow } = useSetupActions();
  const { cancel } = useAlertActions();
  const data = options.data;
  const suggested = useMemo(() => data?.suggestions.find((item) => item.label === 'entry' && item.level === level), [data, level]);
  if (options.isLoading || options.isError || !data || data.autoAlertPending) return null;

  const setup = setupQuery.data?.setup ?? null;
  const following = setup?.status === 'tracking';
  const alertOn = data.watchAlert ?? data.alerts.find((alert) => alert.status === 'active' && alert.level === level) ?? null;
  const onFollow = () => {
    track('setup_follow_clicked', { surface: 'result', recommendation: 'WAIT' });
    follow.mutate(analysisId, {
      onError: (error) => toast(
        error instanceof APIError && error.code === 'setup_limit'
          ? { title: s.limitTitle, description: s.limitDesc }
          : { title: s.followFailed, variant: 'destructive' },
      ),
    });
  };

  return (
    <div data-testid="watch-actions" className="mt-5 flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      {!data.available ? (
        <p key="broker" data-testid="watch-broker" className="min-w-0 text-sm leading-relaxed text-[var(--text-secondary)]">{w.brokerAlert.replace('{price}', price)}</p>
      ) : alertOn ? (
        <p key="alert-on" data-testid="watch-alert-on" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BellRing className="h-4 w-4 shrink-0" />
          <span>{(data.emailEnabled ? w.alertOnEmail : w.alertOnScreen).replace('{price}', price)}</span>
          <button
            type="button"
            aria-label={a.cancel}
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(alertOn.id, {
              onSuccess: () => toast({ title: a.cancelled }),
              onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
            })}
            className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      ) : (
        <AlertLevelButton
          key="alert"
          analysisId={analysisId}
          setupId={data.setupId}
          level={level}
          label={suggested ? 'entry' : 'custom'}
          surface="result"
          kind="watch"
          format={() => price}
        />
      )}
      {following && setup ? (
        <Link
          key="open"
          to={`${base}/setups/${encodeURIComponent(setup.id)}`}
          onClick={() => track('setup_opened', { setupId: setup.id, surface: 'result' })}
          className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
        >
          <BookmarkCheck className="h-3.5 w-3.5" />
          <span>{s.openSetup}</span>
        </Link>
      ) : (
        <button
          key="follow"
          type="button"
          onClick={onFollow}
          disabled={follow.isPending}
          className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)] disabled:opacity-60"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
          <span>{s.follow}</span>
        </button>
      )}
    </div>
  );
}

/**
 * O plano A MERCADO ao lado do plano no nivel (11/11/2026). So aparece quando o
 * servidor manda `marketLevels`: WATCH com velas reais em que a entrada ao
 * preco de agora tem geometria valida e foi o checklist que segurou. O estado
 * continua WATCH; o texto diz que nenhum dos dois planos tem vantagem medida.
 */
export function MarketPlanCard({
  direction,
  levels,
  formatPrice,
  footer = null,
}: {
  direction: WatchPlan['direction'];
  levels: WatchLevels;
  formatPrice: (value: number | null) => string;
  /** Registro de entrada do trader neste plano. */
  footer?: ReactNode;
}) {
  const { t, language } = useLanguage();
  const w = t.analysis.result.watch;
  const number = (value: number) => formatNumber(value, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  const money = (value: number) => formatPrice(value).replace(/ /g, '\u00a0');
  const rows: Array<{ key: string; label: string; value: string; tone?: string }> = [
    { key: 'entry', label: w.marketEntry, value: money(levels.entry) },
    { key: 'stop', label: w.stop, value: money(levels.stopLoss), tone: 'var(--signal-sell)' },
    { key: 't1', label: w.target1, value: money(levels.takeProfit1), tone: 'var(--signal-buy)' },
    { key: 'risk', label: w.marketRisk, value: w.marketRiskValue.replace('{atr}', number(levels.riskAtr)) },
    { key: 'reward', label: w.marketReward, value: `${number(levels.tp1R)}R` },
  ];
  return (
    <section data-testid="market-plan" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5" aria-labelledby="market-plan-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="market-plan-title" className="text-sm font-semibold text-[var(--text-primary)]">{w.marketTitle}</h3>
        <span className="rounded-full bg-[var(--fill-3)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">{w.marketChip}</span>
      </div>
      <p className="mb-3 text-sm font-medium text-[var(--text-primary)]">{direction === 'long' ? w.marketBuy : w.marketSell}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-[var(--text-secondary)]">{row.label}</dt>
            <dd className="text-right font-medium tabular-nums text-[var(--text-primary)]" style={row.tone ? { color: row.tone } : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{w.marketNote}</p>
      {footer}
    </section>
  );
}

interface WatchPlanCardProps {
  plan: WatchPlan;
  /**
   * Niveis do motor ao destravar no nivel. null = geometria rejeitada (so zona
   * e invalidacao); ausente = print ou analise antiga (sem stop nem R calculados).
   */
  levels?: WatchLevels | null;
  currentPrice: number | null;
  symbol: string;
  formatPrice: (value: number | null) => string;
  estimated?: boolean;
  /** Mostra o plano como entrada pendente (chave ENGINE_PENDING_ENTRY_LABEL). */
  pending?: boolean;
  watch?: WatchSummary | null;
  reach?: WatchReach | null;
  /** Condicao em uma linha, escrita pelo modelo. */
  condition: string | null;
  /** null: sem botoes (conta travada, exemplo). */
  actionsFor: string | null;
  base: string;
  /** Janela encerrada: so o nivel e o desfecho, nunca o plano nem o alerta. */
  closed: boolean;
  now: number;
  /** Registro de entrada do trader neste plano. */
  footer?: ReactNode;
}

export function WatchPlanCard({
  plan,
  levels,
  currentPrice,
  symbol,
  formatPrice,
  estimated = false,
  pending = false,
  watch,
  reach,
  condition,
  actionsFor,
  base,
  closed,
  now,
  footer = null,
}: WatchPlanCardProps) {
  const { t, language } = useLanguage();
  const w = t.analysis.result.watch;
  const locale = LOCALES[language];
  const long = plan.direction === 'long';
  const expires = Date.parse(watch?.expiresAt ?? '');
  const rText = (r: number) => `${formatNumber(r, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}R`;
  const money = (value: number) => formatPrice(value).replace(/ /g, '\u00a0');
  const zone = plan.zoneLow === plan.zoneHigh
    ? money(plan.zoneLow)
    : w.zoneRange.replace('{low}', money(plan.zoneLow)).replace('{high}', money(plan.zoneHigh));
  const stopLabel = levels ? w.stop : w.invalidation;
  const stopPrice = levels ? levels.stopLoss : plan.invalidation;
  const rejected = levels === null;
  const target1 = rejected ? null : levels ? levels.takeProfit1 : plan.target1;
  const target2 = rejected ? null : levels ? levels.takeProfit2 : plan.target2;
  const tp2R = levels && levels.takeProfit2 !== null
    ? Math.abs(levels.takeProfit2 - levels.entry) / Math.abs(levels.entry - levels.stopLoss)
    : null;

  const tiles: Array<{ key: string; label: string; value: string; note?: string }> = [
    levels
      ? { key: 'entry', label: long ? w.buyAt : w.sellAt, value: money(levels.entry) }
      : { key: 'zone', label: long ? w.buyZone : w.sellZone, value: zone },
    { key: 'stop', label: stopLabel, value: money(stopPrice) },
  ];
  if (target1 !== null) tiles.push({ key: 't1', label: w.target1, value: money(target1), note: levels ? rText(levels.tp1R) : undefined });
  if (target2 !== null) tiles.push({ key: 't2', label: w.target2, value: money(target2) });

  const ladder: Array<{ key: string; kind: LadderKind; label: string; value: string; r: string | null; at: number }> = [
    ...(target2 !== null ? [{ key: 't2', kind: 'target' as const, label: w.target2, value: formatPrice(target2), r: tp2R !== null ? rText(tp2R) : null, at: target2 }] : []),
    ...(target1 !== null ? [{ key: 't1', kind: 'target' as const, label: w.target1, value: formatPrice(target1), r: levels ? rText(levels.tp1R) : null, at: target1 }] : []),
    ...(currentPrice !== null ? [{ key: 'price', kind: 'price' as const, label: w.price, value: formatPrice(currentPrice), r: null, at: currentPrice }] : []),
    { key: 'zone', kind: 'zone', label: w.zone, value: zone, r: null, at: (plan.zoneLow + plan.zoneHigh) / 2 },
    { key: 'stop', kind: 'stop', label: stopLabel, value: formatPrice(stopPrice), r: null, at: stopPrice },
  ];
  ladder.sort((a, b) => b.at - a.at);
  const ladderY = ladderPositions(ladder.map((row) => row.at));

  const distance = currentPrice === null
    ? null
    : currentPrice >= plan.zoneLow && currentPrice <= plan.zoneHigh
      ? w.inZone
      : (currentPrice > plan.zoneHigh ? w.distanceAbove : w.distanceBelow).replace(
          '{distance}',
          formatAssetDistance(currentPrice > plan.zoneHigh ? currentPrice - plan.zoneHigh : plan.zoneLow - currentPrice, symbol, locale, w),
        );
  const validity = watch?.expiresAt
    ? w.validUntil.replace('{time}', formatUtcTime(watch.expiresAt)).replace('{left}', formatTimeLeft(expires - now, locale))
    : null;
  const alertLevel = watchPlanLevel(plan);

  if (closed) {
    return (
      <Card className="surface-terminal rounded-xl fade-in-stagger" data-testid="watch-plan-closed" style={{ animationDelay: '40ms' }}>
        <CardContent className="p-5 md:p-6">
          <h3 className="tk-display text-base text-[var(--text-primary)]">
            {watch?.expiresAt ? w.windowClosed.replace('{time}', formatUtcTime(watch.expiresAt)) : t.watching.windowClosed}
          </h3>
          <p data-testid="watch-closed-level" className="mt-1 tabular-nums text-xs text-[var(--text-secondary)]">
            {(long ? t.pending.buyLevel : t.pending.sellLevel).replace('{price}', money(alertLevel))}
          </p>
          {watch ? <div key="verdict" className="mt-3"><WatchVerdict watch={watch} tone={watchTone(watch, now)} /></div> : null}
          {footer}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="surface-terminal-elevated rounded-xl border border-[var(--border-accent)] fade-in-stagger" data-testid="watch-plan" style={{ animationDelay: '40ms' }}>
      <CardContent className="p-5 md:p-6">
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(250px,300px)] md:gap-8">
          <div className="min-w-0">
            <h3 data-testid="watch-plan-title" className="tk-display text-base text-[var(--text-primary)]">{pending ? (long ? w.pendingBuy : w.pendingSell) : w.planTitle.replace('{zone}', zone)}</h3>
            <p data-testid="watch-not-signal" className="mt-1 text-xs text-[var(--text-secondary)]">{pending ? w.pendingNote : w.notSignal}</p>
            <dl data-testid="watch-numbers" className={`mt-4 grid grid-cols-2 gap-x-4 gap-y-4 ${tiles.length > 2 ? '2xl:grid-cols-4' : ''}`}>
              {tiles.map((tile) => (
                <div key={tile.key} className="min-w-0">
                  <dt className="tabular-nums text-xs font-medium text-[var(--text-secondary)]">{tile.label}</dt>
                  <dd className="mt-1 tabular-nums text-[17px] font-semibold leading-tight text-[var(--text-primary)]">
                    <span>{tile.value}</span>
                    {tile.note ? <span key="note" className="mt-0.5 block text-xs font-normal text-[var(--text-secondary)]">{`(${tile.note})`}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
            {rejected ? <p key="rejected" data-testid="targets-rejected" className="mt-3 text-xs text-[var(--text-secondary)]">{w.targetsRejected}</p> : null}
            {estimated ? <p key="estimated" data-testid="levels-estimated" className="mt-3 text-xs text-[var(--text-secondary)]">{t.analysis.result.levelsEstimated}</p> : null}
            {condition ? <p key="condition" data-testid="watch-condition" className="mt-4 text-sm leading-relaxed text-[var(--text-primary)]">{condition}</p> : null}
            {distance || validity ? (
              <p key="timing" data-testid="watch-timing" className="mt-2 tabular-nums text-xs text-[var(--text-secondary)]">
                {[distance, validity].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {reach ? (
              <p key="reach" data-testid="watch-reach" className="mt-1 text-xs text-[var(--text-secondary)]">
                {t.analysis.result.readMode.reach.replace('{pct}', String(Math.round(reach.probability * 100))).replace('{n}', String(reach.candles))}
              </p>
            ) : null}
          </div>

          <div data-testid="watch-ladder" className="relative" style={{ height: LADDER_HEIGHT }}>
            <span className="absolute bottom-2.5 left-[7px] top-2.5 w-px bg-[var(--border-subtle)]" aria-hidden />
            {ladder.map((row, i) => (
              <div key={row.key} data-kind={row.kind} className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2 text-[12px]" style={{ top: ladderY[i] }}>
                <span className="flex w-[15px] shrink-0 justify-center"><LadderMarker kind={row.kind} /></span>
                <span className={`shrink-0 ${row.kind === 'price' ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{row.label}</span>
                <span className="ml-auto whitespace-nowrap text-right tabular-nums text-[var(--text-primary)]">
                  <span>{row.value}</span>
                  {row.r ? <span key="r" className="ml-1.5 text-[var(--text-secondary)]">{row.r}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>

        {actionsFor ? (
          <WatchPlanActions analysisId={actionsFor} level={alertLevel} price={money(alertLevel)} base={base} />
        ) : null}
        {footer}
      </CardContent>
    </Card>
  );
}
