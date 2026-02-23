import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Bot, ShieldCheck, BarChart, Globe, Zap, BrainCircuit } from "lucide-react";
import { motion } from "framer-motion";

const FeaturesSection = () => {
  const features = [
    {
      icon: <Bot className="h-8 w-8 text-primary" />,
      title: "IA Avançada",
      description: "Análise técnica com confluência de 10+ indicadores.",
    },
    {
      icon: <Globe className="h-8 w-8 text-primary" />,
      title: "Multi-Mercado",
      description: "Forex, Crypto, Stocks, Commodities em uma plataforma.",
    },
    {
      icon: <ShieldCheck className="h-8 w-8 text-primary" />,
      title: "Gestão de Risco",
      description: "Stop-loss calculado, sizing adequado, R:R otimizado.",
    },
    {
      icon: <BarChart className="h-8 w-8 text-primary" />,
      title: "Análise Detalhada",
      description: "Insights profundos sobre tendências e padrões de mercado.",
    },
    {
      icon: <Zap className="h-8 w-8 text-primary" />,
      title: "Alertas em Tempo Real",
      description: "Seja notificado sobre as melhores oportunidades instantaneamente.",
    },
    {
      icon: <BrainCircuit className="h-8 w-8 text-primary" />,
      title: "Educação Contínua",
      description: "Aprenda com cada análise e melhore suas habilidades.",
    },
  ];

  return (
    <section id="features" className="py-20 md:py-28">
      <div className="container">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold md:text-4xl">
            Tudo que você precisa para operar com confiança
          </h2>
          <p className="mt-4 text-muted-foreground">
            Nossa plataforma une tecnologia de ponta e análise profissional para maximizar seus resultados.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="h-full bg-card/50 hover:border-primary/50 transition-colors">
                <CardHeader>
                  {feature.icon}
                  <CardTitle className="mt-4">{feature.title}</CardTitle>
                  <CardDescription className="mt-2">{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
