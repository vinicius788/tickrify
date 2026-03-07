import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

type RealStat = {
  value: string;
  label: string;
  sublabel: string;
};

const REAL_STATS: RealStat[] = [
  {
    value: '< 3s',
    label: 'tempo médio de análise',
    sublabel: 'do upload ao resultado',
  },
  {
    value: '6+',
    label: 'mercados suportados',
    sublabel: 'Forex, Cripto, Ações BR, Índices',
  },
  {
    value: '3',
    label: 'análises gratuitas',
    sublabel: 'sem cartão de crédito',
  },
  {
    value: '2:1',
    label: 'R/R mínimo validado',
    sublabel: 'em todo sinal gerado',
  },
];

const SocialProof = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle
          label="Indicadores da plataforma"
          title="Métricas"
          highlight="verificáveis."
          subtitle="Dados técnicos e regras operacionais utilizadas para orientar decisões."
          align="center"
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {REAL_STATS.map((stat) => (
            <article
              key={stat.label}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
            >
              <p className="font-terminal text-4xl font-semibold leading-none text-[var(--text-primary)]">{stat.value}</p>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{stat.label}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{stat.sublabel}</p>
            </article>
          ))}
        </div>

        <p className="mt-6 text-center font-terminal text-xs text-[var(--text-muted)]">
          * Métricas baseadas na arquitetura e regras do sistema. Resultados de trading dependem do operador.
        </p>
      </div>
    </section>
  );
};

export default SocialProof;
