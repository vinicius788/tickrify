import { useMemo } from 'react';
import SiteLayout from '@/components/layout/SiteLayout';
import { PricingCards } from '@/components/pricing/PricingCards';
import TestimonialsSection from '@/components/landing/TestimonialsSection';
import { seoFor, useJsonLd, useSeo } from '@/hooks/useSeo';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useFoundingOffer, useLocalPrices } from '@/hooks/useFoundingOffer';
import { interpolate } from '@/lib/i18n';



export default function PricingPage() {
  const { t, language } = useLanguage();
  const copy = t.pricingPage;
  const local = useLocalPrices(language);
  const foundingOffer = useFoundingOffer();

  // Intenção transacional pura, e até 10/08/2026 esta página servia o title e
  // a description do home, então não podia rankear para "pricing" nem para o
  // preço. Conferido ao vivo antes da correção.
  useSeo(seoFor('/pricing'));

  // Schema montado a partir do MESMO objeto que a tela renderiza. Se a copy
  // mudar, o markup muda junto, nunca diverge do que o visitante lê (regra
  // da auditoria de 27/07: nada afirmado que não seja verificável na página).
  //
  // O bloco FAQPage NÃO produz mais rich result: o Google desativou FAQ
  // rich results em 07/05/2026. Ele fica porque ainda é assim que buscador de
  // IA e agregador leem a página, não porque vai virar sanfona na SERP.
  //
  // Sem aggregateRating de propósito: não há avaliação real para declarar, e
  // inventar uma seria exatamente o tipo de claim que a Fase 1 removeu.
  const jsonLd = useMemo<Record<string, unknown>>(
    () => ({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: 'Tickrify',
          applicationCategory: 'FinanceApplication',
          operatingSystem: 'Web',
          url: 'https://tickrify.com',
          description:
            'AI chart analysis for traders: upload a chart screenshot and get entry, stop, targets and risk, or a WAIT, as a second opinion before you enter.',
          offers: {
            '@type': 'Offer',
            price: '29',
            priceCurrency: 'USD',
            url: 'https://tickrify.com/pricing',
            availability: 'https://schema.org/InStock',
          },
        },
        {
          '@type': 'FAQPage',
          mainEntity: copy.faq.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a },
          })),
        },
      ],
    }),
    [copy],
  );

  useJsonLd('pricing', jsonLd);

  return (
    <SiteLayout active="pricing">
      <section className="site-dark site-phead">
        <div className="site-wrap">
          <span className="site-eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
      </section>

      {/* Fecha a promessa do banner do topo do site. Âmbar porque é status,
          não decoração: é a mesma cor que o produto usa para AGUARDA.
          Some junto com o cupom: sem EARLY35 ativo na Stripe, não há oferta. */}
      {foundingOffer && (
        <section className="site-dark site-body-tight">
          <div className="site-wrap">
            <div className="site-founding">
              <span className="site-eyebrow">{copy.foundingTitle}</span>
              <p>
                {copy.foundingDesc} <b>{copy.foundingCode}</b> {interpolate(copy.foundingSuffix, local.params)}
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="site-light">
        <div className="site-wrap">
          <PricingCards />
          <div className="site-trust">
            {copy.trust.map((item) => (
              <span key={item}>
                <i />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <TestimonialsSection />

      <section className="site-dark">
        <div className="site-wrap site-faq">
          <div className="site-sblk">
            <span className="site-eyebrow">{copy.faqEyebrow}</span>
            <h2>{copy.faqTitle}</h2>
          </div>

          {copy.faq.map((item, index) => (
            <details key={item.q} open={index === 0}>
              <summary>
                {item.q}
                <i aria-hidden="true" />
              </summary>
              <p className="site-answer">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}
