import { SignUpButton, SignedIn, SignedOut } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/useReveal';
import SectionTitle from '@/components/landing/SectionTitle';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const AnalysisPanelPreviewSection = () => {
  const revealRef = useReveal<HTMLElement>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const p = t.landing.preview;
  // Mock ILUSTRATIVO: numeros dentro da faixa que o motor v7.3 realmente
  // produz (confianca 62-78, R/R exigido 1.5:1). Rotulado como exemplo — o
  // antigo badge "LIVE"/"AO VIVO" era enganoso, nada aqui e dado ao vivo.
  const mock = {
    label: t.landing.hero.mockLabel,
    signal: `▲ ${t.analysis.buy} 68%`,
    confluence: language === 'pt' ? 'Confluência' : 'Confluence',
  };

  return (
    <section ref={revealRef} id="preview-dashboard" className="landing-section section-platform reveal-on-scroll">
      <div className="container grid gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div className="max-w-2xl">
          <SectionTitle
            label={p.label}
            title={p.title}
            highlight={p.highlight}
            subtitle={p.subtitle}
          />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <SignedOut>
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
                <Button className="landing-primary-button h-12 rounded-xl px-6 font-semibold">
                  {p.testNow} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </SignUpButton>
              <SignUpButton mode="modal" forceRedirectUrl="/dashboard" signInForceRedirectUrl="/dashboard">
                <Button variant="outline" className="btn-secondary landing-secondary-button h-12 rounded-xl px-6">
                  {p.testWithChart}
                </Button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="landing-primary-button h-12 rounded-xl px-6 font-semibold"
              >
                {p.testNow} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                type="button"
                onClick={() => navigate('/dashboard')}
                variant="outline"
                className="btn-secondary landing-secondary-button h-12 rounded-xl px-6"
              >
                {p.testWithChart}
              </Button>
            </SignedIn>
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
              <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-3 py-1 font-terminal text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {mock.label}
              </span>

              <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
                <aside className="space-y-3 rounded-[20px] border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] p-4 text-xs">
                  <p className="font-terminal uppercase tracking-widest text-[var(--text-secondary)]">{p.quickActions}</p>
                  <button className="w-full rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-2 text-left font-medium text-[var(--signal-buy)]">
                    {p.newAnalysis}
                  </button>
                  <button className="w-full rounded-xl border border-[var(--border-card)] px-3 py-2 text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                    {p.myTrades}
                  </button>
                  <button className="w-full rounded-xl border border-[var(--border-card)] px-3 py-2 text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                    {t.nav.watchlist}
                  </button>
                </aside>

                <div className="space-y-4">
                  <div className="rounded-[20px] border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] p-4">
                    <p className="font-terminal text-xs uppercase tracking-widest text-[var(--text-secondary)]">{p.newAnalysis}</p>
                    <div className="mt-3 min-h-[170px] rounded-[18px] border border-dashed border-[var(--border-default)] bg-[rgba(5,5,8,0.6)] p-5 text-center text-xs text-[var(--text-secondary)]">
                      <div className="flex min-h-[130px] flex-col items-center justify-center gap-3">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] text-[var(--text-primary)]">
                          ⤴
                        </div>
                        <span>{p.dragChart}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] p-4 text-xs">
                    <div className="mb-3 flex items-center justify-between font-terminal">
                      <span className="text-[var(--text-primary)]">XAUUSD • M30</span>
                      <span className="flex items-center gap-2">
                        <span className="tag-compra">{mock.signal}</span>
                        <span className="rounded-full border border-[var(--border-card)] px-2 py-0.5 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                          {t.analysis.tierRead}
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 font-terminal text-[var(--text-secondary)]">
                      <span className="rounded-xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-[var(--text-primary)]">
                        Entry 4,261.40
                      </span>
                      <span className="rounded-xl border border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] px-3 py-2 text-right text-[var(--signal-sell)]">
                        Stop 4,240.00
                      </span>
                      <span className="rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-2 text-[var(--signal-buy)]">
                        TP1 4,295.50
                      </span>
                      <span className="rounded-xl border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-2 text-right text-[var(--signal-buy)]">
                        TP2 4,320.00
                      </span>
                    </div>
                    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 font-terminal text-[11px] text-[var(--text-secondary)]">
                      R/R 1.6:1 • {mock.confluence} 4/8 • Bias BULLISH
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
