import { Link } from 'react-router-dom';
import { X, Zap } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';

// Founding Trader offer — first 50 users lock the launch price forever.
// Copy per language; EN is the default for the global audience.
const COPY = {
  en: {
    text: 'Founding Trader — first 50 users lock this price forever.',
    cta: 'Claim your spot',
  },
  pt: {
    text: 'Founding Trader — os primeiros 50 usuários travam este preço para sempre.',
    cta: 'Garantir vaga',
  },
} as const;

const FoundingTraderBanner = () => {
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const copy = language === 'pt' ? COPY.pt : COPY.en;

  if (dismissed) return null;

  return (
    <div className="relative z-50 flex items-center justify-center gap-3 bg-[var(--accent-green)] px-4 py-2 text-center">
      <Zap className="hidden h-4 w-4 shrink-0 text-black sm:block" />
      <p className="text-xs font-semibold text-black sm:text-sm">
        {copy.text}{' '}
        <Link
          to="/pricing"
          onClick={() => track('founding_banner_clicked', { language })}
          className="underline underline-offset-2 hover:no-underline"
        >
          {copy.cta} →
        </Link>
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-black/60 hover:text-black"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default FoundingTraderBanner;
