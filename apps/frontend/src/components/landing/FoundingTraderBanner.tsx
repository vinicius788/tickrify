import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { interpolate } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { useFoundingOffer } from '@/hooks/useFoundingOffer';

// Faixa da oferta de lancamento (EARLY35). Diz a oferta REAL: X% no primeiro
// mes do plano mensal, aplicado no checkout. Ate 05/10/2026 dizia que os
// primeiros assinantes "travam o preco de US$ 29/mes": US$ 29 ja e o preco
// normal e nada no codigo garante essa trava, entao a frase nao dizia nada e
// prometia o que nao existe. Sem numero de vagas: pagamento recusado tambem
// consome um uso do cupom na Stripe, entao "os primeiros 50" nao e garantido.


const FoundingTraderBanner = () => {
  const { language, t } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  const copy = t.foundingBanner;
  // Sem cupom ativo na Stripe a oferta acabou: a faixa some junto.
  const offer = useFoundingOffer();

  if (dismissed || !offer?.percentOff) return null;

  return (
    <div className="site-banner">
      <div className="site-wrap">
        <p>
          {interpolate(copy.text, { pct: offer.percentOff, code: offer.code })}{' '}
          <Link to="/pricing" onClick={() => track('founding_banner_clicked', { language })}>
            {copy.cta}
          </Link>
        </p>
        <button type="button" aria-label={t.common.close} onClick={() => setDismissed(true)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default FoundingTraderBanner;
