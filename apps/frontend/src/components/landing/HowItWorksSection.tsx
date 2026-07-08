import { Crosshair, ScanSearch, UploadCloud } from 'lucide-react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const HowItWorksSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const { t } = useLanguage();
  const hw = t.landing.how;

  const steps = [
    { number: '01', title: hw.s1t, description: hw.s1d, icon: UploadCloud },
    { number: '02', title: hw.s2t, description: hw.s2d, icon: ScanSearch },
    { number: '03', title: hw.s3t, description: hw.s3d, icon: Crosshair },
  ];

  return (
    <section ref={revealRef} id="como-funciona" className="landing-section section-primary reveal-on-scroll">
      <div className="container">
        <SectionTitle
          label={hw.label}
          title={hw.title}
          highlight={hw.highlight}
          subtitle={hw.subtitle}
        />

        <div className="relative mt-10 grid gap-4 md:grid-cols-3">
          <div className="pointer-events-none absolute left-[16%] right-[16%] top-14 hidden border-t border-dashed border-[rgba(0,232,122,0.2)] md:block" />

          {steps.map((step, index) => (
            <article key={step.number} className={`step-card ${index === 1 ? 'step-card--active' : ''}`}>
              <div className="mb-4 flex items-center justify-between">
                <span className="step-number">{step.number}</span>
                <span className="step-icon">
                  <step.icon className="h-5 w-5" />
                </span>
              </div>

              <h3 className="text-lg font-semibold text-[var(--text-primary)]">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
