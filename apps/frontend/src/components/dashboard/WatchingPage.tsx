import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, RefreshCw } from 'lucide-react';
import { formatNumber } from '@/lib/i18n';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { displayAsset } from '@/lib/api';
import { formatAssetDistance, formatAssetPrice } from '@/lib/trading-ui';
import {
  WATCH_TONE_CLASSES,
  alertDistancePct,
  checkFrequencyText,
  formatUtcMoment,
  formatUtcTime,
  isWatchOpen,
  useAlertActions,
  useExpiryClock,
  useSetupActions,
  useWatching,
  watchNeedsReview,
  watchTone,
  type WatchingItem,
} from '@/lib/setups';
import { NearNote, WatchVerdict } from './PendingLevels';
import SetupsSection from './SetupsSection';

// Aba Watching (10/11/2026). O WATCH e o inicio do trade, nao o trade: mora
// aqui, fora do My Trades e do Diario. Desfecho = o que o mercado fez, pela
// regra unica de `watchTone`; nunca P&L, acerto do usuario ou /accuracy.

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type Step = { key: string; label: string; to?: string; tone: 'done' | 'end' };

/** Watching, Price reached, Re-checked (link), e o fim: Entered (link) | Skipped | Invalidated | Expired. */
function Journey({ item, base }: { item: WatchingItem; base: string }) {
  const { t } = useLanguage();
  const j = t.watching.journey;
  const { journey } = item;
  const steps: Step[] = [{ key: 'watching', label: j.watching, tone: 'done' }];
  if (journey.priceReached) steps.push({ key: 'reached', label: j.reached, tone: 'done' });
  if (journey.recheck) steps.push({ key: 'rechecked', label: j.rechecked, to: `${base}/analysis/${encodeURIComponent(journey.recheck.analysisId)}`, tone: 'done' });
  if (journey.end === 'entered' && journey.entered) steps.push({ key: 'entered', label: j.entered, to: `${base}/trades`, tone: 'end' });
  else if (journey.end) steps.push({ key: journey.end, label: j[journey.end], tone: 'end' });
  // So "Watching": o selo ja diz isso.
  if (steps.length < 2) return null;
  return (
    <ol data-testid="watch-journey" aria-label={t.watching.journeyLabel} className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-[var(--text-secondary)]">
      {steps.map((step, i) => (
        <li key={step.key} data-step={step.key} className="flex items-center gap-1.5">
          {i > 0 ? <span key="sep" aria-hidden="true" className="text-[var(--text-muted)]">{'>'}</span> : null}
          {step.to ? (
            <Link key="link" to={step.to} className="text-[var(--text-primary)] underline underline-offset-2 hover:opacity-80">{step.label}</Link>
          ) : (
            <span key="text" className={step.tone === 'end' ? 'text-[var(--text-primary)]' : ''}>{step.label}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function WatchRow({ item, now, base }: { item: WatchingItem; now: number; base: string }) {
  const { t, language } = useLanguage();
  const w = t.watching;
  const p = t.pending;
  const a = t.alerts;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const navigate = useNavigate();
  const { toast } = useToast();
  const { seen } = useAlertActions();
  const { follow } = useSetupActions();
  const { watch, alert } = item;
  const price = (v: number) => formatAssetPrice(v, item.symbol, locale);
  const open = isWatchOpen(watch, now);
  const tone = watchTone(watch, now);
  const closed = tone !== 'watching';
  const review = watchNeedsReview(item);

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
  const alertLabel = alert?.status === 'triggered' ? w.alertTriggered : alert?.status === 'active' ? w.alertWatching : alert?.status === 'cancelled' ? w.alertCancelled : null;
  const details = closed
    ? []
    : [
        p.invalidation.replace('{price}', price(watch.invalidation)),
        watch.expiresAt ? w.validUntil.replace('{time}', formatUtcMoment(watch.expiresAt, locale)) : null,
      ];
  const checked = closed
    ? null
    : [alertLabel, item.checkedAt ? a.lastChecked.replace('{time}', formatUtcTime(item.checkedAt)) : null, checkFrequencyText(a, item)].filter(Boolean).join(' · ');

  const setupId = alert?.setupId ?? watch.setupId;
  const recheck = () => {
    track('watch_recheck_clicked', { analysisId: item.analysisId, reached: review, surface: 'watching' });
    if (alert && review) {
      track('setup_alert_opened', { source: 'dashboard', alertId: alert.id, setupId: alert.setupId });
      seen.mutate(alert.id);
      navigate(`${base}/new?setup=${encodeURIComponent(alert.setupId)}&alert=${encodeURIComponent(alert.id)}`);
      return;
    }
    if (setupId) {
      navigate(`${base}/new?setup=${encodeURIComponent(setupId)}`);
      return;
    }
    // Sem setup ainda: segue no mesmo clique, para a reanalise entrar na jornada.
    follow.mutate(item.analysisId, {
      onSuccess: (res) => navigate(`${base}/new?setup=${encodeURIComponent(res.setup.id)}`),
      onError: () => toast({ title: t.setups.followFailed, variant: 'destructive' }),
    });
  };

  return (
    <li data-testid="watching-item" data-state={closed ? 'closed' : review ? 'reached' : 'open'} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <Link to={`${base}/analysis/${encodeURIComponent(item.analysisId)}`} className="text-sm font-medium text-[var(--text-primary)] hover:underline">
          {`${displayAsset(item.symbol)}${item.timeframe ? ` ${item.timeframe}` : ''}`}
        </Link>
        <p className="mt-0.5 text-xs tabular-nums text-[var(--text-primary)]">{[levelText, distance].filter(Boolean).join(' · ')}</p>
        {details.length ? <p key="details" className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">{details.filter(Boolean).join(' · ')}</p> : null}
        {checked ? <p key="checked" className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">{checked}</p> : null}
        {review && open ? <p key="not-signal" className="mt-0.5 text-xs text-[var(--text-secondary)]">{a.notSignal}</p> : null}
        {open ? <NearNote key="near" near={item.alert?.near} /> : null}
        <Journey item={item} base={base} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {closed ? (
          <WatchVerdict key="verdict" watch={watch} tone={tone} caption={false} alignEnd />
        ) : (
          <span key="pill" className={`w-fit rounded-lg border px-2.5 py-1 text-xs ${WATCH_TONE_CLASSES.watching}`}>
            {review ? w.journey.reached : w.journey.watching}
          </span>
        )}
        {open || review ? (
          <button
            key="recheck"
            type="button"
            onClick={recheck}
            disabled={follow.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--inverse-bg)] px-3 py-2 text-xs font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{w.recheck}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

function Group({ id, title, note, items, now, base }: { id: string; title: string; note?: string; items: WatchingItem[]; now: number; base: string }) {
  if (items.length === 0) return null;
  return (
    <section data-testid={`watching-${id}`} aria-label={title} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h2 className="tk-stat-label">{`${title} (${items.length})`}</h2>
      {note ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{note}</p> : null}
      <ul className="mt-4 divide-y divide-[var(--border-subtle)]">
        {items.map((item) => <WatchRow key={item.analysisId} item={item} now={now} base={base} />)}
      </ul>
    </section>
  );
}

/**
 * Preco chegou (no topo), Vigiando, Setups seguidos e Encerrados. O servidor
 * responde 402 com gratis esgotado; quem chama mostra o Paywall `watching`.
 */
const WatchingPage = ({ base, eyebrow, onStartAnalysis }: { base: string; eyebrow: ReactNode; onStartAnalysis: () => void }) => {
  const { t } = useLanguage();
  const w = t.watching;
  const query = useWatching(true);
  const items = query.data?.items ?? [];
  const current = Date.now();
  const nextExpiry = items.reduce((next, item) => (isWatchOpen(item.watch, current) ? Math.min(next, Date.parse(item.watch.expiresAt as string)) : next), Infinity);
  const now = useExpiryClock(nextExpiry);

  const reached = items.filter(watchNeedsReview);
  const open = items.filter((item) => !watchNeedsReview(item) && isWatchOpen(item.watch, now));
  const closed = items.filter((item) => !watchNeedsReview(item) && !isWatchOpen(item.watch, now));
  // O setup que ja aparece num WATCH acima nao repete na lista de setups.
  const shown = new Set(items.flatMap((item) => [item.alert?.setupId, item.watch.setupId].filter((id): id is string => Boolean(id))));

  return (
    <div className="flex flex-col gap-4">
      <div>
        {eyebrow}
        <h1 className="tk-display mt-2 text-2xl md:text-3xl">{w.title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">{w.subtitle}</p>
      </div>
      {!query.isLoading && items.length === 0 ? (
        <div key="empty" data-testid="watching-empty" className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 text-center">
          <Eye className="mx-auto h-5 w-5 text-[var(--text-secondary)]" />
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{w.empty}</p>
          <button
            type="button"
            onClick={onStartAnalysis}
            className="mt-4 rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
          >
            {t.nav.newAnalysis}
          </button>
        </div>
      ) : null}
      <Group id="reached" title={w.reachedTitle} items={reached} now={now} base={base} />
      <Group id="open" title={w.openTitle} items={open} now={now} base={base} />
      <SetupsSection base={base} part="list" hiddenSetupIds={shown} />
      <Group id="closed" title={w.closedTitle} note={w.note} items={closed} now={now} base={base} />
    </div>
  );
};

export default WatchingPage;

/** "N setups being watched": a linha discreta no My Trades e no Diario. */
export function WatchingLink() {
  const { t } = useLanguage();
  const items = useWatching(true).data?.items ?? [];
  const now = Date.now();
  const n = items.filter((item) => watchNeedsReview(item) || isWatchOpen(item.watch, now)).length;
  if (n === 0) return null;
  return (
    <p data-testid="watching-link" className="border-b border-[var(--border-subtle)] px-5 py-2.5 text-xs text-[var(--text-secondary)]">
      <Link to="/dashboard/watching" className="underline underline-offset-2 hover:text-[var(--text-primary)]">
        {n === 1 ? t.watching.lineOne : t.watching.line.replace('{n}', String(n))}
      </Link>
    </p>
  );
}
