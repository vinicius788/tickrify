import { BarChart3, Bell, Bot, BrainCircuit, Globe2, ShieldCheck } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const FeaturesSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const f = t.landing.features;

  const features = [
    { icon: Bot, title: f.f1t, description: f.f1d, status: 'ready' as const },
    { icon: Globe2, title: f.f2t, description: f.f2d, status: 'ready' as const },
    { icon: ShieldCheck, title: f.f3t, description: f.f3d, status: 'ready' as const },
    { icon: BarChart3, title: f.f4t, description: f.f4d, status: 'ready' as const },
    { icon: Bell, title: f.f5t, description: f.f5d, status: 'soon' as const },
    { icon: BrainCircuit, title: f.f6t, description: f.f6d, status: 'soon' as const },
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
