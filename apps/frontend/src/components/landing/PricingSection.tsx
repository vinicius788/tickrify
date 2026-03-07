import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createCheckoutSession, type BillingCycle } from '../../lib/stripe';
import { useToast } from '../../hooks/use-toast';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

const SESSION_STORAGE_KEY = 'pendingProBillingCycle';
const ENABLE_ANNUAL_BILLING = import.meta.env.VITE_ENABLE_ANNUAL_BILLING === 'true';

const BILLING_OPTIONS: Record<
  BillingCycle,
  { priceLabel: string; periodLabel: string; helper: string; referencePriceLabel?: string; isBeta?: boolean }
> = {
  monthly: {
    priceLabel: '49,90',
    periodLabel: '/mês',
    helper: 'Oferta beta para os primeiros 50 assinantes',
    referencePriceLabel: '79,90',
    isBeta: true,
  },
  annual: {
    priceLabel: '599,00',
    periodLabel: '/ano',
    helper: 'Cobrança anual recorrente (equivalente a R$49,90/mês)',
  },
};

const FREE_FEATURES = [
  { included: true, text: '3 análises por mês' },
  { included: true, text: 'Todos os mercados (Forex, Cripto, Ações)' },
  { included: true, text: 'Entry, Stop e Take automáticos' },
  { included: true, text: 'Análise técnica detalhada com reasoning' },
  { included: false, text: 'Histórico ilimitado' },
  { included: false, text: 'Suporte prioritário' },
];

const PRO_FEATURES = [
  { included: true, text: 'Análises ilimitadas' },
  { included: true, text: 'Histórico ilimitado' },
  { included: true, text: 'Gestão de risco automática' },
  { included: true, text: 'Exportação avançada' },
  { included: true, text: 'Suporte prioritário' },
  { included: true, text: 'API de integração' },
];

