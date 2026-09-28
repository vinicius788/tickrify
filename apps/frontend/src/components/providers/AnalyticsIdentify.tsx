// Liga a identidade do Clerk ao PostHog, sincroniza a origem com o backend e
// dispara a conversao de cadastro para os pixels de anuncio.
// Renderizar uma vez, dentro do <ClerkProvider>.
//
// `signup_completed` NAO sai daqui desde 21/09/2026: o backend emite no momento
// em que cria o usuario (auth.guard), um por conta. O daqui dependia de "conta
// com menos de 60s" e do aceite de cookies, e divergia do real.
import { useEffect, useRef } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { identifyUser, resetAnalytics, track, trackAdConversion } from '@/lib/analytics';
import {
  claimReferral,
  getAdsPayload,
  getAttributionTouches,
  getTechnicalAttributionPayload,
  markTechnicalAttributionSynced,
} from '@/lib/attribution';
import { apiClient } from '@/lib/api';

// Janela para considerar a conta "recem-criada" do ponto de vista do navegador.
// Larga de proposito (verificacao de e-mail pode levar minutos); o que impede
// contar duas vezes e a marca por usuario no localStorage, nao a janela.
const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

export function AnalyticsIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const attributionSynced = useRef(false);
  const wasSignedIn = useRef(false);

  // Logout: encerra a identidade no PostHog. Sem isto, a proxima pessoa no
  // mesmo navegador herdava o perfil da anterior (resetAnalytics existia e
  // nunca era chamado).
  useEffect(() => {
    if (!isLoaded) return;
    if (wasSignedIn.current && !isSignedIn) {
      resetAnalytics();
      attributionSynced.current = false;
    }
    wasSignedIn.current = Boolean(isSignedIn);
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    identifyUser(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      createdAt: user.createdAt,
    });

    if (!attributionSynced.current) {
      attributionSynced.current = true;
      // O backend guarda o primeiro toque so se ainda nao tiver um. Antes ia
      // so o ULTIMO toque, e ele virava "primeiro" no banco. Agora vai o
      // primeiro e, se for diferente, o ultimo.
      const { first } = getAttributionTouches();
      const last = getTechnicalAttributionPayload();
      const payloads = [first, last].filter(
        (item, index, all): item is NonNullable<typeof item> =>
          Boolean(item) && (index === 0 || JSON.stringify(item) !== JSON.stringify(all[0])),
      );
      if (payloads.length > 0) {
        void getToken({ skipCache: true })
          .then(async (token) => {
            if (!token) return;
            for (const payload of payloads) {
              await apiClient.setTechnicalAttribution(payload, token);
            }
          })
          .then(() => markTechnicalAttributionSynced())
          .catch(() => {
            attributionSynced.current = false;
          });
      }
    }

    // Afiliado: liga a conta ao link/cupom de parceiro guardado neste navegador.
    // O servidor confere a janela de 30 dias, o self-referral e se ja pagou.
    void getToken()
      .then((token) => (token ? claimReferral(user.id, token) : undefined))
      .catch(() => undefined);

    // Conversao de cadastro para Meta/Google Ads: uma vez por conta, neste navegador.
    if (user.createdAt) {
      const ageMs = Date.now() - new Date(user.createdAt).getTime();
      const markKey = `tickrify_signup_conversion_${user.id}`;
      let alreadySent = false;
      try {
        alreadySent = Boolean(localStorage.getItem(markKey));
      } catch {
        /* noop */
      }
      if (!alreadySent && ageMs >= 0 && ageMs < NEW_ACCOUNT_WINDOW_MS) {
        try {
          localStorage.setItem(markKey, String(Date.now()));
        } catch {
          /* noop */
        }
        // Mesmo event_id do servidor (signup_<id do Clerk>): o Meta conta um so.
        trackAdConversion('signup', { eventId: `signup_${user.id}` });
        // Servidor manda o mesmo evento pela Conversions API (com IP/UA/fbp/fbc
        // da propria requisicao). So com aceite: sem ele o payload diz que nao.
        const ads = getAdsPayload();
        if (ads.adsConsent) {
          void getToken({ skipCache: true })
            .then((token) => (token ? apiClient.sendAdsSignup(ads, token) : undefined))
            .catch(() => undefined);
        }

        // Funil da demo (/try): se o cadastro veio de lá, fecha o loop.
        // A flag é marcada no clique do CTA da demo e vale por 24h.
        try {
          const demoTouch = Number(localStorage.getItem('tickrify_demo_source') || 0);
          if (demoTouch > 0 && Date.now() - demoTouch < 24 * 60 * 60 * 1000) {
            track('signup_from_demo');
            localStorage.removeItem('tickrify_demo_source');
          }
        } catch {
          /* noop */
        }
      }
    }
  }, [getToken, isLoaded, isSignedIn, user]);

  return null;
}
