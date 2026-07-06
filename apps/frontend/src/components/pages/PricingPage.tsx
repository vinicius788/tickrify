import { useEffect } from 'react';
import { PricingCards } from '../pricing/PricingCards';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const PRICING_COPY = {
  en: {
    canceledTitle: 'Payment canceled',
    canceledDesc: 'No charge was made. You can subscribe whenever you want.',
    title: 'Choose your Tickrify plan',
    subtitle: 'AI trading analysis. Every plan includes monthly Ticks that renew automatically.',
    foundingTitle: 'Founding Trader offer',
    foundingDesc: 'You’re early — and that counts. The first 50 subscribers lock this price forever: it never increases while your subscription stays active. Use code',
    foundingCode: 'EARLY50',
    foundingSuffix: 'at checkout for 50% off your first month.',
    faqTitle: 'Frequently asked questions',
    faq: [
      {
        q: 'Can I cancel anytime?',
        a: 'Yes — cancel in one click from your dashboard, no emails and no questions. You keep your Ticks and full access until the end of the period you already paid for.',
      },
      {
        q: 'How do Ticks work?',
        a: 'Ticks are Tickrify’s analysis credits. Each plan renews your Ticks automatically every month. A quick analysis uses 1 Tick; a deep analysis uses 3 Ticks.',
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
        a: 'You never pay blind: 3 free analyses before any charge, and you can cancel anytime. Per the Terms of Service purchases are final — but if anything goes wrong with an analysis, reply to any email and we’ll make it right. We read every message.',
      },
    ],
  },
  pt: {
    canceledTitle: 'Pagamento cancelado',
    canceledDesc: 'Nenhuma cobrança foi feita. Você pode assinar quando quiser.',
    title: 'Escolha seu plano Tickrify',
    subtitle: 'Análise de trading com IA. Cada plano inclui Ticks mensais renovados automaticamente.',
    foundingTitle: 'Oferta Founding Trader',
    foundingDesc: 'Você chegou cedo — e isso conta. Os primeiros 50 assinantes travam este preço para sempre: ele nunca sobe enquanto a assinatura estiver ativa. Use o código',
    foundingCode: 'EARLY50',
    foundingSuffix: 'no checkout para 50% de desconto no primeiro mês.',
    faqTitle: 'Perguntas Frequentes',
    faq: [
      {
        q: 'Posso cancelar a qualquer momento?',
        a: 'Sim — cancele em um clique pelo seu dashboard, sem e-mails e sem perguntas. Você mantém seus Ticks e o acesso completo até o fim do período que já pagou.',
      },
      {
        q: 'Como funcionam os Ticks?',
        a: 'Ticks são os créditos de análise da Tickrify. Cada plano renova automaticamente seus Ticks todo mês. Uma análise rápida consome 1 Tick; uma análise deep consome 3 Ticks.',
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
        a: 'Você nunca paga no escuro: são 3 análises grátis antes de qualquer cobrança, e dá para cancelar quando quiser. Pelos Termos de Serviço as compras são finais — mas se algo der errado em uma análise, responda qualquer e-mail que a gente resolve. Lemos cada mensagem.',
      },
    ],
  },
} as const;

export default function PricingPage() {
  const { toast } = useToast();
  const { language } = useLanguage();
  const copy = language === 'pt' ? PRICING_COPY.pt : PRICING_COPY.en;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === 'true') {
      toast({
        title: copy.canceledTitle,
        description: copy.canceledDesc,
      });
      window.history.replaceState({}, '', '/pricing');
    }
  }, [toast, copy]);

  return (
    <div className="relative z-10 min-h-screen bg-[#050508]">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="tk-display text-4xl md:text-5xl mb-4">
            {copy.title}
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {copy.subtitle}
          </p>
        </div>

        {/* Founding Trader — fecha a promessa do banner do topo do site */}
        <div className="mx-auto mb-12 max-w-2xl rounded-2xl border border-[rgba(94,234,138,0.35)] bg-[rgba(94,234,138,0.06)] px-6 py-5 text-center">
          <p className="font-terminal text-xs uppercase tracking-[0.12em] text-[#5eea8a]">
            ⚡ {copy.foundingTitle}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {copy.foundingDesc}{' '}
            <strong className="rounded-md border border-[rgba(94,234,138,0.4)] px-2 py-0.5 font-terminal text-[#5eea8a]">
              {copy.foundingCode}
            </strong>{' '}
            {copy.foundingSuffix}
          </p>
        </div>

        {/* Pricing Cards */}
        <PricingCards />

        {/* FAQ */}
        <div className="mt-24 max-w-3xl mx-auto">
          <h2 className="tk-display text-3xl text-center mb-12">
            {copy.faqTitle}
          </h2>

          <div className="space-y-6">
            {copy.faq.map((item) => (
              <div key={item.q}>
                <h3 className="text-lg font-semibold mb-2">
                  {item.q}
                </h3>
                <p className="text-muted-foreground">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
