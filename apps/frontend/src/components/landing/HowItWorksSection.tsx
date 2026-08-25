import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Como funciona, em três linhas editoriais.
 *
 * Era um grid de três cartões iguais. Virou linha, com fio separando: quebra a
 * repetição de "tudo é cartão" que era metade do ar amador da página antiga.
 */
const HowItWorksSection = () => {
  const { t } = useLanguage();
  const hw = t.landing.how;

  const steps = [
    { n: '01', title: hw.s1t, desc: hw.s1d },
    { n: '02', title: hw.s2t, desc: hw.s2d },
    { n: '03', title: hw.s3t, desc: hw.s3d },
  ];

  return (
    <section id="how" className="site-light">
      <div className="site-wrap">
        <div className="site-sblk">
          <span className="site-eyebrow">{hw.label}</span>
          <h2>{hw.title} {hw.highlight}</h2>
        </div>

        {steps.map((step) => (
          <div key={step.n} className="site-step">
            <div className="site-step-n">STEP {step.n}</div>
            <h3>{step.title}</h3>
            <p>{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default HowItWorksSection;
