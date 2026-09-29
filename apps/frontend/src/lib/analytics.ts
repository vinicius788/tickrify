// Wrapper fino de analytics (PostHog).
// Centraliza init, identify e captura de eventos para que nenhum `posthog.capture`
// cru seja espalhado pelo código. Trocar de ferramenta = mexer só aqui.
import type { PostHog } from 'posthog-js';

// O pacote do PostHog (~300 kB de codigo) e baixado DEPOIS da pagina carregar,
// fora do caminho critico. Todo uso abaixo passa por `ready`, que so vira true
// depois que ele chegou; ate la os eventos ficam na fila (ver enqueue/flushPending).
//
// DOIS MODOS (24/09/2026):
// - Sem aceite de cookies (recusou ou ainda nao escolheu): PostHog em modo SEM
//   COOKIES (`cookieless_mode: 'on_reject'`). Nada e gravado no navegador; a
//   identidade vira um hash diario calculado no servidor do PostHog. Conta
//   visita, pagina, origem (UTM) e pais, e nunca identifica a pessoa.
// - Com aceite: modo completo, como antes (cookie + identify no login).
// Antes o PostHog nem carregava sem aceite, e quem chegava pelo anuncio e
// ignorava o banner era invisivel: 19 cliques no Meta em 22-24/09 e zero
// visitas no PostHog. Meta Pixel e Google tag continuam SO com aceite.
//
// ⚠️ O modo sem cookies exige a opcao "Cookieless server hash mode" ligada nas
// configuracoes do projeto no PostHog; sem ela o servidor descarta esses eventos.
let posthog = undefined as unknown as PostHog;
let loading: Promise<void> | null = null;

