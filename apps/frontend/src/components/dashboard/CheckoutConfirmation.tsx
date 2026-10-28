import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCheckoutStatus } from '@/lib/stripe';
import { track, trackAdConversion } from '@/lib/analytics';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Button } from '@/components/ui/button';

/** A return URL is not proof of payment. This component never grants access. */
export default function CheckoutConfirmation({ hasPaidAccess = false }: { hasPaidAccess?: boolean }) {
  const { getToken } = useAuth();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const c = t.commercial;
  const [checkout] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('success') === 'true' ? { sessionId: params.get('session_id') } : null;
  });
  const [state, setState] = useState<'checking' | 'pending' | 'paid'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const tracked = useRef(false);

  useEffect(() => {
    if (!checkout) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!tracked.current) {
      track('checkout_success_viewed', { sessionId: checkout.sessionId });
      tracked.current = true;
    }
    setState('checking');
    const check = async (remaining: number) => {
      try {
        const token = await tokenRef.current({ skipCache: true });
        const status = token && checkout.sessionId
          ? await getCheckoutStatus(token, { sessionId: checkout.sessionId, outcome: 'success' })
          : null;
        if (canceled) return;
        if (status?.paid === true && status.sessionId === checkout.sessionId && status.sessionId) {
          setState('paid');
          trackAdConversion('purchase', {
            eventId: `purchase_${status.sessionId}`, transactionId: status.sessionId,
            value: status.value ?? 0, currency: status.currency ?? 'USD',
          });
          window.dispatchEvent(new Event('tickrify:analysis-created'));
          void queryClient.invalidateQueries();
          const url = new URL(window.location.href);
          url.searchParams.delete('success');
          url.searchParams.delete('session_id');
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        } else if (remaining > 0 && token && checkout.sessionId) {
          timer = setTimeout(() => void check(remaining - 1), 3000);
        } else setState('pending');
      } catch {
        if (!canceled) setState('pending');
      }
    };
    void check(2);
    return () => { canceled = true; clearTimeout(timer); };
  }, [checkout, attempt, queryClient]);

  // Payment may precede the webhook. Re-read access a bounded number of times;
  // only the existing usage endpoint can confirm the subscription entitlement.
  useEffect(() => {
    if (state !== 'paid') return;
    if (hasPaidAccess) {
      void queryClient.invalidateQueries();
      return;
    }
    let checksLeft = 4;
    const refresh = () => {
      window.dispatchEvent(new Event('tickrify:analysis-created'));
      if (--checksLeft > 0) timer = setTimeout(refresh, 3000);
    };
    let timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [state, hasPaidAccess, accessAttempt, queryClient]);

  if (!checkout || (state === 'paid' && hasPaidAccess)) return null;
  return (
    <div role="status" className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)]">
        {state === 'paid' ? c.paymentConfirmed : state === 'checking' ? c.paymentChecking : c.paymentPending}
      </p>
      {state !== 'paid' ? <p className="text-xs text-[var(--text-secondary)]">{state === 'checking' ? c.paymentCheckingDesc : c.paymentPendingDesc}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {state === 'pending' ? <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>{c.paymentRetry}</Button> : null}
        {state === 'paid' ? <Button size="sm" variant="outline" onClick={() => { window.dispatchEvent(new Event('tickrify:analysis-created')); setAccessAttempt((n) => n + 1); }}>{c.paymentRetry}</Button> : null}
        <Link to="/dashboard/settings" className="text-xs text-[var(--text-secondary)] underline underline-offset-2">{c.paymentSettings}</Link>
      </div>
    </div>
  );
}
