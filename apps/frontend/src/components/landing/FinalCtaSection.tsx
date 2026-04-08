import { useReveal } from '@/hooks/useReveal';

const FinalCtaSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} className="landing-section section-primary cta-section reveal-on-scroll px-6">
      <div className="cta-card mx-auto max-w-5xl">
        <div className="landing-badge mb-6">
          <span>Beta aberto agora</span>
        </div>

        <h2
          className="mb-4 text-[clamp(2rem,4vw,3.4rem)] font-bold leading-[1.02] tracking-[-0.03em] text-[var(--text-primary)]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Pronto para operar com <span className="hero-highlight">precisão?</span>
        </h2>

        <p className="mx-auto mb-8 max-w-md text-sm leading-7 text-[var(--text-secondary)]">
          Comece com 3 análises gratuitas e valide o fluxo em segundos.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="/sign-in"
            className="landing-primary-button rounded-xl px-8 py-3 font-semibold"
          >
            COMEÇAR GRÁTIS →
          </a>
          <a
            href="#preview-dashboard"
            className="btn-secondary landing-secondary-button rounded-xl px-8 py-3 text-[var(--text-secondary)]"
          >
            Ver o painel antes
          </a>
        </div>

        <p className="mt-6 font-terminal text-xs text-[var(--text-muted)]">
          Sem cartão de crédito • 3 análises gratuitas
        </p>
      </div>
    </section>
  );
};

export default FinalCtaSection;
