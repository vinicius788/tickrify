import { Check, Zap, Star, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

type Plan = {
  icon: React.ReactNode;
  name: string;
  badge: string;
  price: string;
  priceNote: string;
  ticks: string;
  analyses: string;
  highlight?: boolean;
  features: string[];
  cta: string;
};

const plans: Plan[] = [
  {
    icon: <Zap className="h-7 w-7 text-[var(--text-secondary)]" />,
    name: 'Starter',
    badge: 'Entrada',
    price: 'R$ 57',
    priceNote: '/mês',
    ticks: '45 ticks/mês',
    analyses: 'até 45 análises rápidas',
    features: [
      '45 Ticks mensais',
      'Análise rápida (1 Tick)',
      'Análise deep (3 Ticks)',
      'Histórico completo',
    ],
    cta: 'Assinar Starter',
  },
  {
    icon: <Star className="h-7 w-7 text-[var(--accent-green)]" />,
    name: 'Pro',
    badge: 'Mais escolhido',
    price: 'R$ 147',
    priceNote: '/mês',
    ticks: '150 ticks/mês',
    analyses: 'até 150 análises rápidas',
    highlight: true,
    features: [
      '150 Ticks mensais',
      'Análise rápida + deep completa',
      'Melhor custo por análise',
      'Histórico completo',
      'Prioridade nas respostas',
    ],
    cta: 'Assinar Pro',
  },
  {
    icon: <Trophy className="h-7 w-7 text-yellow-500" />,
    name: 'Elite',
    badge: 'Institucional',
    price: 'R$ 297',
    priceNote: '/mês',
    ticks: '400 ticks/mês',
    analyses: 'até 400 análises rápidas',
    features: [
      '400 Ticks mensais',
      'IA nível institucional',
      'Execução prioritária',
      'Histórico completo',
      'Suporte prioritário',
    ],
    cta: 'Assinar Elite',
  },
];

const PricingSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="planos" className="landing-section section-secondary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          align="center"
          label="Planos"
          title="Escolha seu plano"
          highlight="Tickrify"
          highlightClassName="pricing-heading-highlight"
          subtitle="Análise de trading com IA. Cada plano inclui Ticks mensais renovados automaticamente."
        />

        <div className="pricing-grid mt-10 grid gap-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`pricing-card ${plan.highlight ? 'featured' : ''}`}
            >
              {plan.highlight && <span className="badge-popular">Mais escolhido</span>}

              <div className="mb-3 flex items-center gap-3">
                {plan.icon}
                <div>
                  <p className="font-terminal text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    {plan.badge}
                  </p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{plan.name}</p>
                </div>
              </div>

              <p className="pricing-price">
                {plan.price}
                <span className="text-base font-normal text-[var(--text-secondary)]">{plan.priceNote}</span>
              </p>
              <p className="mt-1 font-terminal text-sm text-[var(--text-secondary)]">
                {plan.ticks} · {plan.analyses}
              </p>

              <ul className="mt-5 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="pricing-feature included flex items-start gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[var(--accent-green)] mt-0.5" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                <Link to="/pricing">
                  <Button
                    className={plan.highlight ? 'btn-pricing-primary w-full' : 'btn-pricing-secondary w-full'}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">
          Prefere pagar por uso?{' '}
          <Link to="/dashboard" className="text-[var(--accent-green)] underline underline-offset-2 hover:no-underline">
            Compre Ticks avulsos no dashboard
          </Link>
          {' '}· Ticks nunca expiram
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
