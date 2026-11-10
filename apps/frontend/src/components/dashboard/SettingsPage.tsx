import { LOCALES, formatUsd } from '@/lib/i18n';
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { CreditCard, ExternalLink, Moon, RotateCcw, Sun } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { getSubscription, openBillingPortal, reactivateSubscription, type SubscriptionSummary } from "@/lib/stripe";
import { saveThemeToServer, useTheme, type Theme } from "@/lib/theme";

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type Load = 'loading' | 'ready' | 'failed';

/**
 * Configuracoes (/dashboard/settings, 13/10/2026): conta e plano (status,
 * valor, proxima cobranca, portal da Stripe para cartao/faturas/cancelar e
 * reativar um cancelamento agendado) e aparencia (tema claro ou escuro).
 *
 * Cancelar e no portal da Stripe, sem tela de retencao: o botao leva direto.
 * O servidor recusa o portal para quem nao tem assinatura; a tela nem mostra.
 */
const SettingsPage = ({ eyebrow }: { eyebrow: ReactNode }) => {
  const { t, language } = useLanguage();
  const s = t.settings;
  const { getToken: clerkGetToken } = useAuth();
  // Le a assinatura so ao abrir a tela, mesmo que a funcao do Clerk mude de identidade.
  const getTokenRef = useRef(clerkGetToken);
  getTokenRef.current = clerkGetToken;
  const getToken = useCallback(() => getTokenRef.current(), []);
  const [theme, setTheme] = useTheme();
  const [load, setLoad] = useState<Load>('loading');
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [manualAccess, setManualAccess] = useState(false);
  const [busy, setBusy] = useState<'portal' | 'reactivate' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const formatDate = (seconds: number | null) =>
    seconds
      ? new Date(seconds * 1000).toLocaleDateString(DATE_LOCALES[language] ?? 'en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : '';

  const refresh = useCallback(async () => {
    setLoad('loading');
    try {
      const token = await getToken();
      if (!token) throw new Error('no token');
      const result = await getSubscription(token);
      const manual = result !== null && 'manualAccess' in result;
      setManualAccess(manual);
      setSubscription(manual ? null : result);
      window.dispatchEvent(new Event('tickrify:analysis-created'));
      setLoad('ready');
    } catch {
      setLoad('failed');
    }
  }, [getToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const openPortal = async (intent?: 'upgrade') => {
    if (busy) return;
    setBusy('portal');
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('no token');
      if (intent) await openBillingPortal(token, intent);
      else await openBillingPortal(token);
    } catch {
      setBusy(null);
      setMessage({ kind: 'error', text: s.actionFailed });
    }
  };

  const reactivate = async () => {
    if (busy) return;
    setBusy('reactivate');
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('no token');
      setSubscription(await reactivateSubscription(token));
      setMessage({ kind: 'ok', text: s.reactivated });
    } catch {
      setMessage({ kind: 'error', text: s.actionFailed });
    } finally {
      setBusy(null);
    }
  };

  const chooseTheme = async (next: Theme) => {
    if (next === theme) return;
    setTheme(next);
    const token = await getToken().catch(() => null);
    if (token) void saveThemeToServer(token, next);
  };

  const cycleLabel =
    subscription?.billingCycle === 'weekly'
      ? s.cycleWeekly
      : subscription?.billingCycle === 'yearly'
        ? s.cycleYearly
        : s.cycleMonthly;
  const per =
    subscription?.billingCycle === 'weekly' ? s.perWeek : subscription?.billingCycle === 'yearly' ? s.perYear : s.perMonth;
  const currency = (subscription?.currency ?? 'usd').toUpperCase();
  const price =
    subscription?.amount != null
      ? `${
          currency === 'USD'
            ? formatUsd(subscription.amount, language)
            : subscription.amount.toLocaleString(LOCALES[language], { style: 'currency', currency })
        } / ${per}`
      : null;

  const status = subscription?.status ?? '';
  const ended = status === 'canceled' || status === 'incomplete_expired';
  const pastDue = status === 'past_due' || status === 'unpaid';
  const statusText = !subscription
    ? ''
    : ended
      ? s.statusEnded.replace('{date}', formatDate(subscription.accessEndsAt ?? subscription.currentPeriodEnd))
      : pastDue
        ? s.statusPastDue
        : subscription.cancelAtPeriodEnd
          ? s.statusCanceled.replace('{date}', formatDate(subscription.accessEndsAt))
          : s.statusActive.replace('{date}', formatDate(subscription.currentPeriodEnd));
  const statusTone = ended || pastDue || subscription?.cancelAtPeriodEnd ? 'var(--signal-hold)' : 'var(--signal-buy)';

  const card = 'rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 md:p-6';
  const row = 'flex items-center justify-between gap-4 border-t border-[var(--border-subtle)] py-3 text-sm';

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        {eyebrow}
        <h1 className="tk-display mt-2 text-2xl md:text-3xl">{s.title}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{s.sub}</p>
      </div>

      <section className={card} aria-labelledby="settings-account">
        <h2 id="settings-account" className="tk-stat-label mb-4">
          {s.accountTitle}
        </h2>

        {load === 'loading' ? (
          <p key="loading" className="text-sm text-[var(--text-secondary)]">{s.loading}</p>
        ) : load === 'failed' ? (
          <div key="failed" className="flex flex-col items-start gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{s.loadFailed}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
            >
              {s.retry}
            </button>
          </div>
        ) : manualAccess ? (
          <p key="manual" data-testid="manual-access" className="flex items-center gap-2 text-base font-medium text-[var(--text-primary)]">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--signal-buy)' }} />
            <span>{s.manualAccess}</span>
          </p>
        ) : !subscription ? (
          <div key="none" className="flex flex-col items-start gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{s.noSubscription}</p>
            <Link
              to="/dashboard/plans"
              className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
            >
              {s.seePlans}
            </Link>
          </div>
        ) : (
          <div key="subscription">
            <p className="mb-3 flex items-center gap-2 text-base font-medium text-[var(--text-primary)]">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: statusTone }} />
              <span>{statusText}</span>
            </p>
            <div className={row}>
              <span className="text-[var(--text-secondary)]">{s.planLabel}</span>
              <span className="text-[var(--text-primary)]">{cycleLabel}</span>
            </div>
            {price ? (
              <div key="price" className={row}>
                <span className="text-[var(--text-secondary)]">{s.priceLabel}</span>
                <span className="tabular-nums text-[var(--text-primary)]">{price}</span>
              </div>
            ) : null}
            {ended ? null : (
              <div key="next" className={row}>
                <span className="text-[var(--text-secondary)]">{s.nextChargeLabel}</span>
                <span className="text-[var(--text-primary)]">
                  {subscription.nextChargeAt ? formatDate(subscription.nextChargeAt) : s.nextChargeNone}
                </span>
              </div>
            )}

            {subscription.pendingPayment ? <p role="status">{s.pendingPayment}</p> : null}
            {subscription.scheduledChange ? <div role="status">
              <p>{s.scheduledChange.replace('{cycle}', subscription.scheduledChange.billingCycle === 'weekly' ? s.cycleWeekly : s.cycleMonthly).replace('{date}', formatDate(subscription.scheduledChange.effectiveAt))}</p>
            </div> : null}
            {ended ? (
              <div key="ended" className="mt-4 flex flex-col items-start gap-3 border-t border-[var(--border-subtle)] pt-4">
                <p className="text-sm text-[var(--text-secondary)]">{s.readMode}</p>
                <Link
                  to="/dashboard/plans"
                  className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
                >
                  {s.seePlans}
                </Link>
              </div>
            ) : (
              <div key="actions" className="mt-4 flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
                <div className="flex flex-wrap gap-2">
                  {subscription.canReactivate ? (
                    <button
                      key="reactivate"
                      type="button"
                      onClick={() => void reactivate()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>{s.reactivate}</span>
                    </button>
                  ) : null}
                  {subscription.canChangePlans ? (
                    <button type="button" onClick={() => void openPortal('upgrade')} disabled={busy !== null}
                      className="rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] disabled:opacity-60">
                      {s.upgradeMonthly}
                    </button>
                  ) : null}
                  {subscription.manageable ? (
                    <button
                      key="portal"
                      type="button"
                      onClick={() => void openPortal()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)] disabled:opacity-60"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>{s.manage}</span>
                      <ExternalLink className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    </button>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{subscription.canChangePlans ? s.planChangeHint : s.manageHint}</p>
              </div>
            )}
          </div>
        )}

        {message ? (
          <p
            key={`message-${message.kind}`}
            role="status"
            className="mt-3 text-sm"
            style={{ color: message.kind === 'ok' ? 'var(--signal-buy)' : 'var(--signal-sell)' }}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      <section className={card} aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className="tk-stat-label mb-1">
          {s.appearanceTitle}
        </h2>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">{s.appearanceSub}</p>
        <div role="radiogroup" aria-label={s.appearanceTitle} className="grid max-w-sm grid-cols-2 gap-2">
          {(['dark', 'light'] as const).map((option) => {
            const active = theme === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void chooseTheme(option)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-transparent bg-[var(--inverse-bg)] text-[var(--inverse-fg)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]'
                }`}
              >
                {option === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                <span>{option === 'dark' ? s.themeDark : s.themeLight}</span>
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-[var(--text-secondary)]">{s.help}</p>
    </div>
  );
};

export default SettingsPage;
