import { Instagram, Linkedin } from 'lucide-react';
import TermsOfServiceDialog from '@/components/landing/TermsOfServiceDialog';

const XBrandIcon = ({ className = 'h-5 w-5' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M18.901 1.153h3.68l-8.04 9.19 9.456 12.504h-7.403l-5.793-7.57-6.63 7.57H.49l8.6-9.83L0 1.154h7.595l5.243 6.932 6.063-6.933Zm-1.29 19.512h2.04L6.486 3.258H4.298l13.313 17.407Z" />
  </svg>
);

const Footer = () => {
  return (
    <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="container py-12">
        <div className="grid gap-8 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/icon.png" alt="Tickrify" className="h-8 w-8" />
              <span className="font-display text-3xl font-semibold uppercase tracking-wide text-[var(--text-primary)]">
                Tickrify
              </span>
            </a>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">Análise técnica institucional com IA</p>

            <div className="mt-5 flex items-center gap-3 text-[var(--text-secondary)]">
              <a href="https://x.com/tickrify" target="_blank" rel="noreferrer" aria-label="X" className="transition-colors hover:text-[var(--text-primary)]">
                <XBrandIcon />
              </a>
              <a href="https://instagram.com/tickrify" target="_blank" rel="noreferrer" aria-label="Instagram" className="transition-colors hover:text-[var(--text-primary)]">
                <Instagram className="h-5 w-5" />
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="Linkedin" className="transition-colors hover:text-[var(--text-primary)]">
                <Linkedin className="h-5 w-5" />
              </a>
            </div>

          </div>

          <div>
            <h4 className="font-semibold text-[var(--text-primary)]">Plataforma</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
              <li><a href="#recursos" className="transition-colors hover:text-[var(--text-primary)]">Recursos</a></li>
              <li><a href="#preview-dashboard" className="transition-colors hover:text-[var(--text-primary)]">Painel</a></li>
              <li><a href="#planos" className="transition-colors hover:text-[var(--text-primary)]">Planos</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-[var(--text-primary)]">Empresa</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
              <li><a href="#faq" className="transition-colors hover:text-[var(--text-primary)]">FAQ</a></li>
              <li><TermsOfServiceDialog /></li>
            </ul>
          </div>
        </div>

        <p className="mt-10 border-t border-[var(--border-subtle)] pt-5 font-terminal text-xs text-[var(--text-muted)]">
          © {new Date().getFullYear()} Tickrify. Todos os direitos reservados.
        </p>

        <div className="mt-8 border-t pt-6" style={{ borderColor: '#1E2230' }}>
          <p className="max-w-2xl font-terminal text-xs leading-relaxed text-[var(--text-muted)]">
            ⚠️ As análises geradas pela Tickrify são produzidas por inteligência artificial com base em análise
            técnica visual. Não constituem recomendação de investimento. Resultados passados não garantem resultados
            futuros. Opere com responsabilidade e gestão de risco adequada.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
