// Wrapper fino de analytics (PostHog).
// Centraliza init, identify e captura de eventos para que nenhum `posthog.capture`
// cru seja espalhado pelo código. Trocar de ferramenta = mexer só aqui.
import posthog from 'posthog-js';

const KEY = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const HOST = String(import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let ready = false;

export function initAnalytics(): void {
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
  | 'founding_banner_clicked';

export function track(event: FunnelEvent, props?: Record<string, unknown>): void {
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
