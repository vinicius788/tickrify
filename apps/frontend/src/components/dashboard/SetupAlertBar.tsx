import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellPlus, BellRing, BookmarkCheck, BookmarkPlus, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { track } from '@/lib/analytics';
import { APIError } from '@/lib/api';
import {
  formatAlertLevel,
  parseAlertLevel,
  useAlertActions,
  useAlertOptions,
  useSetupActions,
  useSetupForAnalysis,
  type AlertLabel,
  type SetupVerdict,
} from '@/lib/setups';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

/**
 * "Alert me when price reaches" abaixo do resultado (27/10/2026), no lugar do
 * antigo "Follow setup": um botao so, que cria o alerta e segue o setup no
 * mesmo clique. Os niveis vem preenchidos pelo servidor (entrada, stop, TP1,
 * invalidacao; no WAIT, o que a leitura tiver) e a pessoa pode digitar outro.
 *
 * WATCH com o alerta automatico valendo (09/11/2026): em vez do formulario, a
 * frase de que o trader sera avisado e um botao para cancelar. Cancelou, o
 * formulario volta.
 *
 * Ativo sem fonte de preco (sinteticos, acoes, ETF): a tela diz que nao ha
 * alerta e oferece so seguir. Gratis esgotado: o servidor responde 402 e o
 * cartao nao aparece.
 */
