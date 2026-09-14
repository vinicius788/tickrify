// Wrapper fino de analytics (PostHog).
// Centraliza init, identify e captura de eventos para que nenhum `posthog.capture`
// cru seja espalhado pelo código. Trocar de ferramenta = mexer só aqui.
import posthog from 'posthog-js';

const KEY = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const HOST = String(import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let ready = false;

export function initAnalytics(): void {
  initMetaPixel();
  initGoogleTag();
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
    flushPending();
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
    dataLayer?: unknown[];
    gtag?: Gtag;
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

// ─── Google tag (GA4) ──────────────────────────────────────────────────────
// Mede o funil pro lado Google (canal de origem: orgânico, Instagram, direto...
// dado que o PostHog não separa bem). No-op silencioso se VITE_GA_TRACKING_ID
// não estiver configurado — sobe sem medo.
const GA_ID = String(import.meta.env.VITE_GA_TRACKING_ID || '').trim();
// Google Ads (AW-...) roda na MESMA gtag.js do GA4: um unico <script>, um
// `config` por id. E o que habilita remarketing e atribuicao das campanhas
// de Search. No-op silencioso se VITE_GOOGLE_ADS_ID nao estiver configurado.
const ADS_ID = String(import.meta.env.VITE_GOOGLE_ADS_ID || '').trim();
// Alvos ativos do gtag. Eventos vao para os dois ids quando ambos existem.
const GOOGLE_TARGETS: string[] = [GA_ID, ADS_ID].filter(Boolean);

type Gtag = ((...args: unknown[]) => void) & { q?: unknown[] };

function initGoogleTag(): void {
  if (GOOGLE_TARGETS.length === 0 || typeof window === 'undefined' || window.gtag) return;
  try {
    window.dataLayer = window.dataLayer || [];
    const dataLayer = window.dataLayer;
    const gtag: Gtag = (...args: unknown[]) => {
      dataLayer.push(args);
    };
    window.gtag = gtag;
    gtag('js', new Date());

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TARGETS[0]}`;
    document.head.appendChild(script);

    // SPA: pageview manual via React Router, igual PostHog/Meta — nunca o
    // send_page_view automático do gtag (double counting).
    for (const id of GOOGLE_TARGETS) {
      gtag('config', id, { send_page_view: false });
    }
  } catch (err) {
    console.warn('[analytics] google tag init falhou:', err);
  }
}

// Espelha eventos-chave do funil pro GA4 (nomenclatura recomendada do Google:
// sign_up, begin_checkout, purchase...).
function trackGoogle(event: FunnelEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.gtag || GOOGLE_TARGETS.length === 0) return;
  try {
    switch (event) {
      case 'signup_completed':
        window.gtag('event', 'sign_up', { send_to: GOOGLE_TARGETS });
        break;
      case 'pricing_viewed':
        window.gtag('event', 'view_item', { send_to: GOOGLE_TARGETS, item_name: 'pricing' });
        break;
      case 'checkout_started':
        window.gtag('event', 'begin_checkout', { send_to: GOOGLE_TARGETS });
        break;
      case 'subscription_activated':
        window.gtag('event', 'purchase', {
          send_to: GOOGLE_TARGETS,
          value: Number(props?.value) || 0,
          currency: String(props?.currency || 'USD').toUpperCase(),
          transaction_id: String(props?.subscriptionId ?? props?.userId ?? Date.now()),
        });
        break;
      case 'analysis_completed':
        window.gtag('event', 'analysis_completed', {
          send_to: GOOGLE_TARGETS,
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
  // Card de compartilhamento: `step` diz onde a pessoa parou
  // (opened | copied | downloaded | x_opened | native_shared). Sem isto não dá
  // para saber se o card é gerado e nunca postado, que é a falha mais provável.
  | 'analysis_shared'
  | 'free_limit_reached'
  | 'upgrade_modal_viewed'
  | 'pricing_viewed'
  | 'upgrade_clicked'
  | 'checkout_started'
  | 'subscription_activated'
  | 'founding_banner_clicked'
  // Funil da demo anônima (/try) — Fase 0 de ativação:
  | 'demo_page_view'
  | 'demo_analysis_started'
  | 'demo_analysis_completed'
  | 'demo_after_viewed'
  | 'demo_limit_hit'
  | 'signup_from_demo';

// ─── Fila de pré-consentimento ────────────────────────────────────────────────
// O banner de cookies só é respondido DEPOIS que a rota já montou, e a rota que
// monta é justamente a que dispara `landing_view` / `demo_page_view`. Sem esta
// fila, o primeiro evento de todo visitante era descartado em silêncio e quem
// chegava, usava a demo e saía não gerava evento nenhum. Agora o evento espera
// a escolha: aceitar despeja a fila, recusar joga fora.
type Pending = { event: FunnelEvent | '$pageview'; props?: Record<string, unknown> };

const PENDING_MAX = 20;
let pending: Pending[] = [];
let pendingIdentify: { userId: string; traits?: Record<string, unknown> } | null = null;

function enqueue(event: Pending['event'], props?: Record<string, unknown>): void {
  if (pending.length >= PENDING_MAX) return;
  pending.push({ event, props });
}

function flushPending(): void {
  if (!ready) return;

  if (pendingIdentify) {
    const id = pendingIdentify;
    pendingIdentify = null;
    try {
      posthog.identify(id.userId, id.traits);
    } catch {
      /* noop */
    }
  }

  const queued = pending;
  pending = [];
  for (const item of queued) {
    // Meta Pixel e Google tag também estavam desligados quando o evento entrou na fila.
    if (item.event !== '$pageview') {
      trackMeta(item.event, item.props);
      trackGoogle(item.event, item.props);
    }
    try {
      posthog.capture(item.event, item.props);
    } catch {
      /* noop */
    }
  }
}

/** Recusa de cookies: o que estava na fila nunca vai ser enviado. */
export function discardPendingAnalytics(): void {
  pending = [];
  pendingIdentify = null;
}

export function track(event: FunnelEvent, props?: Record<string, unknown>): void {
  trackMeta(event, props);
  trackGoogle(event, props);
  if (!ready) {
    enqueue(event, props);
    return;
  }
  try {
    posthog.capture(event, props);
  } catch {
    /* noop */
  }
}

// Liga o usuário anônimo ao usuário logado (Clerk). Chamar no signup/login.
export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (!ready) {
    // Sem isto, quem já estava logado quando aceitou os cookies ficava anônimo
    // para sempre: o efeito que chama esta função não roda de novo.
    pendingIdentify = { userId, traits };
    return;
  }
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
  if (typeof window !== 'undefined' && window.gtag && GOOGLE_TARGETS.length > 0) {
    try {
      window.gtag('event', 'page_view', {
        send_to: GOOGLE_TARGETS,
        page_location: window.location.origin + path,
        page_path: path,
      });
    } catch {
      /* noop */
    }
  }
  const props = { $current_url: window.location.origin + path, path };
  if (!ready) {
    enqueue('$pageview', props);
    return;
  }
  try {
    posthog.capture('$pageview', props);
  } catch {
    /* noop */
  }
}
