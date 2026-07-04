import { Check, Zap, Star, Trophy } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { type Currency } from '@/lib/stripe';
import { warmupPaymentsApi } from '@/lib/api';

// Display prices per currency — must match the Stripe price IDs in the backend.
const PLAN_PRICES: Record<'starter' | 'pro' | 'elite', Record<Currency, string>> = {
  starter: { brl: 'R$ 57', usd: '$12', eur: '€11' },
  pro: { brl: 'R$ 147', usd: '$29', eur: '€27' },
  elite: { brl: 'R$ 297', usd: '$59', eur: '€55' },
};

const PricingSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t, language } = useLanguage();
  const pr = t.landing.pricing;

  // Site language drives the displayed currency: PT → BRL, everything else → USD.
  // Traders think in USD; keeping it fixed avoids browser-locale surprises.
  const currency: Currency = language === 'pt' ? 'brl' : 'usd';

  // Acorda a API de pagamentos (Render hiberna) já na landing, antes do clique.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

  const ticksLine = (n: number) => `${n} ${pr.ticksMo} · ${pr.upTo} ${n} ${pr.analysesQuick}`;

  const plans = [
    {
      icon: <Zap className="h-7 w-7 text-[var(--text-secondary)]" />,
      name: 'Starter',
      badge: pr.starterBadge,
      price: PLAN_PRICES.starter[currency],
      priceNote: pr.perMonth,
      ticksLine: ticksLine(45),
      features: [pr.fS1, pr.fS2, pr.fS3, pr.fS4],
      cta: pr.starterCta,
    },
    {
      icon: <Star className="h-7 w-7 text-[var(--accent-green)]" />,
      name: 'Pro',
      badge: pr.proBadge,
      price: PLAN_PRICES.pro[currency],
      priceNote: pr.perMonth,
      ticksLine: ticksLine(150),
      highlight: true,
      features: [pr.fP1, pr.fP2, pr.fP3, pr.fP4, pr.fP5],
      cta: pr.proCta,
    },
    {
      icon: <Trophy className="h-7 w-7 text-yellow-500" />,
      name: 'Elite',
      badge: pr.eliteBadge,
      price: PLAN_PRICES.elite[currency],
      priceNote: pr.perMonth,
      ticksLine: ticksLine(400),
      features: [pr.fE1, pr.fE2, pr.fE3, pr.fE4, pr.fE5],
      cta: pr.eliteCta,
    },
  ];

  return (
    <section ref={revealRef} id="planos" className="landing-section section-secondary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          align="center"
          label={pr.label}
          title={pr.title}
          highlight={pr.highlight}
          highlightClassName="pricing-heading-highlight"
          subtitle={pr.subtitle}
        />

        <div className="pricing-grid mt-10 grid gap-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`pricing-card ${plan.highlight ? 'featured' : ''}`}
            >
              {plan.highlight && <span className="badge-popular">{pr.popular}</span>}

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
                {plan.ticksLine}
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
          {pr.payPerUse}{' '}
          <Link to="/dashboard" className="text-[var(--accent-green)] underline underline-offset-2 hover:no-underline">
            {pr.buyTicks}
          </Link>
          {' '}· {pr.neverExpire}
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
