// Captura pageviews da SPA e dispara os eventos de funil que dependem só da rota.
// Renderizar uma vez, DENTRO do <Router> (precisa de useLocation).
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { setAttributionContext, track, trackPageview, trackSignupStartedOnce } from '@/lib/analytics';
import { captureReferral, captureTechnicalAttribution, getAttributionTouches } from '@/lib/attribution';

export function RouteAnalytics() {
  const { pathname } = useLocation();
  // Rota anterior dentro da SPA: diz de onde a pessoa chegou na /pricing
  // (painel, landing, blog...). Sem isto "quem foi para pricing" nao tinha origem.
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    captureTechnicalAttribution();
    captureReferral(pathname);
    const { first, last } = getAttributionTouches();
    setAttributionContext(first, last);
    trackPageview(pathname);

    if (pathname === '/') {
      track('landing_viewed');
    } else if (pathname === '/pricing') {
      track('pricing_viewed', { from: previousPath.current ?? 'direct_or_external' });
    } else if (pathname.startsWith('/sign-up')) {
      // /sign-up/verify-email-address e outras sub-rotas do Clerk trocam o
      // pathname: sem o "uma vez", um cadastro contava 2 ou 3 inicios.
      trackSignupStartedOnce('signup_route');
    }

    previousPath.current = pathname;
  }, [pathname]);

  return null;
}
