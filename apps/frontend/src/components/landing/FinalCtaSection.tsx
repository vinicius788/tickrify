import { useReveal } from '@/hooks/useReveal';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const FinalCtaSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const c = t.landing.cta;

  return (
    <section ref={revealRef} className="landing-section section-primary cta-section reveal-on-scroll px-6">
      <div className="cta-card mx-auto max-w-5xl">
        <div className="landing-badge mb-6">
          <span>{c.badge}</span>
        </div>

        <h2
          className="mb-4 text-[clamp(2rem,4vw,3.4rem)] font-medium leading-[1.04] tracking-[-0.02em] text-[var(--text-primary)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {c.title} <span className="hero-highlight">{c.highlight}</span>
        </h2>

        <p className="mx-auto mb-8 max-w-md text-sm leading-7 text-[var(--text-secondary)]">
          {c.subtitle}
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="/sign-in"
            className="landing-primary-button rounded-xl px-8 py-3 font-semibold"
          >
            {c.primary}
          </a>
          <a
            href="#preview-dashboard"
            className="btn-secondary landing-secondary-button rounded-xl px-8 py-3 text-[var(--text-secondary)]"
          >
            {c.secondary}
          </a>
        </div>

        <p className="mt-6 font-terminal text-xs text-[var(--text-muted)]">
          {c.footnote}
        </p>
      </div>
    </section>
  );
};

export default FinalCtaSection;
