import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { motion } from "framer-motion";

const FaqSection = () => {
  const faqs = [
    {
      question: "O que é Tickrify?",
      answer: "Tickrify é uma plataforma de análise de trading que utiliza Inteligência Artificial para fornecer sinais e setups de alta probabilidade para diversos mercados, como Forex, Criptomoedas, Ações e Commodities.",
    },
    {
      question: "A análise da IA é confiável?",
      answer: "Nossa IA é treinada com milhões de pontos de dados históricos e combina mais de 10 indicadores técnicos para encontrar confluências. Embora nenhum sistema seja 100% infalível, nossa precisão histórica é de 89% em sinais validados.",
    },
    {
      question: "Preciso ter experiência para usar a plataforma?",
      answer: "Não! Tickrify foi projetado para traders de todos os níveis. Para iniciantes, oferecemos explicações didáticas e setups claros. Para avançados, fornecemos dados profundos, backtesting e acesso via API.",
    },
    {
      question: "Posso cancelar minha assinatura a qualquer momento?",
      answer: "As compras digitais da Tickrify seguem a política sem reembolso descrita nos Termos de Serviço. Antes de contratar, leia os termos completos para entender as condições aplicáveis.",
    },
    {
      question: "O que preciso saber antes de usar a Tickrify?",
      answer: "Gráfico: Captura com aproximadamente 300 velas japonesas em boa qualidade. Se o gráfico for muito pequeno, a IA não conseguirá analisar. Uso responsável: A plataforma indica stop loss e alvos, mas siga sempre sua meta diária estabelecida.",
    },
  ];

  return (
    <section id="faq" className="py-20 md:py-28 bg-muted/20">
      <div className="container max-w-4xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold md:text-4xl">Perguntas Frequentes</h2>
          <p className="mt-4 text-muted-foreground">
            Tudo o que você precisa saber sobre a Tickrify.
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mt-12"
        >
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
};

export default FaqSection;
