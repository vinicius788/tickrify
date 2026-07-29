import { Instagram } from 'lucide-react';
import { Link } from 'react-router-dom';
import TermsOfServiceDialog from '@/components/landing/TermsOfServiceDialog';
import officialLogo from '@/assets/tickrify-logo-official.png';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const XBrandIcon = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M18.901 1.153h3.68l-8.04 9.19 9.456 12.504h-7.403l-5.793-7.57-6.63 7.57H.49l8.6-9.83L0 1.154h7.595l5.243 6.932 6.063-6.933Zm-1.29 19.512h2.04L6.486 3.258H4.298l13.313 17.407Z" />
  </svg>
);

const Footer = () => {
  const { t } = useLanguage();
  const f = t.landing.footer;
  return (
    <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="container py-16">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <a href="/" className="inline-flex items-center">
              <img
                src={officialLogo}
                alt="Tickrify"
                className="h-14 w-auto object-contain"
                style={{ filter: 'drop-shadow(0 0 8px rgba(0,232,122,0.28))' }}
              />
            </a>
            <p className="footer-logo-tagline">{f.tagline}</p>

            <div className="mt-5 flex items-center gap-3 text-[var(--text-secondary)]">
              <a href="https://x.com/tickrify" target="_blank" rel="noreferrer" aria-label="X" className="footer-social-link">
                <XBrandIcon />
              </a>
              <a href="https://instagram.com/tickrify" target="_blank" rel="noreferrer" aria-label="Instagram" className="footer-social-link">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-semibold text-[var(--text-primary)]">{f.platform}</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
              <li><a href="#recursos" className="footer-nav-link">{f.features}</a></li>
              <li><a href="#preview-dashboard" className="footer-nav-link">{f.panel}</a></li>
              <li><a href="#planos" className="footer-nav-link">{f.plans}</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-[var(--text-primary)]">{f.company}</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
              <li><a href="#faq" className="footer-nav-link">{f.faq}</a></li>
              <li>
                <Link to="/accuracy" className="footer-nav-link">{f.accuracy}</Link>
              </li>
              <li><TermsOfServiceDialog /></li>
              <li>
                <Link to="/privacy" className="footer-nav-link">{f.privacy}</Link>
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-12 border-t border-[var(--border-subtle)] pt-6 font-terminal text-xs text-[var(--text-muted)]">
          © {new Date().getFullYear()} Tickrify. {f.rights}
        </p>

        <div className="mt-8 border-t border-[var(--border-subtle)] pt-6">
          <p className="legal-disclaimer max-w-2xl">
            {f.disclaimer}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
