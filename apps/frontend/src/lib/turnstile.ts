// Cloudflare Turnstile (anti-bot invisível) para a demo anônima.
// Sem VITE_TURNSTILE_SITE_KEY configurada, tudo vira no-op (retorna null) —
// o backend também só exige o token quando TURNSTILE_SECRET_KEY existe lá.

const SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      size?: 'normal' | 'compact' | 'invisible';
      execution?: 'render' | 'execute';
    },
  ) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function isTurnstileEnabled(): boolean {
  return SITE_KEY.length > 0;
}

let scriptPromise: Promise<TurnstileApi | null> | null = null;

function loadScript(): Promise<TurnstileApi | null> {
  if (!SITE_KEY) return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
    // Nunca deixar o anti-bot travar a demo pra sempre.
    setTimeout(() => resolve(window.turnstile ?? null), 12_000);
  });
  return scriptPromise;
}

/**
 * Obtém um token do desafio invisível. Resolve null se o Turnstile não estiver
 * configurado ou falhar ao carregar (o servidor decide se isso bloqueia).
 */
export async function getTurnstileToken(): Promise<string | null> {
  const api = await loadScript();
  if (!api) return null;

  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '0';
    container.style.right = '0';
    container.style.zIndex = '-1';
    document.body.appendChild(container);

    let settled = false;
    let widgetId: string | null = null;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      try {
        if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      } catch {
        /* noop */
      }
      container.remove();
      resolve(token);
    };

    try {
      widgetId = api.render(container, {
        sitekey: SITE_KEY,
        size: 'invisible',
        execution: 'render',
        callback: (token) => finish(token),
        'error-callback': () => finish(null),
        'expired-callback': () => finish(null),
      });
    } catch {
      finish(null);
      return;
    }

    setTimeout(() => finish(null), 20_000);
  });
}
