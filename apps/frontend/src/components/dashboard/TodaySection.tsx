import { Link, useNavigate } from 'react-router-dom';
import { BellRing, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { displayAsset, type AIAnalysisResponse, type OpenTrade } from '@/lib/api';
import { WatchPending } from './PendingLevels';
import {
  alertDistancePct,
  formatAlertLevel,
  formatUtcTime,
  isWatchOpen,
  hasActiveLevel,
  useExpiryClock,
  useAlertActions,
  type AlertLabel,
  type SetupAlert,
  type SetupAlertList,
} from '@/lib/setups';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

/**
 * Bloco "Today" no topo do inicio do painel (27/10/2026): o que pede acao
 * hoje. Alertas disparados que a pessoa nao abriu (cada um com "Update
 * chart"), os niveis vigiados com a distancia do ultimo preco checado e as
 * operacoes abertas. Substituiu os KPIs, o quadro semanal e a lista de
 * recentes, que so repetiam numeros e o My Trades.
 */
const TodaySection = ({
  base,
  alerts,
  openTrades,
  analyses = [],
}: {
  base: string;
  alerts: SetupAlertList | undefined;
  openTrades: OpenTrade[];
  /** Historico ja carregado no painel: os WATCH ainda valendo aparecem aqui, com ou sem alerta. */
  analyses?: AIAnalysisResponse[];
}) => {
  const { t, language } = useLanguage();
  const a = t.alerts;
  const d = t.today;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const navigate = useNavigate();
  const { seen } = useAlertActions();
  const items = alerts?.items ?? [];
  const reached = items.filter((alert) => alert.status === 'triggered' && !alert.seenAt);
  const watching = new Map<string, SetupAlert[]>();
  for (const alert of items) {
    if (alert.status === 'active') watching.set(alert.setupId, [...(watching.get(alert.setupId) ?? []), alert]);
  }
  const labelText: Record<AlertLabel, string> = {
    entry: a.labelEntry,
    stop: a.labelStop,
    tp1: a.labelTp1,
    invalidation: a.labelInvalidation,
    custom: a.labelCustom,
  };
  const asset = (alert: Pick<SetupAlert, 'symbol' | 'timeframe'>) => `${alert.symbol}${alert.timeframe ? ` ${alert.timeframe}` : ''}`;

  const updateChart = (alert: SetupAlert) => {
    track('setup_alert_opened', { source: 'dashboard', alertId: alert.id, setupId: alert.setupId });
    track('setup_alert_update_clicked', { alertId: alert.id, setupId: alert.setupId, surface: 'today' });
    seen.mutate(alert.id);
    navigate(`${base}/new?setup=${encodeURIComponent(alert.setupId)}`);
  };

  // WATCH ainda valendo e sem alerta ativo (os com alerta ja estao em "Watching").
  const current = Date.now();
  const nextExpiry = analyses.reduce((next, row) => isWatchOpen(row.watch, current)
    ? Math.min(next, Date.parse(row.watch!.expiresAt!)) : next, Infinity);
  const now = useExpiryClock(nextExpiry);
  const pendingWatches = analyses.filter(
    (row) => isWatchOpen(row.watch, now) && !hasActiveLevel(items, row.watch!.setupId, row.id, row.watch!.level),
  );

  const empty = reached.length === 0 && watching.size === 0 && openTrades.length === 0 && pendingWatches.length === 0;

  return (
    <section aria-label={d.title} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
      <h2 className="tk-stat-label">{d.title}</h2>

      {/* Vazio: so a frase. O "New Analysis" e o do cartao de boas-vindas, logo acima. */}
      {empty ? (
        <p key="empty" className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          {alerts?.emailEnabled ? d.emptyEmail : d.emptyScreen}
        </p>
      ) : null}

      {reached.length > 0 ? (
        <div key="reached" className="mt-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <BellRing className="h-4 w-4 text-[var(--accent-green)]" />
            <span>{a.reachedTitle}</span>
          </p>
          <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
            {reached.map((alert) => (
              <li key={alert.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-terminal text-sm text-[var(--text-primary)]">{`${asset(alert)} · ${labelText[alert.label]}`}</p>
                  <p className="mt-0.5 font-terminal text-[11px] text-[var(--text-secondary)]">
                    {alert.triggeredAt
                      ? a.reachedAt.replace('{level}', formatAlertLevel(alert.level, locale)).replace('{time}', formatUtcTime(alert.triggeredAt))
                      : formatAlertLevel(alert.level, locale)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{a.notSignal}</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateChart(alert)}
                  className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-[var(--inverse-bg)] px-3 py-2 text-xs font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 sm:self-auto"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {a.updateChart}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {watching.size > 0 ? (
        <div key="watching" className="mt-4">
          <p className="tk-stat-label">{d.watching}</p>
          <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
            {[...watching.entries()].map(([setupId, list]) => (
              <li key={setupId} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="font-terminal text-sm text-[var(--text-primary)]">{asset(list[0])}</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {list.map((alert) => {
                      const pct = alertDistancePct(alert);
                      const distance = pct === null ? '' : ` · ${a.away.replace('{pct}', `${Math.abs(pct).toFixed(2)}%`)}`;
                      return (
                        <li key={alert.id} className="font-terminal text-xs text-[var(--text-secondary)]">
                          {`${labelText[alert.label]} ${formatAlertLevel(alert.level, locale)}${distance}`}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1 font-terminal text-[11px] text-[var(--text-muted)]">
                    {list[0].checkedAt ? a.lastChecked.replace('{time}', formatUtcTime(list[0].checkedAt)) : a.notChecked}
                  </p>
                </div>
                <Link
                  to={`${base}/setups/${encodeURIComponent(setupId)}`}
                  onClick={() => track('setup_opened', { setupId, surface: 'today' })}
                  className="self-start rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
                >
                  {t.setups.open}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingWatches.length > 0 ? (
        <div key="pending" className="mt-4">
          <p className="tk-stat-label">{t.pending.todayTitle}</p>
          <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
            {pendingWatches.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <p className="font-terminal text-sm text-[var(--text-primary)]">{`${displayAsset(row.symbol)}${row.timeframe ? ` ${row.timeframe}` : ''}`}</p>
                  <div className="mt-1">
                    <WatchPending analysisId={row.id} watch={row.watch!} surface="today" now={now} />
                  </div>
                </div>
                <Link
                  to={`${base}/analysis/${encodeURIComponent(row.id)}`}
                  className="self-start rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
                >
                  {t.setups.open}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {openTrades.length > 0 ? (
        <div key="trades" className="mt-4">
          <p className="tk-stat-label">{d.openTrades}</p>
          <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
            {openTrades.map((trade) => (
              <li key={trade.analysisId} className="flex items-center justify-between gap-2 py-3">
                <p className="min-w-0 font-terminal text-sm text-[var(--text-primary)]">
                  {`${trade.symbol ?? 'N/A'}${trade.timeframe ? ` ${trade.timeframe}` : ''} · `}
                  <span className={trade.direction === 'BUY' ? 'text-[var(--signal-buy)]' : 'text-[var(--signal-sell)]'}>
                    {trade.direction === 'BUY' ? t.analysis.buy : t.analysis.sell}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {` · ${trade.status === 'pending_order' ? d.pending : d.inTrade}`}
                  </span>
                </p>
                <Link
                  to={`${base}/analysis/${encodeURIComponent(trade.analysisId)}`}
                  className="shrink-0 rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
                >
                  {d.markTrade}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export default TodaySection;
