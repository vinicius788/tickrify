import { SignInButton } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';

const AnalysisPanelPreviewSection = () => {
  const revealRef = useReveal<HTMLElement>();

  return (
    <section ref={revealRef} id="preview-dashboard" className="landing-section section-platform reveal-on-scroll">
      <div className="container grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div className="max-w-2xl">
          <SectionTitle
            label="Dentro da plataforma"
            title="Painel de execução"
            highlight="operacional."
            subtitle="Ambiente focado em decisão: estrutura, níveis de operação, risco e justificativa técnica em um layout denso e objetivo."
          />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="landing-primary-button h-12 rounded-xl px-6 font-semibold">
              <Link to="/demo">
                Ver painel completo <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <Button variant="outline" className="btn-secondary landing-secondary-button h-12 rounded-xl px-6">
                Testar com meu gráfico
              </Button>
            </SignInButton>
          </div>
        </div>

        <div className="dashboard-float-wrapper">
          <div className="dashboard-mockup">
            <div className="dashboard-mockup-topbar">
              <span className="dot dot-red" />
              <span className="dot dot-yellow" />
              <span className="dot dot-green" />
              <div className="ml-4 rounded-full border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.03)] px-4 py-1 font-terminal text-[11px] text-[var(--text-secondary)]">
                tickrify.app/dashboard
              </div>
            </div>

            <div className="relative p-4 md:p-5">
              <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-1 font-terminal text-[10px] uppercase tracking-widest text-[var(--signal-buy)]">
                <span className="live-pulse h-1.5 w-1.5 rounded-full bg-[var(--signal-buy)]" /> AO VIVO
              </span>

              <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
                <aside className="space-y-3 rounded-[20px] border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] p-4 text-xs">
                  <p className="font-terminal uppercase tracking-widest text-[var(--text-secondary)]">Ações rápidas</p>
                  <button className="w-full rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-2 text-left font-medium text-[var(--signal-buy)]">
                    Nova análise
                  </button>
                  <button className="w-full rounded-xl border border-[var(--border-card)] px-3 py-2 text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                    Meus trades
                  </button>
                  <button className="w-full rounded-xl border border-[var(--border-card)] px-3 py-2 text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                    Watchlist
                  </button>
                </aside>

                <div className="space-y-4">
                  <div className="rounded-[20px] border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] p-4">
                    <p className="font-terminal text-xs uppercase tracking-widest text-[var(--text-secondary)]">Nova análise</p>
                    <div className="mt-3 min-h-[170px] rounded-[18px] border border-dashed border-[var(--border-default)] bg-[rgba(5,5,8,0.6)] p-5 text-center text-xs text-[var(--text-secondary)]">
                      <div className="flex min-h-[130px] flex-col items-center justify-center gap-3">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] text-[var(--text-primary)]">
                          ⤴
                        </div>
                        <span>Arraste o gráfico aqui</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] p-4 text-xs">
                    <div className="mb-3 flex items-center justify-between font-terminal">
                      <span className="text-[var(--text-primary)]">XAUUSD • M30</span>
                      <span className="tag-compra">▲ COMPRA 80%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 font-terminal text-[var(--text-secondary)]">
                      <span className="rounded-xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[var(--text-primary)]">
                        Entry 4,261.40
                      </span>
                      <span className="rounded-xl border border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] px-3 py-2 text-right text-[var(--signal-sell)]">
                        Stop 4,240.00
                      </span>
                      <span className="rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-2 text-[var(--signal-buy)]">
                        TP1 4,300.00
                      </span>
                      <span className="rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-2 text-right text-[var(--signal-buy)]">
                        TP2 4,320.00
                      </span>
                    </div>
                    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 font-terminal text-[11px] text-[var(--text-secondary)]">
                      R/R 2.0:1 • Confluência 4/8 • Bias BULLISH
                    </div>
                  </div>
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
