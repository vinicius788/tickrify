import { useMemo } from 'react';
import SiteLayout from '@/components/layout/SiteLayout';
import { PricingCards } from '@/components/pricing/PricingCards';
import TestimonialsSection from '@/components/landing/TestimonialsSection';
import { seoFor, useJsonLd, useSeo } from '@/hooks/useSeo';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';

const PRICING_COPY = {
  en: {
    eyebrow: 'Pricing',
    title: 'One plan. Choose your billing cycle.',
    subtitle:
      'No tiers to compare and nothing held back for a higher price. Every subscriber runs the same engine, on the same queue, with the same models.',
    foundingTitle: 'Founding Trader offer',
    foundingDesc:
      'You are early, and that counts. While this offer lasts, the',
    foundingCode: 'EARLY35',
    foundingSuffix: 'discount is applied automatically at checkout on the monthly plan: 35% off your first month, then $29/month.',
    trust: ['Payments secured by Stripe', 'Cancel anytime in Settings', 'No broker connection required'],
    faqTitle: 'Before you pay',
    faqEyebrow: 'Questions',
    faq: [
      {
        q: 'How do I cancel?',
        a: 'Anytime, from Settings in your dashboard: Settings, then Manage subscription, then Cancel subscription. No email needed. Canceling stops future charges, and you keep your Ticks and full access until the end of the period you already paid for. After that your account stays open in read mode with your history, and you can reactivate before that date in the same place. Questions: support@tickrify.com.',
      },
      {
        q: 'How do Ticks work?',
        a: 'Ticks are Tickrify’s analysis credits. The monthly plan resets your balance to 200 Ticks every billing month, and the weekly plan ($7.99) resets it to 25 Ticks every week. The yearly plan costs $290 upfront and renews annually, with a balance reset to 200 Ticks each month. Unused Ticks do not carry over. A quick analysis uses 1 Tick; a deep analysis uses 3 Ticks.',
      },
      {
        q: 'Can I switch plans later?',
        a: 'Yes. Write to support@tickrify.com and we switch you between the weekly, monthly and yearly plans, starting on your next billing date. You can also cancel in Settings and pick the new plan when your current period ends.',
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
        a: 'You can try one anonymous demo per device. Eligible accounts receive up to 7 analyses across 3 usage days (3/2/2), within 7 days, with no card or automatic charge. Existing accounts keep their applicable free allowance. Subscriptions renew until canceled. Per the Terms of Service purchases are final, but if anything goes wrong with an analysis, reply to any email and we’ll make it right. We read every message.',
      },
    ],
  },
  pt: {
    eyebrow: 'Preço',
    title: 'Um plano só. Escolha seu ciclo de cobrança.',
    subtitle:
      'Sem tiers para comparar e sem recurso escondido atrás de um preço maior. Todo assinante roda o mesmo motor, na mesma fila, com os mesmos modelos.',
    foundingTitle: 'Oferta Founding Trader',
    foundingDesc:
      'Você chegou cedo, e isso conta. Enquanto a oferta durar, o desconto',
    foundingCode: 'EARLY35',
    foundingSuffix: 'é aplicado automaticamente no checkout do plano mensal: 35% no primeiro mês, depois US$ 29/mês.',
    trust: ['Pagamento protegido pela Stripe', 'Cancele quando quiser em Configurações', 'Não precisa conectar corretora'],
    faqTitle: 'Antes de pagar',
    faqEyebrow: 'Dúvidas',
    faq: [
      {
        q: 'Como eu cancelo?',
        a: 'Quando quiser, em Configurações no seu painel: Configurações, depois Gerenciar assinatura, depois Cancelar assinatura. Não precisa mandar e-mail. Cancelar interrompe as próximas cobranças, e você mantém seus Ticks e o acesso completo até o fim do período que já pagou. Depois disso a conta continua aberta em modo leitura com o seu histórico, e dá para reativar antes dessa data no mesmo lugar. Dúvidas: support@tickrify.com.',
      },
      {
        q: 'Como funcionam os Ticks?',
        a: 'Ticks são os créditos de análise da Tickrify. O plano mensal volta seu saldo para 200 Ticks a cada mês de cobrança, e o plano semanal (US$ 7,99) volta para 25 Ticks toda semana. O anual custa US$ 290 antecipados e renova anualmente, com saldo renovado para 200 Ticks por mês. Ticks não utilizados não acumulam. Uma análise rápida consome 1 Tick; uma análise deep consome 3 Ticks.',
      },
      {
        q: 'Posso trocar de plano depois?',
        a: 'Sim. Escreva para support@tickrify.com e trocamos você entre os planos semanal, mensal e anual a partir da próxima cobrança. Você também pode cancelar em Configurações e escolher o novo plano quando o período atual terminar.',
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
        a: 'Você pode testar uma demo anônima por dispositivo. Contas elegíveis recebem até 7 análises em 3 dias de uso (3/2/2), dentro de 7 dias, sem cartão nem cobrança automática. Contas existentes mantêm sua cota gratuita aplicável. Assinaturas renovam até cancelar. Pelos Termos de Serviço as compras são finais, mas se algo der errado em uma análise, responda qualquer e-mail que a gente resolve. Lemos cada mensagem.',
      },
    ],
  },
} as const;

export default function PricingPage() {
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
