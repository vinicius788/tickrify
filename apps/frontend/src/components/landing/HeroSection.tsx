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
    <section ref={revealRef} id="top" className="hero-section landing-hero section-primary reveal-on-scroll">
      <div className="container relative z-10 grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="max-w-3xl">
          <div className="fade-up-1 mb-8 landing-badge">
            <span>Análise com IA • tempo real</span>
          </div>

          <h1
            className="fade-up-2"
            style={{
              fontSize: 'clamp(3.5rem, 8vw, 7rem)',
              fontWeight: 800,
              lineHeight: 0.95,
              letterSpacing: '-0.03em',
              fontFamily: 'var(--font-display)',
              color: 'var(--text-primary)',
            }}
          >
            Pare de operar
            <br />
            <span
              className="hero-highlight"
              style={{ fontSize: 'clamp(3.5rem, 8vw, 7rem)', fontWeight: 800, lineHeight: 0.95, letterSpacing: '-0.03em' }}
            >
              no escuro.
            </span>
          </h1>

          <p
            className="fade-up-3 mt-6 max-w-[520px]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.05rem',
              lineHeight: 1.75,
              color: 'var(--text-secondary)',
            }}
          >
            A IA que lê seu gráfico, calcula o risco e diz exatamente onde entrar.
          </p>

          <div className="fade-up-4 mt-9 flex flex-col gap-3 sm:flex-row">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <Button className="landing-primary-button h-12 rounded-xl px-6 text-sm font-bold">
                Começar grátis <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </SignInButton>
            <Button
              type="button"
              onClick={scrollToPreview}
              variant="outline"
              className="btn-secondary landing-secondary-button h-12 rounded-xl px-6 text-sm font-medium"
            >
              Ver análise ao vivo
            </Button>
          </div>

          <p className="mt-6 font-terminal text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            Sem cartão de crédito • 3 análises gratuitas
          </p>
        </div>

        <aside className="signal-card-hero font-terminal p-5 md:p-6">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
            <span className="text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">XAUUSD M30</span>
            <span className="live-dot inline-flex items-center gap-1 uppercase tracking-[0.08em]">● LIVE</span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-1.5 text-[var(--accent-green)]">
              <span className="text-sm">▲</span>
              <span className="text-sm font-semibold tracking-[0.04em]">COMPRA</span>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">
              Confiança: <strong className="text-[var(--text-primary)]">80%</strong>
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[11px] text-[var(--text-secondary)]">
            {nowLabel} • terminal institucional
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div className="signal-subcard">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">ENTRADA</p>
              <p className="signal-price mt-2 text-[var(--text-primary)]">$ 4,261.40</p>
            </div>
            <div className="signal-subcard stop">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--signal-sell)]">STOP</p>
              <p className="signal-price mt-2 text-[var(--signal-sell)]">
                $ 4,240.00 <small className="text-xs">-0.50%</small>
              </p>
            </div>
            <div className="signal-subcard tp">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--signal-buy)]">TP1</p>
              <p className="signal-price mt-2 text-[var(--signal-buy)]">
                $ 4,300.00 <small className="text-xs">+0.91%</small>
              </p>
            </div>
            <div className="signal-subcard tp">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--signal-buy)]">TP2</p>
              <p className="signal-price mt-2 text-[var(--signal-buy)]">
                $ 4,320.00 <small className="text-xs">+1.38%</small>
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[11px] text-[var(--text-secondary)]">
            <span>
              R/R <strong className="text-[var(--text-primary)]">2.0:1</strong>
            </span>
            <span className="mx-2 text-[var(--text-muted)]">|</span>
            <span>
              Confluência <strong className="text-[var(--text-primary)]">4/8</strong>
            </span>
            <span className="mx-2 text-[var(--text-muted)]">|</span>
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
