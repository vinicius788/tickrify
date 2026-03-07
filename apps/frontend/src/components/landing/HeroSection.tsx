import { useEffect, useMemo, useState } from 'react';
import { SignInButton } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';

type TypingValueProps = {
  value: string;
  className?: string;
  delay?: number;
};

const TypingValue = ({ value, className = '', delay = 0 }: TypingValueProps) => {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    let frame: number | null = null;
    const timeout = window.setTimeout(() => {
      let cursor = 0;
      const tick = () => {
        cursor += 1;
        setDisplay(value.slice(0, cursor));
        if (cursor < value.length) {
          frame = window.setTimeout(tick, 18) as unknown as number;
        }
      };
      tick();
    }, delay);

    return () => {
      window.clearTimeout(timeout);
      if (frame !== null) {
        window.clearTimeout(frame);
      }
    };
  }, [delay, value]);

  return <span className={className}>{display || value}</span>;
};

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
    <section ref={revealRef} className="reveal-on-scroll pb-24 pt-20 md:pb-28 md:pt-24" id="top">
      <div className="container grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-1">
            <span className="live-pulse h-1.5 w-1.5 rounded-full bg-[var(--signal-buy)]" />
            <span className="font-terminal text-xs uppercase tracking-widest text-[var(--signal-buy)]">
              Análise em Tempo Real
            </span>
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 'clamp(2.2rem, 4vw, 3.2rem)',
              lineHeight: 1.15,
              color: '#E8ECF4',
            }}
          >
            <span>Pare de operar</span>
            <br />
            <span className="text-[var(--signal-buy)]">no escuro.</span>
          </h1>

          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1rem',
              color: '#8892A4',
              marginTop: '16px',
              maxWidth: '420px',
              lineHeight: 1.6,
            }}
          >
            A IA que lê seu gráfico, calcula o risco e diz exatamente onde entrar.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <Button className="h-11 rounded-md bg-[var(--signal-buy)] px-6 text-sm font-semibold uppercase tracking-wide text-black hover:opacity-90">
                Começar Grátis <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </SignInButton>
            <Button
              type="button"
              onClick={scrollToPreview}
              variant="outline"
              className="h-11 rounded-md border-[var(--border-default)] bg-transparent px-6 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            >
              Ver uma análise ao vivo
            </Button>
          </div>

          <p className="mt-5 font-terminal text-xs uppercase tracking-wide text-[var(--text-secondary)]">
            Sem cartão de crédito • 3 análises gratuitas
          </p>
        </div>

        <aside className="surface-terminal-elevated overflow-hidden rounded-xl border border-[var(--border-subtle)]">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
            <div className="font-terminal text-xs uppercase tracking-widest text-[var(--text-secondary)]">
              Análise ao vivo · XAUUSD M30
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs text-[var(--signal-buy)]">
              <span className="live-pulse h-1.5 w-1.5 rounded-full bg-[var(--signal-buy)]" /> LIVE
            </div>
          </div>

          <div className="space-y-3 p-4 font-terminal text-sm">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2 text-[var(--signal-buy)]">
                <span>▲</span>
                <span className="font-semibold">COMPRA</span>
              </div>
              <div className="text-[var(--text-secondary)]">
                Confiança: <TypingValue value="80%" className="text-[var(--text-primary)]" delay={120} />
              </div>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              {nowLabel} • terminal institucional
            </div>

            <div className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <p className="text-[var(--text-secondary)]">
                  ENTRADA{' '}
                  <TypingValue value="$ 4,261.40" className="text-[var(--text-primary)]" delay={240} />
                </p>
                <p className="text-right text-[var(--signal-sell)]">
                  STOP <TypingValue value="$ 4,240.00" delay={320} /> <TypingValue value="-0.50%" delay={360} />
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[var(--signal-buy)]">
                <p>
                  TP1 <TypingValue value="$ 4,300.00" delay={420} /> <TypingValue value="+0.91%" delay={460} />
                </p>
                <p className="text-right">
                  TP2 <TypingValue value="$ 4,320.00" delay={520} /> <TypingValue value="+1.38%" delay={560} />
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-secondary)]">
              <span>
                R/R <span className="text-[var(--text-primary)]">2.0:1</span>
              </span>
              <span>
                Confluência <span className="text-[var(--text-primary)]">4/8</span>
              </span>
              <span>
                Bias <span className="text-[var(--signal-buy)]">BULLISH</span>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
};

export default HeroSection;
