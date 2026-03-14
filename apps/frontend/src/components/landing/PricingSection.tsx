import { Check, X } from 'lucide-react';
import { SignInButton } from '@clerk/clerk-react';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

type Plan = {
  name: string;
  price: string;
  ticks: string;
  cta: string;
  highlight?: boolean;
  features: Array<{ included: boolean; text: string }>;
};

const plans: Plan[] = [
  {
    name: 'Free',
    price: 'R$0',
    ticks: '3 análises/mês',
    cta: 'Começar grátis',
    features: [
      { included: true, text: 'Análise rápida' },
      { included: true, text: 'Exportar resultado' },
      { included: false, text: 'Análise deep (3 Ticks)' },
      { included: false, text: 'Histórico operacional ilimitado' },
    ],
  },
  {
    name: 'Trader',
    price: 'R$49,90',
    ticks: '50 Ticks',
    cta: 'Comprar Ticks',
    highlight: true,
    features: [
      { included: true, text: 'Análise rápida (1 Tick)' },
      { included: true, text: 'Análise deep (3 Ticks)' },
      { included: true, text: 'Exportar PDF (2 Ticks)' },
      { included: true, text: 'Ticks não expiram' },
    ],
  },
  {
    name: 'Pro',
    price: 'R$129,90',
    ticks: '150 Ticks',
    cta: 'Comprar Ticks',
    features: [
      { included: true, text: 'Tudo do Trader' },
      { included: true, text: '-13% por Tick' },
      { included: true, text: 'Suporte prioritário' },
      { included: true, text: 'Maior eficiência por operação' },
    ],
  },
];

const PricingSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="planos" className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle
          align="center"
          label="Planos / Ticks"
          title="Escolha o pacote"
          highlight="ideal para sua rotina."
          subtitle="Modelo por consumo com Ticks: uso flexível, sem expiração e sem lock-in." 
        />

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`rounded-xl border p-5 ${
                plan.highlight
                  ? 'border-[var(--accent-green)] bg-[var(--accent-green-dim)]'
                  : 'border-[var(--border)] bg-[var(--bg-card)]'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-terminal text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">{plan.name}</p>
                {plan.highlight ? (
                  <span className="rounded border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-2 py-0.5 font-terminal text-[10px] uppercase tracking-widest text-[var(--signal-buy)]">
                    Mais vendido
                  </span>
                ) : null}
              </div>

              <p className="text-4xl font-bold text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
                {plan.price}
              </p>
              <p className="mt-1 font-terminal text-sm text-[var(--text-secondary)]">{plan.ticks}</p>

              <ul className="mt-5 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li
                    key={feature.text}
                    className={`flex items-center gap-2 ${feature.included ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    {feature.included ? (
                      <Check className="h-4 w-4 text-[var(--accent-green)]" />
                    ) : (
                      <X className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                    {feature.text}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {plan.name === 'Free' ? (
                  <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                    <Button
                      variant="outline"
                      className="w-full border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface)]"
                    >
                      {plan.cta}
                    </Button>
                  </SignInButton>
                ) : (
                  <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                    <Button className="w-full bg-[var(--accent-green)] font-semibold text-black hover:opacity-90">
                      {plan.cta}
                    </Button>
                  </SignInButton>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
