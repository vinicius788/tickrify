import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import OnboardingQuiz, { readQuizState } from '@/components/dashboard/OnboardingQuiz';
import { track } from '@/lib/analytics';
import { formatAlertLevel, formatUtcTime, useAlertActions, useSaveWatchAssets, useWatchAssetAlert, useWatchAssets, type DayLevel, type WatchAsset } from '@/lib/setups';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

/**
 * "My assets" no topo do inicio (10/11/2026): a pessoa escolhe os ativos uma
 * vez e ve os niveis do dia de cada um, calculados so pelo codigo das velas
 * reais. Motivo para abrir o painel sem gastar analise. Conta travada ou
 * servidor fora: o bloco nao aparece.
 */
const MyAssets = ({ base, newAccount = false }: { base: string; newAccount?: boolean }) => {
  const { t, language } = useLanguage();
  const a = t.assets;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const query = useWatchAssets(true);
  const save = useSaveWatchAssets();
  const alert = useWatchAssetAlert();
  const { seen } = useAlertActions();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState('15m');
  const [quiz, setQuiz] = useState(readQuizState);
  const data = query.data;
  // Resposta sem a lista (servidor antigo durante o deploy): o bloco nao aparece.
  if (!data || !Array.isArray(data.assets)) return null;

  const startEdit = () => {
    setPicked(data.assets.map((asset) => asset.symbol));
    setTimeframe(data.timeframe);
    save.reset();
    setEditing(true);
  };
  // Conta nova, sem lista e sem analise: o quiz monta o painel (uma vez por aparelho).
  if (newAccount && !quiz.done && !editing && data.assets.length === 0) {
    return <OnboardingQuiz data={data} onDone={() => setQuiz(readQuizState())} />;
  }
  const quizLine = newAccount && quiz.pain
    ? quiz.pain === 'miss'
      ? (quiz.alertsOn ? t.quiz.doneMiss : t.quiz.doneMissOff)
      : { late: t.quiz.doneLate, stop: t.quiz.doneStop, over: t.quiz.doneOver }[quiz.pain]
    : null;
  const picking = editing || data.assets.length === 0;
  const chosen = picked;
  const options = [...new Set([...data.suggested, ...chosen])];
  const toggle = (symbol: string) =>
    setPicked((current) => (current.includes(symbol) ? current.filter((s) => s !== symbol) : current.length >= data.maxAssets ? current : [...current, symbol]));
  const submit = () =>
    save.mutate({ symbols: chosen, timeframe }, {
      onSuccess: () => {
        track('watch_assets_saved', { count: chosen.length, timeframe });
        setEditing(false);
      },
    });

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
      active
        ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
        : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]'
    }`;
  const card = 'rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5';

  if (picking) {
    return (
      <section className={card} aria-labelledby="my-assets-title">
        <h2 id="my-assets-title" className="tk-stat-label mb-1">{a.title}</h2>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">{fill(a.sub, { max: data.maxAssets })}</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {options.map((symbol) => (
            <button key={symbol} type="button" aria-pressed={chosen.includes(symbol)} onClick={() => toggle(symbol)} className={chip(chosen.includes(symbol))}>
              {symbol}
            </button>
          ))}
        </div>
        <p className="tk-meta mb-2">{a.timeframe}</p>
        <div role="radiogroup" aria-label={a.timeframe} className="mb-4 flex flex-wrap gap-2">
          {data.timeframes.map((tf) => (
            <button key={tf} type="button" role="radio" aria-checked={timeframe === tf} onClick={() => setTimeframe(tf)} className={chip(timeframe === tf)}>
              {tf}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="tk-meta tabular-nums">{fill(a.count, { n: chosen.length, max: data.maxAssets })}</span>
          <div className="flex gap-2">
            {editing ? (
              <button key="cancel" type="button" onClick={() => setEditing(false)} className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--fill-2)]">
                {a.cancel}
              </button>
            ) : null}
            <button
              key="save"
              type="button"
              onClick={submit}
              disabled={save.isPending || (!editing && chosen.length === 0)}
              className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <span key={save.isPending ? 'saving' : 'save'}>{save.isPending ? a.saving : a.save}</span>
            </button>
          </div>
        </div>
        {save.isError ? (
          <p role="status" className="mt-3 text-sm" style={{ color: 'var(--signal-sell)' }}>{a.failed}</p>
        ) : null}
      </section>
    );
  }

  const trendText = { uptrend: a.up, downtrend: a.down, range: a.range } as const;
  const level = (label: string, value: DayLevel | null, watched: number | null) => (
    <div className="rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
      <p className="tk-meta">{label}</p>
      {value ? (
        <>
          <p className="text-base font-semibold tabular-nums text-[var(--text-primary)]">{formatAlertLevel(value.price, locale)}</p>
          <p className="tk-meta tabular-nums">{fill(a.away, { pct: `${value.pct.toLocaleString(locale, { maximumFractionDigits: 2 })}%` })}</p>
        </>
      ) : (
        <p className="tk-meta">{a.none}</p>
      )}
      {watched !== null ? (
        <p className="tk-meta mt-1 tabular-nums" style={{ color: 'var(--signal-hold)' }}>{fill(a.alertAt, { level: formatAlertLevel(watched, locale) })}</p>
      ) : null}
    </div>
  );
  const row = (asset: WatchAsset) => {
    const alerts = asset.alerts ?? [];
    const active = alerts.filter((item) => item.status === 'active');
    const reached = alerts.filter((item) => item.status === 'triggered');
    const on = active.length > 0;
    const watchedAt = (side: 'above' | 'below') => active.find((item) => item.side === side)?.level ?? null;
    const canAlert = data.alertsAvailable === true && Boolean(asset.levels && (asset.levels.above || asset.levels.below));
    const busy = alert.isPending && alert.variables?.symbol === asset.symbol;
    const analyzeUrl = `${base}/new?asset=${encodeURIComponent(asset.symbol)}`;
    return (
    <li key={asset.symbol} className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold text-[var(--text-primary)]">{asset.symbol}</span>
          {asset.levels?.trend ? (
            <span className="rounded-full bg-[var(--fill-3)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">{trendText[asset.levels.trend]}</span>
          ) : null}
          {asset.levels ? (
            <span className="tk-meta tabular-nums">{`${a.price} ${formatAlertLevel(asset.levels.price, locale)} · ${formatUtcTime(new Date(asset.levels.candleAt).toISOString())}`}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAlert || on ? (
            <button
              type="button"
              aria-pressed={on}
              disabled={busy}
              onClick={() => {
                track('watch_asset_alert_toggled', { symbol: asset.symbol, on: !on });
                alert.mutate({ symbol: asset.symbol, on: !on });
              }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                on
                  ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                  : 'border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--fill-2)]'
              }`}
            >
              <span key={on ? 'on' : 'off'}>{on ? a.alertOn : a.alertOff}</span>
            </button>
          ) : null}
          <Link
            to={analyzeUrl}
            onClick={() => track('watch_assets_analyze_clicked', { symbol: asset.symbol })}
            className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--fill-2)]"
          >
            {a.analyze}
          </Link>
        </div>
      </div>
      {reached.map((item) => (
        <div key={item.id} role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--fill-2)] px-3 py-2.5">
          <p className="text-sm font-medium tabular-nums text-[var(--text-primary)]">
            {fill(a.alertReached, { level: formatAlertLevel(item.level, locale), time: item.triggeredAt ? formatUtcTime(item.triggeredAt) : '' })}
          </p>
          <div className="flex gap-2">
            <Link
              to={`${analyzeUrl}&alert=${encodeURIComponent(item.id)}`}
              onClick={() => track('setup_alert_update_clicked', { alertId: item.id, setupId: null, surface: 'assets' })}
              className="rounded-lg bg-[var(--inverse-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--inverse-fg)] hover:opacity-90"
            >
              {a.analyze}
            </Link>
            <button
              type="button"
              onClick={() => seen.mutate(item.id, { onSuccess: () => query.refetch() })}
              className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--fill-3)]"
            >
              {a.alertDismiss}
            </button>
          </div>
        </div>
      ))}
      {asset.levels ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {level(a.above, asset.levels.above, watchedAt('above'))}
          {level(a.below, asset.levels.below, watchedAt('below'))}
        </div>
      ) : null}
      {on ? <p className="tk-meta">{a.alertHint}</p> : null}
      {alert.isError && alert.variables?.symbol === asset.symbol ? (
        <p role="status" className="text-sm" style={{ color: 'var(--signal-sell)' }}>{a.alertFailed}</p>
      ) : null}
      {asset.status !== 'ok' ? <p className="tk-meta">{asset.status === 'stale' ? a.stale : a.unavailable}</p> : null}
    </li>
    );
  };

  return (
    <section className={card} aria-labelledby="my-assets-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="my-assets-title" className="tk-stat-label mb-1">{a.title}</h2>
          <p className="tk-meta">{fill(a.meta, { tf: data.timeframe })}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            track('watch_assets_edit_clicked', {});
            startEdit();
          }}
          className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--fill-2)]"
        >
          {a.edit}
        </button>
      </div>
      {quizLine ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--fill-2)] px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-[var(--text-primary)]">{quizLine}</p>
          <Link
            to={`${base}/new${data.assets[0] ? `?asset=${encodeURIComponent(data.assets[0].symbol)}` : ''}`}
            onClick={() => track('onboarding_quiz_cta_clicked', { pain: quiz.pain })}
            className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] hover:opacity-90"
          >
            {t.quiz.cta}
          </Link>
        </div>
      ) : null}
      <ul className="flex flex-col gap-4">{data.assets.map(row)}</ul>
    </section>
  );
};

export default MyAssets;
