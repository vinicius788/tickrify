import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { initAnalytics } from '@/lib/analytics';
import { CONSENT_EVENT, getConsent, setConsent } from '@/lib/consent';

/**
 * Banner de consentimento, montado uma vez para o app inteiro (App.tsx).
 *
 * Só aparece para quem ainda não escolheu. Aceitar liga o PostHog e o Meta
 * Pixel na hora, sem recarregar a página; recusar deixa os dois desligados
 * naquele navegador. Ver lib/consent.ts para o porquê.
 *
 * Recusar é um botão de verdade, do mesmo tamanho do aceitar: banner que
 * esconde a recusa não vale como consentimento.
 */
const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sync = () => setVisible(getConsent() === null);
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    return () => window.removeEventListener(CONSENT_EVENT, sync);
  }, []);

  const choose = useCallback((value: 'granted' | 'denied') => {
    setConsent(value);
    if (value === 'granted') initAnalytics();
  }, []);

  if (!visible) return null;

  return (
    <div className="tk-site site-cookie" role="dialog" aria-label="Cookies">
      <p>
        We use cookies that are needed to sign you in and take payment. With your permission we also
        use analytics and marketing cookies to see which pages actually work. You can change this
        later on the <Link to="/cookies">cookie policy</Link> page.
      </p>
      <div className="site-cookie-actions">
        <button type="button" className="site-btn site-btn-primary site-btn-sm" onClick={() => choose('granted')}>
          Accept all
        </button>
        <button type="button" className="site-btn site-btn-ghost site-btn-sm" onClick={() => choose('denied')}>
          Essential only
        </button>
      </div>
    </div>
  );
};

export default CookieConsent;
