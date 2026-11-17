import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { warmupPaymentsApi } from '@/lib/api';
import { track } from '@/lib/analytics';
import { interpolate } from '@/lib/i18n';
import { firstMonthPrice, useFoundingOffer, useLocalPrices } from '@/hooks/useFoundingOffer';

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
const PLAN_TICKS = 200;

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 7.4 5.6 10.5 11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PricingSection = () => {
  const { t, language } = useLanguage();
  const pr = t.landing.pricing;
  // Mesmo estado do checkout: com o EARLY35 ativo na Stripe o mensal mostra o
  // preco do 1o mes; sem resposta da API, $29 como sempre.
  // Preco na moeda da pessoa (13/11/2026); sem resposta da API, USD.
  const local = useLocalPrices(language);
  const offerPrice = firstMonthPrice(useFoundingOffer(), language, local);
  const monthlyPrice = local.price('monthly');

  // Acorda a API de pagamentos (o Render hiberna) já na landing, antes do clique.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

  // `pricing_viewed` só disparava na rota /pricing. Desde que o preço passou a
  // viver dentro da landing, quem vê o preço na home não contava no funil.
  // Dispara uma vez por carga, quando a seção entra de fato na tela.
  const sectionRef = useRef<HTMLElement | null>(null);
  const seenRef = useRef(false);
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (seenRef.current || !entries.some((entry) => entry.isIntersecting)) return;
        seenRef.current = true;
        track('pricing_section_viewed', { source: 'landing_section' });
        observer.disconnect();
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const features = [pr.fS1, pr.fS2, pr.fS3, pr.fS4].map((feature) => interpolate(feature, local.params));

  return (
    <section id="pricing" ref={sectionRef} className="site-light">
      <div className="site-wrap">
        <div className="site-sblk site-sblk-center">
          <span className="site-eyebrow">{pr.label}</span>
          <h2>{pr.title} {pr.highlight}</h2>
        </div>

        <div className="site-price">
          <span className="site-eyebrow">{pr.starterBadge}</span>
          {offerPrice ? (
            <>
              <div className="site-price-amt">
                <s>
                  <span className="sr-only">{t.commercial.offerRegular} </span>
                  {monthlyPrice}
                </s>
                <b>{offerPrice}</b>
                <span>{t.commercial.offerFirstMonth}</span>
              </div>
              <p className="site-price-then">{interpolate(t.commercial.offerThen, local.params)}</p>
            </>
          ) : (
            <div className="site-price-amt">
              <b>{monthlyPrice}</b>
              <span>{pr.perMonth}</span>
            </div>
          )}
          <p className="text-sm">
            {PLAN_TICKS} {pr.ticksMo} · {pr.upTo} {PLAN_TICKS} {pr.analysesQuick}
          </p>

          <ul>
            {features.map((feature) => (
              <li key={feature}><Check />{feature}</li>
            ))}
          </ul>

          <Link to="/pricing" className="site-btn site-btn-primary site-btn-block">
            {offerPrice ? interpolate(t.commercial.offerCta, { price: offerPrice }) : pr.starterCta}
          </Link>

          {/* Semanal na vitrine (30/09/2026). Ele existe porque US$ 29 de uma vez
              nao fecha para boa parte do publico (11 de 12 checkouts sem cartao
              ate 29/09), e a home so mostrava o mensal. */}
          <p className="site-price-fine">
            <Link to="/pricing?cycle=weekly">{interpolate(pr.weeklyLine, local.params)}</Link>
          </p>

          {/* Era "compre Ticks avulsos no painel · Ticks nunca expiram": o painel
              nao vende avulso e, desde 21/09/2026, o saldo do assinante volta
              para 200 a cada mes (nao acumula). As duas partes eram falsas. */}
          <p className="site-price-fine">{t.commercial.tickCosts}</p>
          {offerPrice ? null : <p className="site-price-fine">{interpolate(t.commercial.monthlyRenewal, local.params)}</p>}
          <p className="site-price-fine">{pr.monthlyReset}</p>
        </div>

        <div className="site-trust">
          <span><i /><span>{t.pricingPage.trust[0]}</span></span>
          <span><i /><span>{t.pricingPage.trust[1]}</span></span>
          <span><i /><span>{t.pricingPage.trust[2]}</span></span>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
