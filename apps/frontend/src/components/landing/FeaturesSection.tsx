import { BarChart3, Bot, CalendarClock, CandlestickChart, Globe2, ShieldCheck } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const FeaturesSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const f = t.landing.features;

  // REGRA (auditoria 24/07/2026): todo card aqui corresponde a codigo que esta
  // no ar. Os antigos f5 "Real-time alerts" e f6 "Continuous education" nao
  // existiam em lugar nenhum do codigo e foram trocados por diferenciais reais
  // (grounding com candles ao vivo, guarda do calendario economico).
  // Maximo de 1 card com badge "Soon", e so com entrega comprometida.
  const features: Array<{
    icon: typeof Bot;
    title: string;
    description: string;
    status: 'ready' | 'soon';
  }> = [
    { icon: Bot, title: f.f1t, description: f.f1d, status: 'ready' },
    { icon: Globe2, title: f.f2t, description: f.f2d, status: 'ready' },
    { icon: ShieldCheck, title: f.f3t, description: f.f3d, status: 'ready' },
    { icon: BarChart3, title: f.f4t, description: f.f4d, status: 'ready' },
    { icon: CandlestickChart, title: f.f5t, description: f.f5d, status: 'ready' },
    { icon: CalendarClock, title: f.f6t, description: f.f6d, status: 'ready' },
  ];

  return (
    <section ref={revealRef} id="recursos" className="landing-section section-secondary reveal-on-scroll">
      <div className="container">
        <SectionTitle label={f.label} title={f.title} highlight={f.highlight} />

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
                      {f.soon}
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