const KEY = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const HOST = String(import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let ready = false;
/**
 * Servidor local de desenvolvimento (`vite`, localhost:5173) nao manda nada:
 * usa a mesma chave do PostHog/Meta de producao, e cada teste local virava
 * visita "real" no painel (visto em 24/09/2026, logo apos o modo sem cookies).
 * Build de producao e testes (MODE 'test') seguem normais.
 */
const TRACKING_ENABLED = import.meta.env.MODE !== 'development';
/** true = a pessoa aceitou cookies nesta sessao ou numa anterior. */
let fullConsent = false;

function loadPostHog(): Promise<void> {
  if (ready || !KEY || !TRACKING_ENABLED) return Promise.resolve();
  if (loading) return loading;
  loading = import('posthog-js')
    .then(({ default: ph }) => {
      ph.init(KEY, {
        api_host: HOST,
        capture_pageview: false, // SPA: controlamos pageview manualmente via React Router
        capture_pageleave: true,
        autocapture: false, // só eventos nomeados — menos ruído, menos cota
        persistence: 'localStorage+cookie',
        cookieless_mode: 'on_reject',
        opt_out_capturing_by_default: true,
      });
      posthog = ph;
      ready = true;
      if (fullConsent) optIn();
      flushPending();
    })
    .catch((err) => {
      // Nunca deixar analytics derrubar o app. Sem `loading`, a proxima
      // chamada tenta de novo (ex.: rede caiu no meio do download).
      console.warn('[analytics] init falhou:', err);
      loading = null;
    });
  return loading;
}

function optIn(): void {
  try {
    posthog.opt_in_capturing({ captureEventName: false });
  } catch {
    /* noop */
  }
}

/** Aceite de cookies: modo completo do PostHog + Meta Pixel + Google tag. */
export function initAnalytics(): Promise<void> {
  initMetaPixel();
  initGoogleTag();
  const wasAnonymous = !fullConsent;
  fullConsent = true;
  if (ready) {
    if (wasAnonymous) optIn();
    flushPending();
    return Promise.resolve();
  }
  return loadPostHog();
}

/** Sem aceite: so o PostHog, sem cookies. Chamado pelo main.tsx depois do `load`. */
export function initAnonymousAnalytics(): Promise<void> {
  return loadPostHog();
}

/**
 * Recusa de cookies. O PostHog segue contando sem cookies; o que sai e tudo
 * que dependia do aceite: conversoes de anuncio na fila e o identify.
 */
export function revokeAnalyticsConsent(): void {
  fullConsent = false;
  pendingIdentify = null;
  pending = pending.filter((item) => !item.adsOnly);
  if (!ready) return;
  try {
    posthog.opt_out_capturing();
  } catch {
    /* noop */
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
  if (!TRACKING_ENABLED || !META_PIXEL_ID || typeof window === 'undefined' || window.fbq) return;
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
// `eventID` = o mesmo `event_id` que o servidor manda pela Conversions API
// (meta-capi.ts no backend). O Meta junta os dois e conta um so:
//   CompleteRegistration signup_<id do Clerk> · InitiateCheckout checkout_<sessao> · Purchase purchase_<sessao>
function metaEventOptions(eventId: unknown): { eventID: string } | undefined {
  return typeof eventId === 'string' && eventId ? { eventID: eventId } : undefined;
}

function trackMeta(event: FunnelEvent | AdEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.fbq) return;
  try {
    switch (event) {
      case 'ad_signup':
        window.fbq('track', 'CompleteRegistration', {}, metaEventOptions(props?.eventId));
        break;
      case 'pricing_viewed':
        window.fbq('track', 'ViewContent', { content_name: 'pricing' });
        break;
      case 'checkout_started':
        // So existe DEPOIS que a Stripe devolveu a sessao (nunca no clique).
        window.fbq(
          'track',
          'InitiateCheckout',
          {},
          metaEventOptions(props?.sessionId ? `checkout_${String(props.sessionId)}` : undefined),
        );
        break;
      case 'ad_purchase':
        // So chamado com pagamento CONFIRMADO pelo servidor (checkout-status).
        window.fbq(
          'track',
          'Purchase',
          {
            currency: String(props?.currency || 'USD').toUpperCase(),
            value: Number(props?.value) || 0,
          },
          metaEventOptions(props?.eventId),
        );
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

/**
 * Rotulos de conversao do Google Ads (criados em 15/09/2026).
 *
 * POR QUE ISTO PRECISA EXISTIR, se os eventos `sign_up` e `purchase` abaixo
 * ja vao para o AW: **nao contam como conversao**. O Google Ads so registra
 * conversao num evento chamado literalmente `conversion` cujo `send_to` traz
 * o ROTULO da acao (`AW-<id>/<label>`). Um `sign_up` generico alimenta
 * relatorio e remarketing e some da coluna "Conversoes". Foi exatamente por
 * isso que a campanha de 14/09 rodou com "Conversoes: 0" sem nada quebrado.
 *
 * Os rotulos ficam NO CODIGO, nao em env var, de proposito. Env var ausente
 * no Vite nao e erro, e ausencia silenciosa: some do bundle e o disparo nunca
 * acontece, sem log e sem sintoma. Este projeto ja foi mordido tres vezes
 * assim (RESEND_API_KEY, ENABLE_QUICK_GROUNDING e o proprio
 * VITE_GA_TRACKING_ID, que ate hoje nao existe na Vercel). Rotulo de conversao
 * tambem nao e segredo: ele viaja no bundle publico de qualquer jeito.
 *
 * ⚠️ Se a conta de anuncios mudar, `VITE_GOOGLE_ADS_ID` E estes dois rotulos
 * precisam ser trocados JUNTOS. O guard abaixo protege o caso de esquecer:
 * rotulo de outra conta simplesmente nao dispara.
 */
const ADS_CONVERSION_LABELS = {
  signup: 'AW-18439434622/C582CKGYlvgcEP7izdhE',
  purchase: 'AW-18439434622/Bgg3CKSYlvgcEP7izdhE',
} as const;

/**
 * Dispara uma conversao do Google Ads.
 *
 * So dispara quando o rotulo pertence a MESMA conta configurada em
 * `VITE_GOOGLE_ADS_ID`. Sem isso, trocar de conta e esquecer os rotulos
 * mandaria conversao para a conta antiga, que e pior que nao mandar: o numero
 * aparece, no lugar errado, e ninguem desconfia.
 */
function trackAdsConversion(
  label: keyof typeof ADS_CONVERSION_LABELS,
  params?: { value?: number; currency?: string; transactionId?: string },
): void {
  if (!ADS_ID || typeof window === 'undefined' || !window.gtag) return;
  const sendTo = ADS_CONVERSION_LABELS[label];
  if (!sendTo.startsWith(`${ADS_ID}/`)) return;
  try {
    window.gtag('event', 'conversion', {
      send_to: sendTo,
      ...(typeof params?.value === 'number' ? { value: params.value } : {}),
      ...(params?.currency ? { currency: params.currency } : {}),
      ...(params?.transactionId ? { transaction_id: params.transactionId } : {}),
    });
  } catch {
    /* noop */
  }
}

type Gtag = ((...args: unknown[]) => void) & { q?: unknown[] };

function initGoogleTag(): void {
  if (!TRACKING_ENABLED || GOOGLE_TARGETS.length === 0 || typeof window === 'undefined' || window.gtag) return;
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
function trackGoogle(event: FunnelEvent | AdEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !window.gtag || GOOGLE_TARGETS.length === 0) return;
  try {
    switch (event) {
      case 'ad_signup':
        window.gtag('event', 'sign_up', { send_to: GOOGLE_TARGETS });
        // `sign_up` alimenta o GA4; a conversao do Ads exige o evento
        // `conversion` com o rotulo. Os dois, nao um ou outro.
        trackAdsConversion('signup');
        break;
      case 'pricing_viewed':
        window.gtag('event', 'view_item', { send_to: GOOGLE_TARGETS, item_name: 'pricing' });
        break;
      case 'checkout_started':
        window.gtag('event', 'begin_checkout', { send_to: GOOGLE_TARGETS });
        break;
      case 'ad_purchase': {
        const value = Number(props?.value) || 0;
        const currency = String(props?.currency || 'USD').toUpperCase();
        const transactionId = String(props?.transactionId ?? props?.subscriptionId ?? props?.userId ?? Date.now());
        window.gtag('event', 'purchase', {
          send_to: GOOGLE_TARGETS,
          value,
          currency,
          transaction_id: transactionId,
        });
        // Mesmo valor e mesma transacao na conversao do Ads: sem isso o painel
        // conta a assinatura mas nao sabe quanto ela vale, e o ROAS fica cego.
        trackAdsConversion('purchase', { value, currency, transactionId });
        break;
      }
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

/**
 * Conversoes que so existem para os pixels de anuncio (Meta, Google Ads). NAO
 * vao para o PostHog: la, cadastro e receita vem do BACKEND
 * (`signup_completed`, `checkout_completed`, `payment_succeeded`...). Antes o
 * navegador mandava os mesmos nomes e o PostHog contava em dobro.
 */
type AdEvent = 'ad_signup' | 'ad_purchase';

// União fechada de eventos do funil: o TypeScript impede inventar nome errado.
export type FunnelEvent =
  | 'landing_viewed'
  | 'demo_opened'
  | 'signup_started'
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  // A imagem escolhida nao pôde ser lida no aparelho (Android + Google Fotos ou
  // pasta na nuvem). A pessoa ve o aviso na tela; sem este evento, nao vemos.
  // `surface`: dashboard | try.
  | 'upload_read_failed'
  // Card de compartilhamento: `step` diz onde a pessoa parou
  // (opened | copied | downloaded | x_opened | native_shared). Sem isto não dá
  // para saber se o card é gerado e nunca postado, que é a falha mais provável.
  | 'analysis_shared'
  | 'free_limit_reached'
  | 'upgrade_modal_viewed'
  | 'pricing_viewed'
  // Secao de precos da landing entrou na tela. Era `pricing_viewed` e inflava
  // "quem foi para pricing" com quem so rolou a home.
  | 'pricing_section_viewed'
  // CTA de assinatura visto/clicado dentro do produto (contador, resultado da
  // ultima gratis, menu). `source` diz qual. O clique no BOTAO DE COMPRA em si
  // continua sendo `upgrade_clicked`.
  | 'upgrade_cta_viewed'
  | 'upgrade_cta_clicked'
  | 'upgrade_clicked'
  // Disparado quando a Stripe DEVOLVEU a URL do checkout, nao no clique.
  | 'checkout_started'
  // A criacao da sessao falhou (API fora, cold start, erro da Stripe).
  | 'checkout_failed'
  // Voltou da Stripe pelo cancel_url sem pagar.
  | 'checkout_canceled'
  // Voltou da Stripe na success_url. So UX: a confirmacao de pagamento e o
  // `checkout_completed` do backend.
  | 'checkout_success_viewed'
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
// o PostHog carregar (com ou sem cookies). Conversão de anúncio (adsOnly) fica
// na fila até o aceite e sai dela na recusa.
type Pending = { event: FunnelEvent | AdEvent | '$pageview'; props?: Record<string, unknown>; adsOnly?: boolean };

const PENDING_MAX = 20;
let pending: Pending[] = [];
let pendingIdentify: { userId: string; traits?: Record<string, unknown> } | null = null;

function enqueue(event: Pending['event'], props?: Record<string, unknown>, adsOnly = false): void {
  if (pending.length >= PENDING_MAX) return;
  pending.push({ event, props, adsOnly });
}

function flushPending(): void {
  if (!ready) return;

  applyAttributionContext();

  if (pendingIdentify && fullConsent) {
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
    // Conversão de anúncio só existe com aceite: sem ele, continua esperando.
    if (item.adsOnly && !fullConsent) {
      pending.push(item);
      continue;
    }
    // Meta Pixel e Google tag também estavam desligados quando o evento entrou na fila.
    if (item.event !== '$pageview') {
      trackMeta(item.event, item.props);
      trackGoogle(item.event, item.props);
    }
    if (item.adsOnly) continue;
    try {
      posthog.capture(item.event, item.props);
    } catch {
      /* noop */
    }
  }
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

/**
 * `signup_started` uma vez por sessao do navegador. Ele nasce em tres lugares
 * (rota /sign-up, botao do cabecalho, CTA da /try) e as sub-rotas do Clerk
 * repetiam o da rota: o mesmo cadastro contava 2 ou 3 inicios.
 */
export function trackSignupStartedOnce(source: string): void {
  const key = 'tickrify_signup_started_sent';
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, source);
  } catch {
    /* storage bloqueado: melhor contar uma vez a mais do que nenhuma */
  }
  track('signup_started', { source });
}

/** Conversao so para Meta/Google Ads (ver AdEvent). Espera o consentimento como o resto. */
export function trackAdConversion(kind: 'signup' | 'purchase', props?: Record<string, unknown>): void {
  const event: AdEvent = kind === 'signup' ? 'ad_signup' : 'ad_purchase';
  trackMeta(event, props);
  trackGoogle(event, props);
  if (!ready) enqueue(event, props, true);
}

// ─── Origem (UTM/referrer) no PostHog ────────────────────────────────────────
// O PostHog so descobre UTM sozinho na URL do primeiro pageview DEPOIS do init,
// e o init espera o aceite de cookies: quando ele liga, a SPA ja trocou de rota
// e a UTM sumiu da barra. Medido em 21/09/2026: 0 eventos com utm_source e so
// 22 de 45 cadastros com origem no perfil. Agora a origem capturada pelo
// attribution.ts vai para o PostHog de duas formas:
//   - super propriedades (`utm_source`...): todo evento carrega o ultimo toque;
//   - perfil: `first_*` com $set_once (primeiro toque) e `last_*` com $set.
export type AttributionTouch = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  clickId?: string;
  referrerDomain?: string;
  landingPath?: string;
};
let attributionContext: { first: AttributionTouch | null; last: AttributionTouch | null } | null = null;

function touchProps(touch: AttributionTouch | null, prefix: string): Record<string, string> {
  if (!touch) return {};
  const map: Array<[keyof AttributionTouch, string]> = [
    ['utmSource', 'utm_source'],
    ['utmMedium', 'utm_medium'],
    ['utmCampaign', 'utm_campaign'],
    ['utmContent', 'utm_content'],
    ['utmTerm', 'utm_term'],
    ['clickId', 'click_id'],
    ['referrerDomain', 'referrer_domain'],
    ['landingPath', 'landing_path'],
  ];
  const out: Record<string, string> = {};
  for (const [key, name] of map) {
    const value = touch[key];
    if (value) out[`${prefix}${name}`] = value;
  }
  return out;
}

function applyAttributionContext(): void {
  if (!ready || !attributionContext) return;
  const { first, last } = attributionContext;
  try {
    const current = touchProps(last ?? first, '');
    // Sem aceite: origem sim (UTM, referrer), identificador de clique nao.
    if (!fullConsent) delete current.click_id;
    if (Object.keys(current).length > 0) posthog.register(current);
    if (fullConsent) {
      posthog.setPersonProperties(touchProps(last, 'last_'), touchProps(first ?? last, 'first_'));
    }
  } catch {
    /* noop */
  }
}

export function setAttributionContext(first: AttributionTouch | null, last: AttributionTouch | null): void {
  if (!first && !last) return;
  attributionContext = { first, last };
  applyAttributionContext();
}

// Liga o usuário anônimo ao usuário logado (Clerk). Chamar no signup/login.

export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (!ready || !fullConsent) {
    // Sem isto, quem já estava logado quando aceitou os cookies ficava anônimo
    // para sempre: o efeito que chama esta função não roda de novo. Sem aceite
    // o identify espera: o modo sem cookies nunca liga visita a pessoa.
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
