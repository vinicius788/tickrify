import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';

// Founding Trader: os primeiros 50 travam o preço de lançamento.
// Era uma faixa verde neon com texto preto, a primeira coisa que a página
// gritava. Agora é uma linha discreta: a oferta continua lá, sem berrar.
const COPY = {
  en: { text: 'Founding Trader: the first 50 users lock this price forever.', cta: 'Claim your spot' },
  pt: { text: 'Founding Trader: os primeiros 50 usuários travam este preço para sempre.', cta: 'Garantir vaga' },
} as const;

const FoundingTraderBanner = () => {
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const copy = language === 'pt' ? COPY.pt : COPY.en;
  // Sem cupom ativo na Stripe a oferta acabou: a faixa some junto.
  const offer = useFoundingOffer();

  if (dismissed || !offer) return null;

  return (
    <div className="site-banner">
      <div className="site-wrap">
        <p>
          {copy.text}{' '}
          <Link to="/pricing" onClick={() => track('founding_banner_clicked', { language })}>
            {copy.cta}
          </Link>
        </p>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default FoundingTraderBanner;
