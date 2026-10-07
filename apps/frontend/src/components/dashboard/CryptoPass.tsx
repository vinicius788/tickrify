import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAnalysisLimit } from '@/hooks/useAnalysisLimit';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { createCryptoCheckout, CryptoCheckoutError, getCryptoPaymentStatus, type CryptoPass } from '@/lib/crypto-checkout';

/**
 * Passe pre-pago em cripto (NOWPayments, 07/10/2026). Existe porque nos paises
 * emergentes o BANCO recusa o cartao em dolar: a pessoa quer pagar e nao
 * consegue. Fica sempre como alternativa ao cartao, nunca no lugar dele.
 *
 * `surface`: de onde veio o clique, em todo evento do PostHog.
 */
export type CryptoSurface = 'paywall' | 'plans' | 'pricing' | 'plan_card' | 'pass_ended';

export function CryptoPassDialog({
  open,
  onOpenChange,
  surface,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surface: CryptoSurface;
}) {
  const { t } = useLanguage();
  const c = t.crypto;
  const { getToken } = useAuth();
  const [pending, setPending] = useState<CryptoPass | null>(null);
  const [error, setError] = useState('');

  const choose = async (pass: CryptoPass) => {
    if (pending) return;
    setPending(pass);
    setError('');
    track('crypto_checkout_started', { pass, surface });
    try {
      const token = await getToken();
      if (!token) throw new CryptoCheckoutError('no_token', 'no_token');
      const { url } = await createCryptoCheckout(pass, token);
      window.location.href = url;
    } catch (err) {
      const code = err instanceof CryptoCheckoutError ? err.code ?? 'unknown' : 'unknown';
      track('crypto_checkout_failed', { pass, surface, code });
      setError(code === 'already_subscribed' ? c.alreadySubscribed : c.error);
      setPending(null);
    }
  };

  const options: Array<{ pass: CryptoPass; label: string; detail: string; price: string }> = [
    { pass: 'week', label: c.weekLabel, detail: c.weekDetail, price: c.weekPrice },
    { pass: 'month', label: c.monthLabel, detail: c.monthDetail, price: c.monthPrice },
  ];

  return (
    <Dialog open={open} onOpenChange={(value) => !pending && onOpenChange(value)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c.dialogTitle}</DialogTitle>
          <DialogDescription>{c.dialogDesc}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <button
              key={option.pass}
              type="button"
              onClick={() => void choose(option.pass)}
              disabled={Boolean(pending)}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] px-4 py-3 text-left transition-colors hover:border-[var(--accent-green)] disabled:opacity-60"
            >
              <span>
                <span className="block text-xs text-[var(--text-secondary)]">{option.label}</span>
                <span className="block text-sm font-semibold text-[var(--text-primary)]">{option.detail}</span>
              </span>
              <span className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
                {pending === option.pass ? <Loader2 className="h-4 w-4 animate-spin" aria-label={c.opening} /> : null}
                <span>{option.price}</span>
              </span>
            </button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-[var(--text-secondary)]">{c.oneTime}</p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Card declined? Pay with crypto". So aparece com o NOWPayments configurado
 * no servidor e para quem nao assina pelo cartao (o servidor recusa passe por
 * cima de assinatura de cartao).
 */
export function CryptoPayLink({ surface, className = '' }: { surface: CryptoSurface; className?: string }) {
  const { t } = useLanguage();
  const { crypto } = useAnalysisLimit();
  const [open, setOpen] = useState(false);
  if (!crypto?.enabled || crypto.paymentMethod === 'card' || crypto.paymentMethod === 'manual') return null;

  return (
    <>
      <p className={`text-xs text-[var(--text-secondary)] ${className}`}>
        <span>{t.crypto.cardDeclined} </span>
        <button
          type="button"
          onClick={() => {
            track('crypto_cta_clicked', { surface });
            setOpen(true);
          }}
          className="text-[var(--text-primary)] underline underline-offset-2 hover:opacity-80"
        >
          {t.crypto.payWithCrypto}
        </button>
      </p>
      <CryptoPassDialog open={open} onOpenChange={setOpen} surface={surface} />
    </>
  );
}

type ReturnState = 'confirming' | 'active' | 'canceled' | 'partial';

const POLL_MS = 10_000;
const POLL_LIMIT_MS = 30 * 60 * 1000;

/**
 * Volta da pagina do NOWPayments (`?crypto=success&order=<id>|canceled|partial`).
 * Na volta o pagamento ainda esta confirmando na blockchain: quem libera o
 * passe e o aviso do provedor ao servidor. A tela consulta o status DESTE
 * pagamento a cada 10 s (no maximo 30 min) e, quando ligar, rele o plano.
 */
export function CryptoReturnNotice() {
  const { t } = useLanguage();
  const c = t.crypto;
  const { getToken } = useAuth();
  const [state, setState] = useState<ReturnState | null>(null);
  const orderRef = useRef('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('crypto');
    if (!value) return;
    orderRef.current = params.get('order') ?? '';
    const next: ReturnState | null =
      value === 'success' ? 'confirming' : value === 'canceled' ? 'canceled' : value === 'partial' ? 'partial' : null;
    params.delete('crypto');
    params.delete('order');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    if (!next) return;
    track('crypto_return_viewed', { status: value });
    setState(next);
  }, []);

  useEffect(() => {
    if (state !== 'confirming' || !orderRef.current) return;
    const startedAt = Date.now();
    let stopped = false;
    const check = async () => {
      const token = await getToken();
      const payment = token ? await getCryptoPaymentStatus(orderRef.current, token) : null;
      if (stopped || !payment) return;
      if (payment.active) {
        stopped = true;
        setState('active');
        track('crypto_pass_seen_active');
        // Rele o plano (useAnalysisLimit) e tudo que estava travado.
        window.dispatchEvent(new Event('tickrify:analysis-created'));
      } else if (payment.status === 'partially_paid') {
        stopped = true;
        setState('partial');
      }
    };
    void check();
    const timer = window.setInterval(() => {
      if (stopped || Date.now() - startedAt > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        return;
      }
      void check();
    }, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [state, getToken]);

  if (!state) return null;

  const view = {
    confirming: { title: c.confirmingTitle, desc: c.confirmingDesc, tone: 'border-amber-500/30 bg-amber-500/[0.08]' },
    active: { title: c.activeTitle, desc: c.activeDesc, tone: 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/[0.08]' },
    canceled: { title: c.canceledTitle, desc: c.canceledDesc, tone: 'border-[var(--border-default)] bg-[var(--bg-card)]' },
    partial: { title: c.partialTitle, desc: c.partialDesc, tone: 'border-red-400/30 bg-red-400/[0.08]' },
  }[state];

  return (
    <div role="status" className={`mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 ${view.tone}`}>
      <span className="mt-0.5 shrink-0">
        {state === 'confirming' ? (
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
        ) : state === 'active' ? (
          <CheckCircle2 className="h-4 w-4 text-[var(--accent-green)]" />
        ) : (
          <CircleAlert className="h-4 w-4 text-[var(--text-secondary)]" />
        )}
      </span>
      <div>
        <p key={`t-${state}`} className="text-sm font-semibold text-[var(--text-primary)]">
          {view.title}
        </p>
        <p key={`d-${state}`} className="text-sm text-[var(--text-secondary)]">
          {view.desc}
        </p>
      </div>
    </div>
  );
}