const PricingSection = () => {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { toast } = useToast();
  const revealRef = useReveal<HTMLElement>();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [loadingCycle, setLoadingCycle] = useState<BillingCycle | null>(null);
  const [processingUpgrade, setProcessingUpgrade] = useState(false);

  const normalizeCycle = useCallback(
    (cycle: BillingCycle): BillingCycle => (cycle === 'annual' && !ENABLE_ANNUAL_BILLING ? 'monthly' : cycle),
    [],
  );

  const handleUpgrade = useCallback(
    async (cycle: BillingCycle) => {
      if (!isSignedIn) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, normalizeCycle(cycle));
        window.location.href = '/sign-in';
        return;
      }

      try {
        const normalizedCycle = normalizeCycle(cycle);
        setLoadingCycle(normalizedCycle);

        const token = await getToken();
        if (!token) {
          throw new Error('Não foi possível obter token de autenticação');
        }

        const { url } = await createCheckoutSession('pro', token, normalizedCycle);
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        window.location.href = url;
      } catch (error) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        toast({
          title: 'Erro ao processar pagamento',
          description:
            error instanceof Error
              ? error.message
              : 'Falha ao criar sessão de checkout. Tente novamente em instantes.',
          variant: 'destructive',
        });
      } finally {
        setLoadingCycle(null);
        setProcessingUpgrade(false);
      }
    },
    [getToken, isSignedIn, normalizeCycle, toast],
  );

  useEffect(() => {
    const processUpgrade = async () => {
      if (!isLoaded || !isSignedIn || processingUpgrade) {
        return;
      }

      const pendingCycle = sessionStorage.getItem(SESSION_STORAGE_KEY) as BillingCycle | null;
      if (pendingCycle === 'monthly' || pendingCycle === 'annual') {
        const normalizedCycle = normalizeCycle(pendingCycle);
        setProcessingUpgrade(true);
        setBillingCycle(normalizedCycle);
        await handleUpgrade(normalizedCycle);
      }
    };

    void processUpgrade();
  }, [handleUpgrade, isLoaded, isSignedIn, normalizeCycle, processingUpgrade]);

  if (processingUpgrade) {
    return (
      <section id="planos" className="py-28">
        <div className="container flex min-h-[280px] items-center justify-center">
          <p className="font-terminal text-sm text-[var(--text-secondary)]">Processando assinatura...</p>
        </div>
      </section>
    );
  }

  const selected = BILLING_OPTIONS[billingCycle];
  const [priceMajor, priceMinor = '00'] = selected.priceLabel.split(',');
  const isLoading = loadingCycle === billingCycle;

  return (
    <section ref={revealRef} id="planos" className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle align="center" label="Planos" title="Escolha seu" highlight="ritmo operacional." />

        <div
          className="mx-auto mb-8 mt-8 flex max-w-2xl flex-col items-center justify-center gap-2 rounded-lg border px-4 py-3 text-center sm:flex-row sm:text-left"
          style={{ borderColor: 'rgba(0,210,106,0.3)', backgroundColor: 'rgba(0,210,106,0.06)' }}
        >
          <span className="font-terminal text-xs text-[var(--signal-buy)]">⚡ OFERTA BETA</span>
          <span className="text-sm text-[var(--text-secondary)]">
            Primeiros 50 assinantes pagam <strong className="text-[var(--text-primary)]">R$49,90/mês</strong> — preço
            sobe para R$79,90 após lotação.
          </span>
          <span className="whitespace-nowrap font-terminal text-xs text-[var(--text-muted)]">23 vagas restantes</span>
        </div>

        <div className="flex items-center justify-center">
          <div className="inline-flex rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1">
            <Button
              size="sm"
              onClick={() => setBillingCycle('monthly')}
              className={billingCycle === 'monthly' ? 'bg-[var(--signal-buy)] text-black hover:opacity-90' : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]'}
            >
              Mensal
            </Button>
            {ENABLE_ANNUAL_BILLING ? (
              <Button
                size="sm"
                onClick={() => setBillingCycle('annual')}
                className={billingCycle === 'annual' ? 'bg-[var(--signal-buy)] text-black hover:opacity-90' : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]'}
              >
                Anual
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <article className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <p className="font-terminal text-xs uppercase tracking-widest text-[var(--text-secondary)]">Free</p>
            <p className="mt-3 font-display text-5xl font-semibold text-[var(--text-primary)]">
              <span className="text-2xl">R$</span>0
              <span className="ml-2 text-base font-medium text-[var(--text-secondary)]">/mês</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {FREE_FEATURES.map((feature) => (
                <li
                  key={feature.text}
                  className={`flex items-center gap-2 ${feature.included ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
                >
                  {feature.included ? (
                    <Check className="h-4 w-4 text-[var(--signal-buy)]" />
                  ) : (
                    <X className="h-4 w-4 text-[var(--text-muted)]" />
                  )}
                  {feature.text}
                </li>
              ))}
            </ul>
            <Button
              asChild
              variant="outline"
              className="mt-6 w-full border-[var(--border-default)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]"
            >
              <a href="/sign-in">Começar Grátis — sem cartão</a>
            </Button>
          </article>

          <article
            className="rounded-xl border border-[var(--signal-buy)] bg-[var(--bg-elevated)] p-5"
            style={{ boxShadow: '0 0 30px rgba(0,210,106,0.12)' }}
          >
            <div className="mb-3 inline-flex rounded-full border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-1 font-terminal text-[10px] uppercase tracking-widest text-[var(--signal-buy)]">
              MAIS POPULAR
            </div>
            <p className="font-terminal text-xs uppercase tracking-widest text-[var(--text-secondary)]">Pro</p>
            {selected.referencePriceLabel ? (
              <div className="mb-1 mt-3 flex items-baseline gap-1">
                <span className="text-sm text-[var(--text-muted)] line-through">R${selected.referencePriceLabel}</span>
                {selected.isBeta ? (
                  <span className="rounded bg-[var(--signal-buy-bg)] px-1.5 py-0.5 font-terminal text-xs text-[var(--signal-buy)]">
                    BETA
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="mt-3" />
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-sm text-[var(--text-secondary)]">R$</span>
              <span
                style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '3rem', color: 'var(--text-primary)' }}
              >
                {priceMajor}
              </span>
              <span className="text-[var(--text-secondary)]">
                ,{priceMinor}
                {selected.periodLabel}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{selected.helper}</p>

            <ul className="mt-5 space-y-2 text-sm">
              {PRO_FEATURES.map((feature) => (
                <li key={feature.text} className="flex items-center gap-2 text-[var(--text-primary)]">
                  <Check className="h-4 w-4 text-[var(--signal-buy)]" /> {feature.text}
                </li>
              ))}
            </ul>

            <Button
              onClick={() => handleUpgrade(billingCycle)}
              disabled={isLoading}
              className="mt-6 w-full bg-[var(--signal-buy)] font-semibold uppercase tracking-wide text-black hover:opacity-90"
            >
              {isLoading ? 'Processando...' : 'Assinar Pro'}
            </Button>
          </article>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
