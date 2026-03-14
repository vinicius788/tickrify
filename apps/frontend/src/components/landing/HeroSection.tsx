import { useMemo } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';

const HeroSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const nowLabel = useMemo(
    () =>
      new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );

  const scrollToPreview = () => {
    document.getElementById('preview-dashboard')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <section ref={revealRef} id="top" className="reveal-on-scroll relative overflow-hidden pb-24 pt-20 md:pt-24">
      <div className="container relative z-10 grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-3xl">
          <div className="fade-up-1 mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-green)] live-pulse" />
            <span className="font-terminal text-[11px] uppercase tracking-[0.1em] text-[var(--accent-green)]">
              Análise com IA • tempo real
            </span>
          </div>

          <h1
            className="fade-up-2"
            style={{
              fontSize: 'clamp(56px, 8vw, 104px)',
              fontWeight: 900,
              lineHeight: 0.95,
              letterSpacing: '-0.04em',
              fontFamily: 'var(--font-sans)',
              color: 'var(--text-primary)',
            }}
          >
            Pare de operar
            <br />
            <span
              style={{
                fontSize: 'clamp(56px, 8vw, 104px)',
                fontWeight: 900,
                lineHeight: 0.95,
                letterSpacing: '-0.04em',
                color: 'var(--accent)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              no escuro.
            </span>
          </h1>

          <p
            className="fade-up-3 mt-6 max-w-[520px]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.05rem',
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
            }}
          >
            A IA que lê seu gráfico, calcula o risco e diz exatamente onde entrar.
          </p>

          <div className="fade-up-4 mt-9 flex flex-col gap-3 sm:flex-row">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <Button className="h-11 rounded-md bg-[var(--accent-green)] px-6 text-sm font-bold text-black hover:opacity-90">
                Começar grátis <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </SignInButton>
            <Button
              type="button"
              onClick={scrollToPreview}
              variant="outline"
              className="h-11 rounded-md border-[var(--border)] bg-transparent px-6 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface)]"
            >
              Ver análise ao vivo
            </Button>
          </div>

          <p className="mt-5 font-terminal text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            Sem cartão de crédito • 3 análises gratuitas
          </p>
        </div>

        <aside className="group rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 font-terminal transition-colors duration-200 hover:border-[var(--border-hover)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <span className="text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">XAUUSD M30</span>
            <span className="live-dot inline-flex items-center gap-1">● LIVE</span>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-[var(--accent-green)]">
              <span>▲</span>
              <span className="text-sm font-semibold">COMPRA</span>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">Confiança: <strong className="text-[var(--text-primary)]">80%</strong></span>
          </div>

          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
            {nowLabel} • terminal institucional
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">ENTRADA</p>
              <p className="mt-1 text-[var(--text-primary)]">$ 4,261.40</p>
            </div>
            <div className="rounded-md border border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--signal-sell)]">STOP</p>
              <p className="mt-1 text-[var(--signal-sell)]">$ 4,240.00 <small>-0.50%</small></p>
            </div>
            <div className="rounded-md border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--signal-buy)]">TP1</p>
              <p className="mt-1 text-[var(--signal-buy)]">$ 4,300.00 <small>+0.91%</small></p>
            </div>
            <div className="rounded-md border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--signal-buy)]">TP2</p>
              <p className="mt-1 text-[var(--signal-buy)]">$ 4,320.00 <small>+1.38%</small></p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-[11px] text-[var(--text-secondary)]">
            <span>
              R/R <strong className="text-[var(--text-primary)]">2.0:1</strong>
            </span>
            <span>
              Confluência <strong className="text-[var(--text-primary)]">4/8</strong>
            </span>
            <span>
              Bias <strong className="text-[var(--accent-green)]">BULLISH</strong>
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
};

export default HeroSection;
