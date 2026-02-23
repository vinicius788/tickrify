import { PricingCards } from '../pricing/PricingCards';

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Plano Pro Tickrify
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Análise de trading com IA de nível institucional. 
            Escolha entre cobrança mensal ou anual.
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
                Quais ciclos de cobrança estão disponíveis?
              </h3>
              <p className="text-muted-foreground">
                O plano Pro está disponível em dois ciclos: mensal (R$ 80) e anual (R$ 960).
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-2">
                Posso trocar o ciclo depois?
              </h3>
              <p className="text-muted-foreground">
                Sim. Você pode mudar entre mensal e anual no portal do cliente Stripe.
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
