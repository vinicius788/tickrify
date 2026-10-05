import { SignedIn, SignedOut } from '@clerk/clerk-react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Hero do site. Uma ideia por tela: título em duas linhas, uma frase, dois
 * botões, e o cartão de leitura à direita mostrando o formato do resultado.
 *
 * O cartão é um exemplo e está rotulado como tal. Nunca rotular como "live":
 * não é dado ao vivo.
 */
const HeroSection = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const h = t.landing.hero;

  return (
    <section id="top" className="site-dark site-hero">
      <div className="site-wrap site-hero-grid">
        <div>
          <span className="site-tag"><i />{h.badge}</span>

          <h1>
            {h.title1}
            <br />
            {h.title2}
          </h1>

          {/* Linha semantica explicita. O H1 ("Your AI trading copilot.", 05/10) e de
              marca e nao contem nenhum termo de busca: sem esta frase, a
              primeira ocorrencia de "AI chart analysis" na home so aparecia
              no <head>. Auditoria de SEO, 02/09/2026. */}
          <p className="site-hero-seo">{h.seoLine}</p>

          <p className="site-hero-sub">{h.subtitle}</p>

          <div className="site-hero-actions">
            {/* Fase 0 (ativação): o CTA primário leva à demo real sem cadastro.
                O valor vem antes do formulário. */}
            <SignedOut>
              <button
                type="button"
                onClick={() => navigate('/try')}
                className="site-btn site-btn-primary"
              >
                {h.startFree} <ArrowRight className="h-4 w-4" />
              </button>
            </SignedOut>
            <SignedIn>
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="site-btn site-btn-primary"
              >
                {h.goToPanel} <ArrowRight className="h-4 w-4" />
              </button>
            </SignedIn>
            <a href="#platform" className="site-btn site-btn-ghost">{h.seeExample}</a>
          </div>

          {/* Diferencial real contra os concorrentes de diário de trading, cuja
              IA só funciona depois de 5 a 10 trades registrados à mão. Aqui a
              primeira leitura sai no primeiro upload. */}
          <p className="mb-4 max-w-[46ch] text-sm leading-relaxed text-[var(--s-fg-2)]">{h.valueNow}</p>

          <p className="site-hero-note">{h.freeNote}</p>
        </div>

        <aside className="site-card">
          <div className="site-card-head">
            <span className="site-sym">XAUUSD · M30</span>
            <span className="site-chip">{h.mockLabel}</span>
          </div>

          <div className="site-verdict">
            <span className="site-call site-long">▲ BULLISH</span>
            <span className="site-conf">{h.mockScored}</span>
          </div>

          <div className="site-levels">
            <div>
              <span>{t.analysis.entry}</span>
              <strong>4,261.40</strong>
            </div>
            <div>
              <span>Stop</span>
              <strong className="site-short">4,240.00<em>-0.50%</em></strong>
            </div>
            <div>
              <span>TP1</span>
              <strong className="site-long">4,295.50<em>+0.80%</em></strong>
            </div>
            <div>
              <span>TP2</span>
              <strong className="site-long">4,320.00<em>+1.38%</em></strong>
            </div>
          </div>

          <div className="site-card-foot">
            <span>{h.mockRr} <b>1.6:1</b></span>
            <span>{t.analysis.confluence} <b>4/8</b></span>
            <span>{t.analysis.action} <b className="site-long">{t.analysis.buy}</b></span>
          </div>
        </aside>
      </div>
    </section>
  );
};

export default HeroSection;
