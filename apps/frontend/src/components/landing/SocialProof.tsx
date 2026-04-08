import { useEffect, useRef, useState } from 'react';
import SectionTitle from '@/components/landing/SectionTitle';
import { useReveal } from '@/hooks/useReveal';

type RealStat = {
  value: string;
  label: string;
  sublabel: string;
};

const REAL_STATS: RealStat[] = [
  {
    value: '16s',
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

const AnimatedMetricValue = ({ value }: { value: string }) => {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const numeric = Number(value.match(/\d+/)?.[0] || 0);
    if (Number.isNaN(numeric) || numeric <= 0) {
      setDisplayValue(value);
      return;
    }

    let animationFrame = 0;
    let hasAnimated = false;

    const formatValue = (current: number) => {
      if (value.startsWith('<')) {
        return `< ${current}s`;
      }

      if (value.endsWith('s')) {
        return `${current}s`;
      }

      if (value.endsWith('+')) {
        return `${current}+`;
      }

      if (value.includes(':1')) {
        return `${current}:1`;
      }

      return String(current);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || hasAnimated) {
          return;
        }

        hasAnimated = true;
        const duration = 1200;
        const start = performance.now();

        const tick = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - (1 - progress) * (1 - progress);
          const nextValue = Math.max(1, Math.round(numeric * eased));

          setDisplayValue(formatValue(nextValue));

          if (progress < 1) {
            animationFrame = window.requestAnimationFrame(tick);
          }
        };

        animationFrame = window.requestAnimationFrame(tick);
        observer.disconnect();
      },
      { threshold: 0.45 },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [value]);

  return (
    <p ref={ref} className="metric-number">
      {displayValue}
    </p>
  );
};

const SocialProof = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} className="landing-section section-secondary reveal-on-scroll">
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
            <article key={stat.label} className="metric-card">
              <AnimatedMetricValue value={stat.value} />
              <p className="metric-label">{stat.label}</p>
              <p className="metric-sublabel">{stat.sublabel}</p>
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
