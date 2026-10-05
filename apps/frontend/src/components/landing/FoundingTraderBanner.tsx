import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';

// Faixa da oferta de lancamento (EARLY35). Diz a oferta REAL: X% no primeiro
// mes do plano mensal, aplicado no checkout. Ate 05/10/2026 dizia que os
// primeiros assinantes "travam o preco de US$ 29/mes": US$ 29 ja e o preco
// normal e nada no codigo garante essa trava, entao a frase nao dizia nada e
// prometia o que nao existe. Sem numero de vagas: pagamento recusado tambem
// consome um uso do cupom na Stripe, entao "os primeiros 50" nao e garantido.
const COPY = {
  en: {
    text: (pct: number, code: string) =>
      `Early subscriber offer: ${pct}% off your first month on the monthly plan with ${code}, applied at checkout. Then $29/month.`,
    cta: 'See plans',
  },
  pt: {
    text: (pct: number, code: string) =>
      `Oferta para os primeiros assinantes: ${pct}% off no primeiro mês do plano mensal com ${code}, aplicado no checkout. Depois US$ 29/mês.`,
    cta: 'Ver planos',
  },
} as const;

const FoundingTraderBanner = () => {
  const { language } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const copy = language === 'pt' ? COPY.pt : COPY.en;
  // Sem cupom ativo na Stripe a oferta acabou: a faixa some junto.
  const offer = useFoundingOffer();

  if (dismissed || !offer?.percentOff) return null;

  return (
    <div className="site-banner">
      <div className="site-wrap">
        <p>
          {copy.text(offer.percentOff, offer.code)}{' '}
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
