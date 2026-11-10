import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { TriangleAlert } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { getSubscription, openBillingPortal } from "@/lib/stripe";
import { track } from "@/lib/analytics";

/**
 * Aviso de pagamento recusado (20/10/2026). Quem tem a renovacao recusada fica
 * `past_due` (ou `unpaid`): o acesso pago some, o painel passa a tratar a conta
 * como gratuita e o unico sinal do problema morava em Configuracoes. Aqui o
 * aviso aparece no topo de qualquer area do painel, com o botao que abre o
 * portal da Stripe direto para trocar o cartao.
 *
 * Le `GET /stripe/subscription` (o mesmo de Configuracoes) uma vez por abertura
 * do painel. Quem nunca assinou recebe `null` (so consulta ao banco). Falha na
 * leitura nao mostra nada: o aviso e um reforco, nunca uma tela de erro.
 */
const PaymentFailedBanner = () => {
  const { t } = useLanguage();
  const s = t.settings;
  const { getToken: clerkGetToken } = useAuth();
  const getTokenRef = useRef(clerkGetToken);
  getTokenRef.current = clerkGetToken;

  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const viewedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) return;
        const subscription = await getSubscription(token);
        if (cancelled || !subscription || 'manualAccess' in subscription) return;
        const status = subscription.status;
        if ((status === 'past_due' || status === 'unpaid') && subscription.manageable) {
          setVisible(true);
          if (!viewedRef.current) {
            viewedRef.current = true;
            track('billing_alert_viewed', { status });
          }
        }
      } catch {
        /* sem leitura, sem aviso */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const openPortal = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    track('billing_alert_clicked');
    try {
      const token = await getTokenRef.current({ skipCache: true });
      if (!token) throw new Error('no token');
      await openBillingPortal(token);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--signal-hold)' }} aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{s.statusPastDue}</p>
          {failed ? <p className="mt-1 text-xs text-[var(--text-secondary)]">{s.actionFailed}</p> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void openPortal()}
        disabled={busy}
        className="shrink-0 rounded-lg bg-[var(--inverse-bg)] px-4 py-2 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? '…' : s.updateCard}
      </button>
    </div>
  );
};

export default PaymentFailedBanner;
