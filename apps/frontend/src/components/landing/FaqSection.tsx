import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

const faqs = [
  {
    question: 'O que é Tickrify?',
    answer:
      'Tickrify é uma plataforma de análise técnica com IA focada em leitura estrutural de gráficos, gestão de risco e suporte à decisão operacional.',
  },
  {
    question: 'A análise da IA é confiável?',
    answer:
      'A IA segue regras objetivas de mercado e validações matemáticas de risco. Ainda assim, o uso deve ser combinado com disciplina operacional e gestão de capital.',
  },
  {
    question: 'Preciso ter experiência para usar a plataforma?',
    answer:
      'Não. Iniciantes recebem direção clara de entrada/stop/take. Traders avançados têm detalhes de estrutura, confluência e invalidação do setup.',
  },
  {
    question: 'Funciona para qualquer mercado (Forex, Cripto, Ações BR)?',
    answer:
      'Sim. O fluxo foi projetado para múltiplos mercados e timeframes, desde que o gráfico enviado tenha boa qualidade e contexto visual suficiente.',
  },
  {
    question: 'Como o sistema calcula o Stop Loss e Take Profit?',
    answer:
      'Os níveis são derivados de estrutura de mercado (swing points, zonas e invalidação), com validação de risco/retorno para evitar setups estatisticamente frágeis.',
  },
  {
    question: 'Posso cancelar minha assinatura a qualquer momento?',
    answer:
      'Sim, via portal de cobrança. O cancelamento interrompe as próximas renovações, mas não gera reembolso, estorno ou crédito: todas as compras são finais e não reembolsáveis. Antes da contratação, revise os termos e políticas vigentes para entender as regras de renovação, cancelamento e Política Sem Reembolso.',
  },
];

const FaqSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const [openItem, setOpenItem] = useState<string>('item-0');

  return (
    <section ref={revealRef} id="faq" className="landing-section section-primary reveal-on-scroll">
      <div className="container max-w-4xl">
        <SectionTitle label="FAQ" title="Dúvidas de" highlight="traders profissionais." />

        <div>
          {faqs.map((faq, index) => {
            const value = `item-${index}`;
            const isOpen = openItem === value;

            return (
              <div key={value} className="faq-item-shell" data-state={isOpen ? 'open' : 'closed'}>
                <button
                  type="button"
                  className="faq-question-button"
                  onClick={() => setOpenItem(isOpen ? '' : value)}
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <span className="faq-icon-shell">
                    <Plus className="h-4 w-4" />
                  </span>
                </button>
                <div className="faq-answer-shell">
                  <p>{faq.answer}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
