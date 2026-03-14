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
          style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(1.7rem, 2.4vw, 2.3rem)', lineHeight: 1.2, letterSpacing: '-0.02em' }}
        >
          Pronto para operar com <span style={{ color: 'var(--accent-green)' }}>precisão?</span>
        </h2>

        <p className="mx-auto mb-8 max-w-md text-sm text-[var(--text-secondary)]">
          Comece com 3 análises gratuitas e valide o fluxo em segundos.
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="/sign-in"
            className="rounded-lg px-8 py-3 font-semibold text-black transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#00D26A' }}
          >
            COMEÇAR GRÁTIS →
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
          Sem cartão de crédito • 3 análises gratuitas
        </p>
      </div>
    </section>
  );
};

export default FinalCtaSection;
