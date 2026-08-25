import { Instagram } from 'lucide-react';
import { Link } from 'react-router-dom';
import TermsOfServiceDialog from '@/components/landing/TermsOfServiceDialog';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import lockup from '@/assets/tickrify-lockup.svg';

const XBrandIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className="h-[15px] w-[15px]">
    <path d="M18.901 1.153h3.68l-8.04 9.19 9.456 12.504h-7.403l-5.793-7.57-6.63 7.57H.49l8.6-9.83L0 1.154h7.595l5.243 6.932 6.063-6.933Zm-1.29 19.512h2.04L6.486 3.258H4.298l13.313 17.407Z" />
  </svg>
);

/**
 * Rodapé do site público. Montado pelo SiteLayout em TODA página pública.
 *
 * A coluna Jurídico é obrigatória e não decorativa: a Stripe exige termos e
 * política de cancelamento acessíveis publicamente, e o aviso de risco é o
 * mínimo num produto de análise de mercado.
 */
const Footer = () => {
  const { t } = useLanguage();
  const f = t.landing.footer;

  return (
    <footer className="site-footer">
      <div className="site-wrap">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <a href="/" aria-label="Tickrify">
              <img src={lockup} alt="Tickrify" width={116} height={30} />
            </a>
            <p>{f.tagline}</p>
            <div className="site-social">
              <a href="https://x.com/tickrify" target="_blank" rel="noreferrer" aria-label="X">
                <XBrandIcon />
              </a>
              <a
                href="https://instagram.com/tickrify"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
              >
                <Instagram className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="site-footer-col">
            <h2>{f.product}</h2>
            <ul>
              <li><a href="/#how">{f.how}</a></li>
              <li><a href="/#platform">{f.panel}</a></li>
              <li><Link to="/pricing">{f.pricing}</Link></li>
              <li><Link to="/try">{f.tryFree}</Link></li>
              <li><Link to="/accuracy">{f.accuracy}</Link></li>
            </ul>
          </div>

          <div className="site-footer-col">
            <h2>{f.company}</h2>
            <ul>
              <li><a href="/blog/">{f.blog}</a></li>
              <li><a href="/#faq">{f.faq}</a></li>
              <li><a href="mailto:support@tickrify.com">{f.support}</a></li>
            </ul>
          </div>

          <div className="site-footer-col">
            <h2>{f.legal}</h2>
            <ul>
              {/* Termos continuam no diálogo (texto completo já existe).
                  Viram página própria junto com /refund, /cookies e /risk. */}
              <li><TermsOfServiceDialog /></li>
              <li><Link to="/privacy">{f.privacy}</Link></li>
            </ul>
          </div>
        </div>

        <div className="site-footer-legal">
          <p>{f.disclaimer}</p>
        </div>

        <div className="site-footer-bottom">
          <span>© {new Date().getFullYear()} Tickrify. {f.rights}</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
