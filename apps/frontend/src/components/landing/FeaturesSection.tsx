import { BarChart3, Bell, Bot, BrainCircuit, Globe2, ShieldCheck } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

const features = [
  {
    icon: Bot,
    title: 'IA de Leitura Estrutural',
    description: 'Interpreta BOS/CHoCH, contexto e probabilidade do setup em segundos.',
    status: 'ready' as const,
  },
  {
    icon: Globe2,
    title: 'Multi-mercado',
    description: 'Forex, Cripto, Índices, Ações BR e Commodities na mesma rotina.',
    status: 'ready' as const,
  },
  {
    icon: ShieldCheck,
    title: 'Gestão de risco objetiva',
    description: 'Entrada, Stop e Take com lógica de estrutura e R/R mínimo validado.',
    status: 'ready' as const,
  },
  {
    icon: BarChart3,
    title: 'Painel analítico completo',
    description: 'Resumo executivo, fatores de risco, confluências e justificativa técnica.',
    status: 'ready' as const,
  },
  {
    icon: Bell,
    title: 'Alertas em tempo real',
    description: 'Notificações operacionais para setups com maior prioridade.',
    status: 'soon' as const,
  },
  {
    icon: BrainCircuit,
    title: 'Educação contínua',
    description: 'Aprendizado assistido com histórico comentado das análises.',
    status: 'soon' as const,
  },
];

const FeaturesSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="recursos" className="landing-section section-secondary reveal-on-scroll">
      <div className="container">
        <SectionTitle label="Recursos" title="Ferramentas para" highlight="traders exigentes." />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title} className="feature-card group">
                <div className="feature-icon-wrapper transition-transform duration-200 group-hover:scale-110">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">{feature.title}</h3>
                  {feature.status === 'soon' ? (
                    <span className="badge-soon px-2 py-0.5 font-terminal">
                      Em breve
                    </span>
                  ) : null}
                </div>

                <p className="text-sm leading-7 text-[var(--text-secondary)]">{feature.description}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
