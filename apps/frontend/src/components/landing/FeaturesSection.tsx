import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Recursos em lista de duas colunas separada por fio, sem cartão e sem ícone.
 *
 * REGRA (auditoria 24/07/2026): todo item aqui corresponde a código que está no
 * ar. Nada de recurso prometido.
 */
const FeaturesSection = () => {
  const { t } = useLanguage();
  const f = t.landing.features;

  const features = [
    { title: f.f1t, desc: f.f1d },
    { title: f.f3t, desc: f.f3d },
    { title: f.f5t, desc: f.f5d },
    { title: f.f6t, desc: f.f6d },
    { title: f.f2t, desc: f.f2d },
    { title: f.f4t, desc: f.f4d },
  ];

  return (
    <section id="features" className="site-light">
      <div className="site-wrap">
        <div className="site-sblk">
          <span className="site-eyebrow">{f.label}</span>
          <h2>{f.title} {f.highlight}</h2>
        </div>

        <div className="site-feat">
          {features.map((feature) => (
            <div key={feature.title} className="site-f">
              <h3>{feature.title}</h3>
              <p>{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
