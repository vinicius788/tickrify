import { SignInButton } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

const AnalysisPanelPreviewSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="preview-dashboard" className="reveal-on-scroll py-28">
      <div className="container grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div className="max-w-2xl">
          <SectionTitle
            label="Dentro da plataforma"
            title="Painel de execução"
            highlight="operacional."
            subtitle="Ambiente focado em decisão: estrutura, níveis de operação, risco e justificativa técnica em um layout denso e objetivo."
          />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-11 rounded-md bg-[var(--signal-buy)] px-6 font-semibold text-black hover:opacity-90">
              <Link to="/demo">
                Ver painel completo <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <Button
                variant="outline"
                className="h-11 rounded-md border-[var(--border-default)] bg-transparent px-6 text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              >
                Testar com meu gráfico
              </Button>
            </SignInButton>
          </div>
        </div>

        <div
          className="relative overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"
          style={{ boxShadow: '0 0 40px rgba(0,210,106,0.08)' }}
        >
          <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-2 py-1 font-terminal text-[10px] uppercase tracking-widest text-[var(--signal-buy)]">
            <span className="live-pulse h-1.5 w-1.5 rounded-full bg-[var(--signal-buy)]" /> AO VIVO
          </span>

          <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
            <aside className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
              <p className="font-terminal uppercase tracking-widest text-[var(--text-secondary)]">Ações rápidas</p>
              <button className="w-full rounded border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-2 py-1 text-left text-[var(--signal-buy)]">
                Nova análise
              </button>
              <button className="w-full rounded border border-[var(--border-subtle)] px-2 py-1 text-left text-[var(--text-secondary)]">
                Meus trades
              </button>
              <button className="w-full rounded border border-[var(--border-subtle)] px-2 py-1 text-left text-[var(--text-secondary)]">
                Watchlist
              </button>
            </aside>

            <div className="space-y-3">
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <p className="font-terminal text-xs uppercase tracking-widest text-[var(--text-secondary)]">Nova análise</p>
                <div className="mt-2 rounded border border-dashed border-[var(--border-default)] bg-[var(--bg-overlay)] p-5 text-center text-xs text-[var(--text-secondary)]">
                  Arraste o gráfico aqui
                </div>
              </div>

              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
                <div className="mb-2 flex items-center justify-between font-terminal">
                  <span className="text-[var(--text-primary)]">XAUUSD • M30</span>
                  <span className="text-[var(--signal-buy)]">▲ COMPRA 80%</span>
                </div>
                <div className="grid grid-cols-2 gap-2 font-terminal text-[var(--text-secondary)]">
                  <span>Entry 4,261.40</span>
                  <span className="text-right text-[var(--signal-sell)]">Stop 4,240.00</span>
                  <span className="text-[var(--signal-buy)]">TP1 4,300.00</span>
                  <span className="text-right text-[var(--signal-buy)]">TP2 4,320.00</span>
                </div>
                <div className="mt-2 border-t border-[var(--border-subtle)] pt-2 font-terminal text-[11px] text-[var(--text-secondary)]">
                  R/R 2.0:1 • Confluência 4/8 • Bias BULLISH
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AnalysisPanelPreviewSection;
