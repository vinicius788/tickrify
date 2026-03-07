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
    <section ref={revealRef} id="recursos" className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle label="Recursos" title="Ferramentas para" highlight="traders exigentes." />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 transition-all duration-200 hover:border-[var(--signal-buy-border)] hover:bg-[var(--bg-overlay)]"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--signal-buy-bg)] text-[var(--signal-buy)] transition-transform duration-200 group-hover:scale-110">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">{feature.title}</h3>
                  {feature.status === 'soon' ? (
                    <span className="rounded-full border border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)] px-2 py-0.5 font-terminal text-[10px] uppercase tracking-widest text-[var(--signal-hold)]">
                      Em breve
                    </span>
                  ) : null}
                </div>

                <p className="text-sm text-[var(--text-secondary)]">{feature.description}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
