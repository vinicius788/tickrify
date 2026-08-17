import { useEffect, useRef, useState } from 'react';
import SectionTitle from '@/components/landing/SectionTitle';
import { useReveal } from '@/hooks/useReveal';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Link } from 'react-router-dom';

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

      if (value.endsWith('%')) {
        return `${current}%`;
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
  const { t } = useLanguage();
  const s = t.landing.social;
  const REAL_STATS: Array<{ value: string; label: string; sublabel: string; href?: string }> = [
    // 104 = trades com desfecho JA MEDIDO pelo sweeper (17/08/2026). Substituiu
    // um card "16s average analysis time" que era o unico numero NAO verificavel
    // da secao — e estava sob um titulo que diz literalmente "Verifiable
    // metrics". Nao da para medir duracao pelo banco: o sweeper reescreve o
    // updatedAt horas depois. Este numero, ao contrario, vem do mesmo lugar que
    // alimenta a /accuracy e sobe sozinho conforme os trades resolvem.
    { value: '104', label: s.s1label, sublabel: s.s1sub, href: '/accuracy' },
    { value: '6+', label: s.s2label, sublabel: s.s2sub },
    { value: '3', label: s.s3label, sublabel: s.s3sub },
    // 39% = taxa de abstencao REAL em producao (155 WAIT em 395 analises,
    // medido em 17/08/2026). Comecou como 73% (o numero do backtest v2, em
    // amostras cegas) e foi corrigido em 27/07: producao roda bem abaixo
    // do backtest porque usuario sobe grafico em que ja viu algo acontecendo.
    // A pagina /accuracy publica o numero vivo — este card e so a vitrine.
    { value: '39%', label: s.s4label, sublabel: s.s4sub },
  ];

  return (
    <section ref={revealRef} className="landing-section section-secondary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          label={s.label}
          title={s.title}
          highlight={s.highlight}
          subtitle={s.subtitle}
          align="center"
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {REAL_STATS.map((stat) => {
            const body = (
              <>
                <AnimatedMetricValue value={stat.value} />
                <p className="metric-label">{stat.label}</p>
                <p className="metric-sublabel">{stat.sublabel}</p>
              </>
            );
            return stat.href ? (
              <Link
                key={stat.label}
                to={stat.href}
                className="metric-card block transition-colors hover:border-[var(--accent-green)]"
              >
                {body}
              </Link>
            ) : (
              <article key={stat.label} className="metric-card">
                {body}
              </article>
            );
          })}
        </div>

        <p className="mt-6 text-center font-terminal text-xs text-[var(--text-muted)]">
          {s.footnote}
        </p>
      </div>
    </section>
  );
};

export default SocialProof;