const SetupAlertBar = ({ analysisId, recommendation, base }: { analysisId: string; recommendation: SetupVerdict; base: string }) => {
  const { t, language } = useLanguage();
  const a = t.alerts;
  const s = t.setups;
  const locale = DATE_LOCALES[language] ?? 'en-US';
  const { toast } = useToast();
  const options = useAlertOptions(analysisId);
  const setupQuery = useSetupForAnalysis(analysisId);
  const { follow, setStatus } = useSetupActions();
  const { create, cancel } = useAlertActions();
  const suggestions = useMemo(() => options.data?.suggestions ?? [], [options.data]);
  const [selected, setSelected] = useState<AlertLabel>('custom');
  const [value, setValue] = useState('');

  useEffect(() => {
    const first = suggestions[0];
    setSelected(first ? first.label : 'custom');
    setValue(first ? String(first.level) : '');
  }, [suggestions]);

  if (options.isLoading || options.isError || !options.data) return null;
  const data = options.data;
  const setup = setupQuery.data?.setup ?? null;
  const following = setup?.status === 'tracking';
  const activeAlerts = data.alerts.filter((alert) => alert.status === 'active');
  const busy = follow.isPending || setStatus.isPending || create.isPending;
  const labelText: Record<AlertLabel, string> = {
    entry: a.labelEntry,
    stop: a.labelStop,
    tp1: a.labelTp1,
    invalidation: a.labelInvalidation,
    custom: a.labelCustom,
  };

  const choose = (label: AlertLabel) => {
    setSelected(label);
    const suggestion = suggestions.find((item) => item.label === label);
    if (suggestion) setValue(String(suggestion.level));
  };

  const onSubmit = () => {
    const level = parseAlertLevel(value);
    if (level === null) {
      toast({ title: a.invalidLevel, variant: 'destructive' });
      return;
    }
    const suggestion = suggestions.find((item) => item.label === selected);
    const label: AlertLabel = suggestion && suggestion.level === level ? selected : 'custom';
    create.mutate(
      { analysisId, label, level },
      {
        onSuccess: () => toast({ title: a.created.replace('{level}', formatAlertLevel(level, locale)) }),
        onError: (error) => {
          const code = error instanceof APIError ? error.code : undefined;
          if (code === 'alert_limit') {
            toast({
              title: a.limitTitle.replace('{n}', String(data.limits.maxSetups)),
              description: data.limits.maxSetups < 10 ? a.limitDescFree : a.limitDesc,
            });
          } else if (code === 'alert_setup_limit') {
            toast({ title: a.limitSetupTitle.replace('{n}', String(data.limits.perSetup)), description: a.limitDesc });
          } else if (code === 'alert_level_out_of_range' || code === 'alert_level_at_price' || code === 'alert_level_mismatch') {
            toast({ title: a.invalidLevel, variant: 'destructive' });
          } else if (code === 'setup_limit') {
            toast({ title: s.limitTitle, description: s.limitDesc });
          } else {
            toast({ title: a.failed, variant: 'destructive' });
          }
        },
      },
    );
  };

  const onFollow = () => {
    track('setup_follow_clicked', { surface: 'result', recommendation });
    follow.mutate(analysisId, {
      onError: (error) => {
        if (error instanceof APIError && error.code === 'setup_limit') {
          toast({ title: s.limitTitle, description: s.limitDesc });
          return;
        }
        toast({ title: s.followFailed, variant: 'destructive' });
      },
    });
  };

  const onUnfollow = () => {
    if (!setup) return;
    setStatus.mutate(
      { setupId: setup.id, status: 'untracked' },
      {
        onSuccess: () => toast({ title: s.unfollowed }),
        onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
      },
    );
  };

  const followingLine = following && setup ? (
    <div key="following" className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
        <BookmarkCheck className="h-4 w-4 text-[var(--accent-green)]" />
        <span>{s.following}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`${base}/setups/${encodeURIComponent(setup.id)}`}
          onClick={() => track('setup_opened', { setupId: setup.id, surface: 'result' })}
          className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
        >
          {s.openSetup}
        </Link>
        <button
          type="button"
          onClick={onUnfollow}
          disabled={busy}
          className="rounded-lg px-2 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {s.unfollow}
        </button>
      </div>
    </div>
  ) : null;

  if (data.autoAlertPending) return null;

  if (data.watchAlert) {
    const { id, level } = data.watchAlert;
    return (
      <div key="watch-alert" className="flex flex-col gap-3 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-card)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BellRing className="h-4 w-4 shrink-0" />
          <span>{(data.emailEnabled ? a.watchingEmail : a.watchingScreen).replace('{level}', formatAlertLevel(level, locale))}</span>
        </p>
        <button
          type="button"
          onClick={() =>
            cancel.mutate(id, {
              onSuccess: () => toast({ title: a.cancelled }),
              onError: () => toast({ title: s.actionFailed, variant: 'destructive' }),
            })
          }
          disabled={cancel.isPending}
          className="inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {a.cancel}
        </button>
      </div>
    );
  }

  if (!data.available) {
    return (
      <div key="unavailable" className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
        {followingLine}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{a.unavailable}</p>
            {following ? null : <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{s.followHint}</p>}
          </div>
          {following ? null : (
            <button
              type="button"
              onClick={onFollow}
              disabled={busy}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <BookmarkPlus className="h-4 w-4" /> {s.follow}
            </button>
          )}
        </div>
      </div>
    );
  }

  const chips: AlertLabel[] = [...suggestions.map((item) => item.label), 'custom'];
  return (
    <div
      key="alerts"
      className={`flex flex-col gap-4 rounded-2xl border bg-[var(--bg-card)] px-5 py-4 ${
        recommendation === 'WAIT' || !following ? 'border-[var(--border-accent)]' : 'border-[var(--border-subtle)]'
      }`}
    >
      {followingLine}

      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BellPlus className="h-4 w-4" />
          <span>{a.title}</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          {`${data.symbolClass === 'crypto' ? (data.emailEnabled ? a.hintEmail : a.hintScreen) : (data.emailEnabled ? a.hintEmailFx : a.hintScreenFx)}${following ? '' : ` ${a.followsToo}`}`}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={a.title}>
        {chips.map((label) => {
          const suggestion = suggestions.find((item) => item.label === label);
          const active = selected === label;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(label)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? 'border-[var(--inverse-bg)] bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                  : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {suggestion ? `${labelText[label]} ${formatAlertLevel(suggestion.level, locale)}` : labelText[label]}
            </button>
          );
        })}
      </div>
      {suggestions.length === 0 ? <p className="text-xs text-[var(--text-secondary)]">{a.typeLevel}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={a.levelInput}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSelected('custom');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit();
          }}
          className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2.5 font-terminal text-base text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)] sm:max-w-[220px]"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <BellRing className="h-4 w-4" /> {a.set}
        </button>
      </div>

      {activeAlerts.length > 0 ? (
        <div key="active" className="border-t border-[var(--border-subtle)] pt-3">
          <p className="tk-stat-label">{a.activeTitle}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {activeAlerts.map((alert) => (
              <li key={alert.id} className="flex items-center justify-between gap-2 font-terminal text-xs text-[var(--text-primary)]">
                <span>{`${labelText[alert.label]} ${formatAlertLevel(alert.level, locale)} · ${alert.side === 'above' ? a.rises : a.falls}`}</span>
                <button
                  type="button"
                  onClick={() => cancel.mutate(alert.id, { onSuccess: () => toast({ title: a.cancelled }) })}
                  disabled={cancel.isPending}
                  aria-label={a.cancel}
                  className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default SetupAlertBar;
