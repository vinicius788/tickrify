import { useLanguage } from '@/lib/i18n/LanguageContext';

const FinalCtaSection = () => {
  const { t } = useLanguage();
  const c = t.landing.cta;

  return (
    <section className="site-dark site-closer">
      <div className="site-wrap">
        <h2>{c.title} {c.highlight}</h2>
        <p>{c.subtitle}</p>
        <a href="/try" className="site-btn site-btn-primary">{c.primary}</a>
        <p className="site-hero-note" style={{ marginTop: '24px' }}>{c.footnote}</p>
      </div>
    </section>
  );
};

export default FinalCtaSection;
