import type { ReactNode } from 'react';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

type Step = {
  title: string;
  description: string;
  preview: ReactNode;
};

const steps: Step[] = [
  {
    title: 'Upload do gráfico',
    description: 'Arraste o print do gráfico. PNG, JPG ou WEBP.',
    preview: (
      <div className="rounded-md border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-center text-xs text-[var(--text-secondary)]">
        Arraste o arquivo aqui
      </div>
    ),
  },
  {
    title: 'IA analisa',
    description: 'Smart Money, BOS/CHoCH, Order Blocks e leitura MTF.',
    preview: (
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-secondary)]">
        <p className="font-terminal text-[var(--signal-buy)]">Analisando estrutura...</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
          <div className="h-full w-3/4 animate-pulse bg-[var(--signal-buy)]" />
        </div>
      </div>
    ),
  },
  {
    title: 'Você opera',
    description: 'Entry, Stop e Take calculados com R/R validado.',
    preview: (
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs font-terminal text-[var(--text-secondary)]">
        <p>▲ COMPRA</p>
        <p className="mt-1 text-[var(--text-primary)]">Entry 4,261.40</p>
        <p className="text-[var(--signal-sell)]">Stop 4,240.00</p>
        <p className="text-[var(--signal-buy)]">TP1 4,300.00</p>
      </div>
    ),
  },
];

const HowItWorksSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="como-funciona" className="reveal-on-scroll py-28">
      <div className="container">
        <SectionTitle
          label="Como funciona"
          title="Fluxo simples,"
          highlight="execução precisa."
          subtitle="Três etapas. Do gráfico ao sinal operacional em segundos."
        />

        <div className="relative grid gap-4 md:grid-cols-3">
          <div className="pointer-events-none absolute left-[16.666%] right-[16.666%] top-8 hidden border-t border-dashed border-[var(--signal-buy-border)] md:block" />

          {steps.map((step, index) => (
            <article
              key={step.title}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 opacity-0 [animation:fadeInUp_500ms_ease_forwards]"
              style={{ animationDelay: `${index * 200}ms` }}
            >
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--signal-buy)] font-display text-xl font-semibold text-[var(--signal-buy)]">
                {index + 1}
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">{step.title}</h3>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{step.description}</p>
              <div className="mt-4">{step.preview}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
