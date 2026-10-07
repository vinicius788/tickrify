import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTestimonials } from '@/lib/ratings';

/**
 * Depoimentos de assinantes (07/10/2026). So entra o que o proprio assinante
 * autorizou citar e o admin publicou; com menos de 2, a secao nao existe.
 * Nunca inventar depoimento (regra do projeto, CLAUDE.md 4.4).
 */
const TestimonialsSection = () => {
  const { t } = useLanguage();
  const items = useTestimonials();
  if (items.length === 0) return null;

  return (
    <section id="testimonials" className="site-dark">
      <div className="site-wrap">
        <div className="site-shead">
          <div className="site-scol">
            <h2>{t.rating.testimonialsTitle}</h2>
            <p>{t.rating.testimonialsSub}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {items.slice(0, 4).map((item, index) => (
            <figure key={index} className="site-card">
              <blockquote>&ldquo;{item.comment}&rdquo;</blockquote>
              <figcaption className="site-card-foot">
                <b>{[item.displayName, item.country].filter(Boolean).join(', ') || t.rating.subscriber}</b>
                <span>{t.rating.subscriber}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
