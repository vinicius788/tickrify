import { useMemo } from 'react';
import { SignedIn, SignedOut } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

const HeroSection = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const h = t.landing.hero;
  const nowLabel = useMemo(
    () =>
      new Date().toLocaleString(DATE_LOCALES[language] ?? 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [language],
  );

  const scrollToPreview = () => {
    document.getElementById('preview-dashboard')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <section id="top" className="hero-section landing-hero section-primary">
      <div className="container relative z-10 grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="max-w-3xl">
          <div className="mb-8 landing-badge">
            <span>{h.badge}</span>
          </div>

          <h1
            className=""
            style={{
              fontSize: 'clamp(3.25rem, 7.5vw, 6.5rem)',
              fontWeight: 500,
              lineHeight: 0.98,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-serif)',
              color: 'var(--text-primary)',
            }}
          >
            {h.title1}
            <br />
            <span
              className="hero-highlight"
              style={{ fontSize: 'clamp(3.25rem, 7.5vw, 6.5rem)', fontWeight: 500, lineHeight: 0.98, letterSpacing: '-0.02em', fontFamily: 'var(--font-serif)' }}
            >
              {h.title2}
            </span>
          </h1>

          <p
            className="mt-6 max-w-[520px]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.05rem',
              lineHeight: 1.75,
              color: 'var(--text-secondary)',
            }}
          >
            {h.subtitle}
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <SignedOut>
              {/* Fase 0 (ativação): valor ANTES do cadastro. O CTA primário leva
                  à demo real sem signup (/try) — o "aha" vem antes do formulário. */}
              <Button
                type="button"
                onClick={() => navigate('/try')}
                className="landing-primary-button h-12 rounded-xl px-6 text-sm font-bold"
              >
                {t.tryDemo.heroCta} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </SignedOut>
            <SignedIn>
              <Button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="landing-primary-button h-12 rounded-xl px-6 text-sm font-bold"
              >
                {h.goToPanel} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </SignedIn>
            <Button
              type="button"
              onClick={scrollToPreview}
              variant="outline"
              className="btn-secondary landing-secondary-button h-12 rounded-xl px-6 text-sm font-medium"
            >
              {h.seeLive}
            </Button>
          </div>

          <p className="mt-6 font-terminal text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {h.freeNote}
          </p>
        </div>

        <aside className="signal-card-hero font-terminal p-5 md:p-6">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
            <span className="text-xs uppercase tracking-[0.08em] text-[var(--text-secondary)]">XAUUSD M30</span>
            {/* Mock ilustrativo. NUNCA rotular como "LIVE" — nao e dado ao vivo. */}
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-card)] px-2 py-0.5 uppercase tracking-[0.08em] text-[var(--text-muted)]">{h.mockLabel}</span>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-3 py-1.5 text-[var(--accent-green)]">
              <span className="text-sm">▲</span>
              <span className="text-sm font-semibold tracking-[0.04em]">{t.analysis.buy}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Confianca 68 = dentro da banda real do motor (v7.3 calibra 62-78,
                  >70 raro). Abaixo de 70 o produto mostra o chip "Read". */}
              <span className="rounded-full border border-[var(--border-card)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                {t.analysis.tierRead}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {t.analysis.confidence}: <strong className="text-[var(--text-primary)]">68%</strong>
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--border-card)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[11px] text-[var(--text-secondary)]">
            {nowLabel} • {h.terminal}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div className="signal-subcard">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">{t.analysis.entry.toUpperCase()}</p>
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
                $ 4,295.50 <small className="text-xs">+0.80%</small>
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
              R/R <strong className="text-[var(--text-primary)]">1.6:1</strong>
            </span>
            <span className="mx-2 text-[var(--text-muted)]">|</span>
            <span>
              {t.analysis.confluence} <strong className="text-[var(--text-primary)]">4/8</strong>
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
