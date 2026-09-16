// Captura pageviews da SPA e dispara os eventos de funil que dependem só da rota.
// Renderizar uma vez, DENTRO do <Router> (precisa de useLocation).
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { track, trackPageview, type FunnelEvent } from '@/lib/analytics';
import { captureTechnicalAttribution } from '@/lib/attribution';

// Mapa rota → evento de funil. Prefixo casa sub-rotas do Clerk (/sign-up/*).
const ROUTE_EVENTS: Array<{ match: (p: string) => boolean; event: FunnelEvent }> = [
  { match: (p) => p === '/', event: 'landing_view' },
  { match: (p) => p === '/pricing', event: 'pricing_viewed' },
  { match: (p) => p.startsWith('/sign-up'), event: 'signup_started' },
];

export function RouteAnalytics() {
  const { pathname } = useLocation();

  useEffect(() => {
    captureTechnicalAttribution();
    trackPageview(pathname);
    const hit = ROUTE_EVENTS.find((r) => r.match(pathname));
    if (hit) track(hit.event);
  }, [pathname]);

  return null;
}
