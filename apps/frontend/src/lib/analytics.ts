// Wrapper fino de analytics (PostHog).
// Centraliza init, identify e captura de eventos para que nenhum `posthog.capture`
// cru seja espalhado pelo código. Trocar de ferramenta = mexer só aqui.
import posthog from 'posthog-js';

const KEY = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const HOST = String(import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let ready = false;

export function initAnalytics(): void {
  initMetaPixel();
  if (ready || !KEY) return;
  try {
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: false, // SPA: controlamos pageview manualmente via React Router
      capture_pageleave: true,
      autocapture: false, // só eventos nomeados — menos ruído, menos cota
      persistence: 'localStorage+cookie',
    });
    ready = true;
  } catch (err) {
    // Nunca deixar analytics derrubar o app.
    console.warn('[analytics] init falhou:', err);
  }
}

// ─── Meta Pixel ───────────────────────────────────────────────────────────────
// Fecha o loop Reels → site → conversão e habilita remarketing/lookalike no Meta.
// No-op silencioso se VITE_META_PIXEL_ID não estiver configurado.
const META_PIXEL_ID = String(import.meta.env.VITE_META_PIXEL_ID || '').trim();

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function initMetaPixel(): void {
  if (!META_PIXEL_ID || typeof window === 'undefined' || window.fbq) return;
  try {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) {
        fbq.callMethod(...args);
      } else {
        fbq.queue.push(args);
      }
    } as Fbq;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    window.fbq = fbq;
    if (!window._fbq) window._fbq = fbq;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);

    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
  } catch (err) {
    console.warn('[analytics] meta pixel init falhou:', err);
  }
}

// Espelha eventos-chave do funil para o Meta Pixel (nomes padrão do Meta,
// para o algoritmo de ads otimizar por conversão real).
function trackMeta(event: FunnelEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.fbq) return;
  try {
    switch (event) {
      case 'signup_completed':
        window.fbq('track', 'CompleteRegistration');
        break;
      case 'pricing_viewed':
        window.fbq('track', 'ViewContent', { content_name: 'pricing' });
        break;
      case 'checkout_started':
        window.fbq('track', 'InitiateCheckout');
        break;
      case 'subscription_activated':
        window.fbq('track', 'Purchase', {
          currency: String(props?.currency || 'USD').toUpperCase(),
          value: Number(props?.value) || 0,
        });
        break;
      case 'analysis_completed':
        window.fbq('trackCustom', 'AnalysisCompleted', {
          analysisNumber: props?.analysisNumber ?? null,
        });
        break;
      default:
        break;
    }
  } catch {
    /* noop */
  }
}

// União fechada de eventos do funil: o TypeScript impede inventar nome errado.
export type FunnelEvent =
  | 'landing_view'
  | 'demo_opened'
  | 'signup_started'
  | 'signup_completed'
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  | 'free_limit_reached'
  | 'upgrade_modal_viewed'
  | 'pricing_viewed'
  | 'upgrade_clicked'
  | 'checkout_started'
  | 'subscription_activated'
  | 'analysis_shared'
  | 'founding_banner_clicked'
  // Funil da demo anônima (/try) — Fase 0 de ativação:
  | 'demo_page_view'
  | 'demo_analysis_started'
  | 'demo_analysis_completed'
  | 'demo_after_viewed'
  | 'demo_limit_hit'
  | 'signup_from_demo';

export function track(event: FunnelEvent, props?: Record<string, unknown>): void {
  trackMeta(event, props);
  if (!ready) return;
  try {
    posthog.capture(event, props);
  } catch {
    /* noop */
  }
}

// Liga o usuário anônimo ao usuário logado (Clerk). Chamar no signup/login.
export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (!ready) return;
  try {
    posthog.identify(userId, traits);
  } catch {
    /* noop */
  }
}

// Chamar no logout para encerrar a sessão identificada.
export function resetAnalytics(): void {
  if (!ready) return;
  try {
    posthog.reset();
  } catch {
    /* noop */
  }
}

// Pageview manual para a SPA (chamado a cada mudança de rota).
export function trackPageview(path: string): void {
  if (typeof window !== 'undefined' && window.fbq) {
    try {
      window.fbq('track', 'PageView');
    } catch {
      /* noop */
    }
  }
  if (!ready) return;
  try {
    posthog.capture('$pageview', {
      $current_url: window.location.origin + path,
      path,
    });
  } catch {
    /* noop */
  }
}
