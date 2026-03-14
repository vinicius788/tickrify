import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

type Step = {
  number: string;
  title: string;
  description: string;
  icon: string;
};

const steps: Step[] = [
  {
    number: '01',
    title: 'Capture o gráfico',
    description: 'Print do seu setup. Qualquer ativo, qualquer timeframe.',
    icon: '⬆',
  },
  {
    number: '02',
    title: 'IA analisa',
    description: 'GPT-4o lê estrutura, zonas e confluências em segundos.',
    icon: '⚡',
  },
  {
    number: '03',
    title: 'Execute com precisão',
    description: 'Entrada, stop e alvos calculados. Sem achismo.',
    icon: '▲',
  },
];

const HowItWorksSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="como-funciona" className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle
          label="Como funciona"
          title="Do gráfico ao sinal"
          highlight="em segundos."
          subtitle="Processo objetivo em três etapas para reduzir ruído e acelerar decisão operacional."
        />

        <div className="relative mt-10 grid gap-4 md:grid-cols-3">
          <div className="pointer-events-none absolute left-[16%] right-[16%] top-11 hidden border-t border-dashed border-[var(--signal-buy-border)] md:block" />

          {steps.map((step, index) => (
            <article
              key={step.number}
              className={`rounded-xl border bg-[var(--bg-card)] p-5 transition-colors duration-200 hover:border-[var(--border-hover)] ${
                index === 1
                  ? 'border-[var(--signal-buy-border)] border-l-2 border-l-[var(--accent-green)]'
                  : 'border-[var(--border)]'
              }`}
            >
              <div className="mb-4 flex items-center justify-between">
                <span
                  className="font-terminal"
                  style={{ fontSize: '48px', lineHeight: 1, color: 'var(--text-muted)', fontWeight: 500 }}
                >
                  {step.number}
                </span>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-lg text-[var(--accent-green)]">
                  {step.icon}
                </span>
              </div>

              <h3 className="text-lg font-semibold text-[var(--text-primary)]">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
