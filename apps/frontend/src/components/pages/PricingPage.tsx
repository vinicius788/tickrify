import { useEffect } from 'react';
import { PricingCards } from '../pricing/PricingCards';
import { useToast } from '@/hooks/use-toast';

export default function PricingPage() {
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('canceled') === 'true') {
      toast({
        title: 'Pagamento cancelado',
        description: 'Nenhuma cobrança foi feita. Você pode assinar quando quiser.',
      });
      window.history.replaceState({}, '', '/pricing');
    }
  }, [toast]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Escolha seu plano Tickrify
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Análise de trading com IA. Cada plano inclui Ticks mensais renovados automaticamente.
          </p>
        </div>

        {/* Pricing Cards */}
        <PricingCards />

        {/* FAQ */}
        <div className="mt-24 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Perguntas Frequentes
          </h2>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">
                Posso cancelar a qualquer momento?
              </h3>
              <p className="text-muted-foreground">
                Consulte os Termos de Serviço antes da compra. As condições contratuais e
                de renovação são definidas no checkout e na política vigente da Tickrify.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">
                Como funcionam os Ticks?
              </h3>
              <p className="text-muted-foreground">
                Ticks são os créditos de análise da Tickrify. Cada plano renova automaticamente
                seus Ticks todo mês. Uma análise rápida consome 1 Tick; uma análise deep consome 3 Ticks.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">
                Posso trocar de plano depois?
              </h3>
              <p className="text-muted-foreground">
                Sim. Você pode mudar de plano a qualquer momento pelo portal do cliente Stripe,
                acessível pelo dashboard da Tickrify.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">
                Quais métodos de pagamento são aceitos?
              </h3>
              <p className="text-muted-foreground">
                Aceitamos todos os principais cartões de crédito (Visa, Mastercard, Amex)
                através do nosso processador de pagamentos seguro Stripe.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">
                Os dados do meu cartão estão seguros?
              </h3>
              <p className="text-muted-foreground">
                Sim! Utilizamos o Stripe, um dos processadores de pagamento mais seguros do mundo.
                Nós não armazenamos dados do seu cartão em nossos servidores.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">
                Há garantia de reembolso?
              </h3>
              <p className="text-muted-foreground">
                Não. Conforme os Termos de Serviço (Política Sem Reembolso), todas as compras
                são finais e não reembolsáveis.
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-24 text-center">
          <div className="bg-muted rounded-lg p-12">
            <h2 className="text-3xl font-bold mb-4">
              Ainda tem dúvidas?
            </h2>
            <p className="text-xl text-muted-foreground mb-8">
              Nossa equipe está pronta para ajudar você a escolher o melhor plano.
            </p>
            <a
              href="mailto:tickrify@gmail.com"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg hover:bg-primary/90 transition"
            >
              Falar com Suporte
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
