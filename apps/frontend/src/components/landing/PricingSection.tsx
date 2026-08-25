import { useEffect } from 'react';
import { Link } from 'react-router-dom';
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

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 7.4 5.6 10.5 11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PricingSection = () => {
  const { t } = useLanguage();
  const pr = t.landing.pricing;

  // Produto global: preço sempre em USD, independente do idioma do site.
  // Trader pensa em dólar, e fixar evita surpresa com o locale do navegador.
  const currency: Currency = 'usd';

  // Acorda a API de pagamentos (o Render hiberna) já na landing, antes do clique.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

  const features = [pr.fS1, pr.fS2, pr.fS3, pr.fS4];

  return (
    <section id="pricing" className="site-light">
      <div className="site-wrap">
        <div className="site-sblk site-sblk-center">
          <span className="site-eyebrow">{pr.label}</span>
          <h2>{pr.title} {pr.highlight}</h2>
        </div>

        <div className="site-price">
          <span className="site-eyebrow">{pr.starterBadge}</span>
          <div className="site-price-amt">
            <b>{PLAN_PRICE[currency]}</b>
            <span>{pr.perMonth}</span>
          </div>
          <p className="text-sm">
            {PLAN_TICKS} {pr.ticksMo} · {pr.upTo} {PLAN_TICKS} {pr.analysesQuick}
          </p>

          <ul>
            {features.map((feature) => (
              <li key={feature}><Check />{feature}</li>
            ))}
          </ul>

          <Link to="/pricing" className="site-btn site-btn-primary site-btn-block">
            {pr.starterCta}
          </Link>

          <p className="site-price-fine">
            {pr.payPerUse}{' '}
            <Link to="/dashboard" className="underline underline-offset-2">{pr.buyTicks}</Link>
            {' '}· {pr.neverExpire}
          </p>
        </div>

        <div className="site-trust">
          <span><i />Payments secured by Stripe</span>
          <span><i />Cancel in one click</span>
          <span><i />No broker connection required</span>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
