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
    <section ref={revealRef} id="planos" className="landing-section section-secondary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          align="center"
          label="Planos / Ticks"
          title="Escolha o pacote"
          highlight="ideal para sua rotina."
          highlightClassName="pricing-heading-highlight"
          subtitle="Modelo por consumo com Ticks: uso flexível, sem expiração e sem lock-in." 
        />

        <div className="pricing-grid mt-10 grid gap-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`pricing-card ${plan.highlight ? 'featured' : ''}`}
            >
              {plan.highlight ? <span className="badge-popular">Mais vendido</span> : null}

              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-terminal text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">{plan.name}</p>
              </div>

              <p className="pricing-price">
                {plan.price}
              </p>
              <p className="mt-1 font-terminal text-sm text-[var(--text-secondary)]">{plan.ticks}</p>

              <ul className="mt-5 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li
                    key={feature.text}
                    className={`pricing-feature ${feature.included ? 'included' : 'excluded'}`}
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
                    <Button variant="outline" className="btn-pricing-secondary">
                      {plan.cta}
                    </Button>
                  </SignInButton>
                ) : (
                  <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                    <Button className="btn-pricing-primary">
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
