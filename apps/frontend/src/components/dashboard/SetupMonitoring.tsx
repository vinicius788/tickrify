import { Link } from 'react-router-dom';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LOCALES } from '@/lib/i18n';
import { checkFrequencyText, formatAlertLevel, useExpiryClock, type AlertLabel, type SetupAlert, type SetupVersion } from '@/lib/setups';

/** Read-only projection of the loaded versions and persisted price checks. No collector or AI call. */
export default function SetupMonitoring({ versions, alerts, paused, loading, error, base, onCancel, cancelling }: {
  versions: SetupVersion[];
  alerts: SetupAlert[];
  paused: boolean;
  loading: boolean;
  error: boolean;
  base: string;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const { t, language } = useLanguage();
  const m = t.monitoring;
  const locale = LOCALES[language];
  const latest = versions[0];
  const currentAlerts = alerts.filter((alert) => alert.analysisId === latest?.analysisId);
  // Never attach a previous version's quote to the new plan, even in the same setup.
  const quote = currentAlerts.filter((a) => positive(a.lastPrice) && Number.isFinite(Date.parse(a.checkedAt ?? '')))
    .sort((a, b) => Date.parse(b.checkedAt!) - Date.parse(a.checkedAt!))[0];
  const checkedMs = Date.parse(quote?.checkedAt ?? '');
  const freshUntil = checkedMs + Math.max(120_000, 2 * (quote?.checkIntervalMs ?? 60_000));
  const expires = Date.parse(latest?.watch?.expiresAt ?? '');
  const nextChange = Math.min(...[freshUntil, expires].filter((at) => at > Date.now()));
  const now = useExpiryClock(nextChange);
  const ended = Number.isFinite(expires) && expires <= now;
  const active = currentAlerts.some((a) => a.status === 'active');
  const recent = !!quote && checkedMs <= now && freshUntil > now;
  const canMeasure = recent && active && !paused && !error && !ended && !quote.marketClosed;
  const level = latest?.watch?.level ?? latest?.entry;
  const distance = canMeasure && positive(level) ? Math.abs(level - quote.lastPrice!) / quote.lastPrice! * 100 : null;
  const price = (value: number | null | undefined) => positive(value) ? formatAlertLevel(value, locale) : '—';
  const moment = (iso: string) => `${new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', hourCycle: 'h23' })} UTC`;
  const label: Record<AlertLabel, string> = {
    entry: t.alerts.labelEntry, stop: t.alerts.labelStop, tp1: t.alerts.labelTp1,
    invalidation: t.alerts.labelInvalidation, custom: t.alerts.labelCustom,
  };
  const versionLabel = (id: string) => {
    const version = versions.find((v) => v.analysisId === id);
    return version ? t.setups.version.replace('{n}', String(version.version)) : m.otherVersion;
  };
  const events = [
    ...versions.map((v) => ({ key: `analysis:${v.analysisId}`, at: v.createdAt, analysisId: v.analysisId,
      text: `${t.setups.version.replace('{n}', String(v.version))} · ${t.setups.analysisFrom.replace('{date}', moment(v.createdAt))}` })),
    ...alerts.filter((a) => a.status === 'triggered' && a.triggeredAt && Number.isFinite(Date.parse(a.triggeredAt)))
      .map((a) => ({ key: `trigger:${a.id}`, at: a.triggeredAt!, analysisId: a.analysisId,
        text: `${m.triggered} · ${label[a.label]} ${price(a.level)} · ${versionLabel(a.analysisId)}` })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key));
  const levels: Array<[string, number | null | undefined]> = latest?.watch ? [
    [m.planLevel, latest.watch.level], [t.alerts.labelInvalidation, latest.watch.invalidation],
    [t.setups.stop, latest.watch.plan?.stopLoss], [t.setups.tp1, latest.watch.plan?.takeProfit1],
  ] : [[m.planLevel, latest?.entry], [t.setups.stop, latest?.stopLoss], [t.setups.tp1, latest?.takeProfit1], [t.setups.tp2, latest?.takeProfit2]];

  return (
    <section data-testid="setup-monitoring" aria-label={m.title} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="tk-stat-label">{m.title}</h2>
        {latest ? <span className="text-xs text-[var(--text-secondary)]">{versionLabel(latest.analysisId)}</span> : null}
      </div>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">{m.priceOnly}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 tabular-nums text-xs sm:grid-cols-4">
        {levels.map(([name, value]) => (
          <div key={name}><dt className="text-[var(--text-secondary)]">{name}</dt><dd className="mt-1 text-[var(--text-primary)]">{price(value)}</dd></div>
        ))}
      </dl>
      {Number.isFinite(expires) ? <p className="mt-3 text-xs text-[var(--text-secondary)]">{ended ? m.validityEnded : m.validUntil.replace('{time}', moment(latest!.watch!.expiresAt!))}</p> : null}
      <div className="mt-4 border-t border-[var(--border-subtle)] pt-4 text-xs">
        {paused ? <p>{m.paused}</p> : error ? <p role="status">{m.unavailable}</p> : loading ? <p>{t.common.loading}</p> : quote ? (
          <>
            <p className="tabular-nums">{m.lastPrice}: {price(quote.lastPrice)}</p>
            <p className="mt-1 text-[var(--text-secondary)]">{t.alerts.lastChecked.replace('{time}', moment(quote.checkedAt!))}</p>
            {checkFrequencyText(t.alerts, quote) ? <p className="mt-1 text-[var(--text-secondary)]">{checkFrequencyText(t.alerts, quote)}</p> : null}
            {!recent ? <p className="mt-1 text-[var(--text-secondary)]">{m.stale}</p> : null}
            {distance !== null ? <p data-testid="setup-monitoring-distance" className="mt-2 tabular-nums">{m.distance}: {distance.toLocaleString(locale, { maximumFractionDigits: 2 })}%</p> : null}
          </>
        ) : <p className="text-[var(--text-secondary)]">{m.noPrice}</p>}
        {!loading && !error && !paused && !active ? <p className="mt-2 text-[var(--text-secondary)]">{m.noActive}</p> : null}
      </div>
      <h3 className="tk-stat-label mt-5">{m.alerts}</h3>
      {alerts.length ? <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
        {alerts.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
          <span>{label[a.label]} {price(a.level)} · {versionLabel(a.analysisId)} · {a.status === 'active' ? m.active : a.status === 'triggered' ? m.triggered : t.alerts.cancelled}</span>
          {a.status === 'active' ? <button type="button" disabled={cancelling} onClick={() => onCancel(a.id)} className="text-[var(--text-secondary)] underline underline-offset-2 disabled:opacity-50">{t.alerts.cancel}</button> : null}
        </li>)}
      </ul> : <p className="mt-2 text-xs text-[var(--text-secondary)]">{m.noAlerts}</p>}
      <h3 className="tk-stat-label mt-5">{m.timeline}</h3>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">{m.history}</p>
      <ol className="mt-3 divide-y divide-[var(--border-subtle)]">
        {events.map((event) => <li key={event.key} className="py-2 text-xs">
          <Link to={`${base}/analysis/${encodeURIComponent(event.analysisId)}`} className="text-[var(--text-primary)] hover:underline">{event.text}</Link>
          <time dateTime={event.at} className="mt-1 block tabular-nums text-[var(--text-secondary)]">{moment(event.at)}</time>
        </li>)}
      </ol>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">{m.candleTime}</p>
    </section>
  );
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
