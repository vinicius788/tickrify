import { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
      'Sim, via portal de cobrança. Antes da contratação, revise os termos e políticas vigentes para entender regras de renovação e cancelamento.',
  },
];

const FaqSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const [openItem, setOpenItem] = useState<string>('item-0');

  return (
    <section ref={revealRef} id="faq" className="reveal-on-scroll py-28">
      <div className="container max-w-4xl">
        <SectionTitle label="FAQ" title="Dúvidas de" highlight="traders profissionais." />

        <Accordion type="single" collapsible value={openItem} onValueChange={(value) => setOpenItem(value || '')}>
          {faqs.map((faq, index) => {
            const value = `item-${index}`;
            const isOpen = openItem === value;

            return (
              <AccordionItem
                key={value}
                value={value}
                className={`border-[var(--border-subtle)] px-4 transition-colors ${
                  isOpen
                    ? 'border-l-2 border-l-[var(--signal-buy)] bg-[var(--signal-buy-bg)]'
                    : 'bg-[var(--bg-elevated)]'
                }`}
              >
                <AccordionTrigger className="text-base font-semibold text-[var(--text-primary)] hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </section>
  );
};

export default FaqSection;
