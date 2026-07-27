import { Check, Star } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { type Currency } from '@/lib/stripe';
import { warmupPaymentsApi } from '@/lib/api';

// PLANO ÚNICO (decisão 27/07/2026, Fase 2 da auditoria).
//
// Antes eram 3 tiers (Starter $12 / Pro $29 / Elite $59) que diferiam APENAS
// em volume de ticks — mesma fila, mesmo modelo, mesmo suporte. Pior: o
// Starter a $0,267/análise era mais caro que o pacote avulso ($0,20), então
// assinar era o pior negócio da própria loja.
//
// Agora: um plano só a $29/mês com 200 ticks = $0,145 por análise rápida,
// ainda abaixo do pacote avulso mais barato ($0,173). A assinatura continua
// sendo o melhor negócio da loja, e a página de preço vira uma decisão
// binária (converte melhor com tráfego baixo).
//
// Por que $29 e não $19 (decisão de 27/07/2026): margem bruta é ~88% nos dois
// casos, então preço aqui NÃO é decisão de custo — é de sinalização. Num nicho
// onde ceticismo sobre golpe é a objeção nº 1, o produto mais barato da
// prateleira lê como amador. E a assimetria decide: descer de $29 é fácil
// (o cupom EARLY35 já existe), subir de $19 é constrangedor. Com 0 clientes,
// escolher o preço alto custa zero.
//
// O preço no Stripe continua sendo o objeto `Starter-usd`
// (price_1TRvEJB1hl0IoocUvbCyxkt5), editado $12 → $19 → $29 — o ID nunca
// mudou, então o backend não precisa de novo price ID.
const PLAN_PRICE: Record<Currency, string> = { brl: '$29', usd: '$29', eur: '$29' };
const PLAN_TICKS = 200;

const PricingSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const pr = t.landing.pricing;

  // Global product: prices always in USD, regardless of site language.
  // Traders think in USD; keeping it fixed avoids browser-locale surprises.
  const currency: Currency = 'usd';

  // Acorda a API de pagamentos (Render hiberna) já na landing, antes do clique.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

  const plan = {
    icon: <Star className="h-7 w-7 text-[var(--accent-green)]" />,
    name: 'Tickrify',
    badge: pr.starterBadge,
    price: PLAN_PRICE[currency],
    priceNote: pr.perMonth,
    ticksLine: `${PLAN_TICKS} ${pr.ticksMo} · ${pr.upTo} ${PLAN_TICKS} ${pr.analysesQuick}`,
    features: [pr.fS1, pr.fS2, pr.fS3, pr.fS4],
    cta: pr.starterCta,
  };

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

        <div className="mx-auto mt-10 grid max-w-md gap-4">
          <article className="pricing-card featured">
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
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-green)]" />
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-6">
              <Link to="/pricing">
                <Button className="btn-pricing-primary w-full">{plan.cta}</Button>
              </Link>
            </div>
          </article>
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
