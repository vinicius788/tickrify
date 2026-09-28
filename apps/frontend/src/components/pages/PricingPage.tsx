import { useEffect, useMemo } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { getCheckoutStatus } from '@/lib/stripe';
import SiteLayout from '@/components/layout/SiteLayout';
import { PricingCards } from '@/components/pricing/PricingCards';
import { useToast } from '@/hooks/use-toast';
import { seoFor, useJsonLd, useSeo } from '@/hooks/useSeo';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';

const PRICING_COPY = {
  en: {
    canceledTitle: 'Payment canceled',
    canceledDesc: 'No charge was made. You can subscribe whenever you want.',
    eyebrow: 'Pricing',
    title: 'One plan. 200 analyses a month.',
    subtitle:
      'No tiers to compare and nothing held back for a higher price. Every subscriber runs the same engine, on the same queue, with the same models.',
    foundingTitle: 'Founding Trader offer',
    foundingDesc:
      'You are early, and that counts. While this offer lasts, early subscribers lock the $29/month price for as long as the subscription stays active. Your',
    foundingCode: 'EARLY35',
    foundingSuffix: 'discount is applied automatically at checkout: 35% off your first month, then $29/month.',
    trust: ['Payments secured by Stripe', 'Cancel in one click', 'No broker connection required'],
    faqTitle: 'Before you pay',
    faqEyebrow: 'Questions',
    faq: [
      {
        q: 'Can I cancel anytime?',
        a: 'Yes, cancel in one click from your dashboard, no emails and no questions. You keep your Ticks and full access until the end of the period you already paid for.',
      },
      {
        q: 'How do Ticks work?',
        a: 'Ticks are Tickrify’s analysis credits. The monthly plan resets your balance to 200 Ticks every billing month, and the weekly plan ($7.99) resets it to 25 Ticks every week. A quick analysis uses 1 Tick; a deep analysis uses 3 Ticks.',
      },
      {
        q: 'Can I switch plans later?',
        a: 'Yes. You can change plans anytime through the Stripe customer portal, accessible from your Tickrify dashboard.',
      },
      {
        q: 'Which payment methods are accepted?',
        a: 'We accept all major credit cards (Visa, Mastercard, Amex) through our secure payment processor, Stripe.',
      },
      {
        q: 'Is my card data safe?',
        a: 'Yes. We use Stripe, one of the most secure payment processors in the world. We never store your card data on our servers.',
      },
      {
        q: 'Is there a refund guarantee?',
        a: 'You never pay blind: 3 free analyses before any charge, and you can cancel anytime. Per the Terms of Service purchases are final, but if anything goes wrong with an analysis, reply to any email and we’ll make it right. We read every message.',
      },
    ],
  },
  pt: {
    canceledTitle: 'Pagamento cancelado',
    canceledDesc: 'Nenhuma cobrança foi feita. Você pode assinar quando quiser.',
    eyebrow: 'Preço',
    title: 'Um plano só. 200 análises por mês.',
    subtitle:
      'Sem tiers para comparar e sem recurso escondido atrás de um preço maior. Todo assinante roda o mesmo motor, na mesma fila, com os mesmos modelos.',
    foundingTitle: 'Oferta Founding Trader',
    foundingDesc:
      'Você chegou cedo, e isso conta. Enquanto a oferta durar, os primeiros assinantes travam o preço de US$ 29/mês enquanto a assinatura estiver ativa. O desconto',
    foundingCode: 'EARLY35',
    foundingSuffix: 'é aplicado automaticamente no checkout: 35% no primeiro mês, depois US$ 29/mês.',
    trust: ['Pagamento protegido pela Stripe', 'Cancela em um clique', 'Não precisa conectar corretora'],
    faqTitle: 'Antes de pagar',
    faqEyebrow: 'Dúvidas',
    faq: [
      {
        q: 'Posso cancelar a qualquer momento?',
        a: 'Sim, cancele em um clique pelo seu dashboard, sem e-mails e sem perguntas. Você mantém seus Ticks e o acesso completo até o fim do período que já pagou.',
      },
      {
        q: 'Como funcionam os Ticks?',
        a: 'Ticks são os créditos de análise da Tickrify. O plano mensal volta seu saldo para 200 Ticks a cada mês de cobrança, e o plano semanal (US$ 7,99) volta para 25 Ticks toda semana. Uma análise rápida consome 1 Tick; uma análise deep consome 3 Ticks.',
      },
      {
        q: 'Posso trocar de plano depois?',
        a: 'Sim. Você pode mudar de plano a qualquer momento pelo portal do cliente Stripe, acessível pelo dashboard da Tickrify.',
      },
      {
        q: 'Quais métodos de pagamento são aceitos?',
        a: 'Aceitamos todos os principais cartões de crédito (Visa, Mastercard, Amex) através do nosso processador de pagamentos seguro Stripe.',
      },
      {
        q: 'Os dados do meu cartão estão seguros?',
        a: 'Sim! Utilizamos o Stripe, um dos processadores de pagamento mais seguros do mundo. Não armazenamos dados do seu cartão em nossos servidores.',
      },
      {
        q: 'Há garantia de reembolso?',
        a: 'Você nunca paga no escuro: são 3 análises grátis antes de qualquer cobrança, e dá para cancelar quando quiser. Pelos Termos de Serviço as compras são finais, mas se algo der errado em uma análise, responda qualquer e-mail que a gente resolve. Lemos cada mensagem.',
      },
    ],
  },
} as const;

export default function PricingPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const { language } = useLanguage();
  const copy = language === 'pt' ? PRICING_COPY.pt : PRICING_COPY.en;
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
            'AI chart analysis for traders: upload a chart screenshot and get entry, stop, targets, risk and confidence, a second opinion before you enter.',
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === 'true') {
      // A pessoa chegou na pagina da Stripe e voltou sem pagar. Sem este
      // evento o funil nao separava "abandonou no checkout" de "nunca chegou".
      track('checkout_canceled', { source: 'stripe_cancel_url' });
      // Registro no servidor (log [funnel] + historico do usuario): sem isto,
      // "voltou da Stripe sem pagar" so existia para quem aceitou cookies.
      void getToken().then((token) => (token ? getCheckoutStatus(token, { outcome: 'canceled' }) : null));
      toast({
        title: copy.canceledTitle,
        description: copy.canceledDesc,
      });
      window.history.replaceState({}, '', '/pricing');
    }
  }, [toast, copy, getToken]);

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
                {copy.foundingDesc} <b>{copy.foundingCode}</b> {copy.foundingSuffix}
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
