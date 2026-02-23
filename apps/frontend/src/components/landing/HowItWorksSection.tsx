import { Upload, Cpu, BarChart, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";

const HowItWorksSection = () => {
  const steps = [
    {
      icon: <Upload className="h-10 w-10 text-primary" />,
      title: "1. Conecte seu Gráfico",
      description: "Faça upload de uma imagem ou conecte sua conta da corretora.",
    },
    {
      icon: <Cpu className="h-10 w-10 text-primary" />,
      title: "2. Análise da IA",
      description: "Nossa IA processa milhares de pontos de dados em segundos.",
    },
    {
      icon: <BarChart className="h-10 w-10 text-primary" />,
      title: "3. Receba o Sinal",
      description: "Obtenha um sinal claro com bias obrigatório: BUY, SELL ou WAIT.",
    },
    {
      icon: <CheckCircle className="h-10 w-10 text-primary" />,
      title: "4. Execute com Confiança",
      description: "Use nosso setup detalhado para tomar a melhor decisão.",
    },
  ];

  return (
    <section id="how-it-works" className="py-20 md:py-28 bg-muted/20">
      <div className="container">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold md:text-4xl">Como Funciona</h2>
          <p className="mt-4 text-muted-foreground">
            Em quatro passos simples, transforme complexidade em oportunidade.
          </p>
        </div>
        <div className="relative mt-12">
          <div className="absolute left-1/2 top-10 hidden h-full w-px -translate-x-1/2 bg-border md:block"></div>
          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                className="flex flex-col items-center text-center"
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-card border">
                  {step.icon}
                </div>
                <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-muted-foreground">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
