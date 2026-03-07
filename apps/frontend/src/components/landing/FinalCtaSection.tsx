import { useReveal } from '@/hooks/useReveal';

const FinalCtaSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} className="reveal-on-scroll px-6 py-24">
      <div
        className="mx-auto max-w-3xl rounded-2xl border p-12 text-center"
        style={{ borderColor: '#1E2230', backgroundColor: '#0F1117' }}
      >
        <div
          className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1"
          style={{ borderColor: 'rgba(0,210,106,0.3)', backgroundColor: 'rgba(0,210,106,0.06)' }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: '#00D26A' }} />
          <span className="font-terminal text-xs uppercase tracking-widest text-[var(--signal-buy)]">Beta aberto agora</span>
        </div>

        <h2
          className="mb-4 text-[var(--text-primary)]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(1.6rem, 2.2vw, 2rem)', lineHeight: 1.3 }}
        >
          Comece sua primeira análise <span style={{ color: '#00D26A' }}>agora mesmo.</span>
        </h2>

        <p className="mx-auto mb-8 max-w-md text-sm text-[var(--text-secondary)]">
          3 análises gratuitas. Sem cartão de crédito. Resultado em menos de 3 segundos.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="/sign-in"
            className="rounded-lg px-8 py-3 font-semibold text-black transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#00D26A' }}
          >
            Começar grátis →
          </a>
          <a
            href="#preview-dashboard"
            className="rounded-lg border px-8 py-3 text-[var(--text-secondary)] transition-colors hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            style={{ borderColor: '#2A3042' }}
          >
            Ver o painel antes
          </a>
        </div>

        <p className="mt-6 font-terminal text-xs text-[var(--text-muted)]">
          Sem compromisso • Cancele quando quiser • Dados não compartilhados
        </p>
      </div>
    </section>
  );
};

export default FinalCtaSection;
