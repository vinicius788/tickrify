// Cloudflare Turnstile (anti-bot invisível) para a demo anônima.
// Sem VITE_TURNSTILE_SITE_KEY configurada, tudo vira no-op (retorna null) —
// o backend falha fechado: sem chave configurada, a demo fica indisponível.

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
      'before-interactive-callback'?: () => void;
      'after-interactive-callback'?: () => void;
      size?: 'normal' | 'compact' | 'flexible';
      appearance?: 'always' | 'execute' | 'interaction-only';
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

/**
 * O widget vive fora da tela enquanto o desafio e resolvido em silencio, que e
 * o caso da maioria esmagadora dos visitantes.
 *
 * O que NAO da pra fazer: esconder com `z-index: -1`, como estava aqui ate
 * 03/09/2026. Quando a Cloudflare decide que precisa de interacao humana —
 * VPN, navegador com privacidade reforçada, rede corporativa, IP com
 * reputacao ruim — o desafio renderiza ATRAS da pagina. A pessoa nao ve, nao
 * tem como clicar, o callback nunca resolve, e ela recebe "Human verification
 * failed. Refresh the page and try again." num loop sem saida. Na pagina de
 * maior conversao do funil.
 *
 * Por isso o container comeca invisivel de verdade (sem area, sem eventos) e
 * so vira sobreposicao clicavel no `before-interactive-callback`.
 */
const HIDDEN_STYLE =
  'position:fixed;bottom:0;right:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';

const CHALLENGE_STYLE =
  'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
  'background:rgba(5,5,8,0.82);z-index:2147483647;';

let scriptPromise: Promise<TurnstileApi | null> | null = null;

/**
 * Por que a ultima tentativa terminou como terminou (11/11/2026). O servidor so
 * responde `bot_check_failed`: sem isto nao da para saber se o token nem
 * existiu (script bloqueado, desafio sem resposta) ou se a Cloudflare recusou.
 */
export type TurnstileOutcome =
  | 'ok'
  | 'not_configured'
  | 'script_blocked'
  | 'render_error'
  | 'widget_error'
  | 'expired'
  | 'timeout'
  | 'timeout_interactive';
let lastOutcome: TurnstileOutcome = 'not_configured';
export const getTurnstileOutcome = (): TurnstileOutcome => lastOutcome;

/** Desafio silencioso: 20 s. Com o desafio na tela, a pessoa tem ate 90 s para resolver. */
const SILENT_TIMEOUT_MS = 20_000;
const INTERACTIVE_TIMEOUT_MS = 90_000;

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
  if (!api) {
    lastOutcome = SITE_KEY ? 'script_blocked' : 'not_configured';
    return null;
  }

  return new Promise((resolve) => {
    // Fora da tela enquanto o desafio e silencioso, sobreposto e clicavel
    // quando ele escala. Ver HIDDEN_STYLE/CHALLENGE_STYLE acima.
    const container = document.createElement('div');
    container.style.cssText = HIDDEN_STYLE;
    document.body.appendChild(container);

    let settled = false;
    let widgetId: string | null = null;
    let interactive = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (token: string | null, outcome: TurnstileOutcome) => {
      if (settled) return;
      settled = true;
      lastOutcome = outcome;
      clearTimeout(timer);
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
        // 'invisible' NAO e um valor valido de `size` — a Cloudflare aceita
        // apenas 'normal' | 'compact' | 'flexible' e lanca TurnstileError com
        // qualquer outro, o que fazia o render() estourar e o token vir null.
        // O comportamento invisivel vem de `appearance`, nao de `size`.
        appearance: 'interaction-only',
        execution: 'render',
        callback: (token) => finish(token, 'ok'),
        'error-callback': () => finish(null, 'widget_error'),
        'expired-callback': () => finish(null, 'expired'),
        // A Cloudflare so chama isto quando decide que o desafio silencioso nao
        // basta e precisa da pessoa. E o unico momento em que o widget PRECISA
        // estar visivel.
        'before-interactive-callback': () => {
          container.style.cssText = CHALLENGE_STYLE;
          // O desafio apareceu: nao tirar da tela aos 20 s com a pessoa resolvendo.
          interactive = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish(null, 'timeout_interactive'), INTERACTIVE_TIMEOUT_MS);
        },
        'after-interactive-callback': () => {
          container.style.cssText = HIDDEN_STYLE;
        },
      });
    } catch {
      finish(null, 'render_error');
      return;
    }

    if (!interactive) timer = setTimeout(() => finish(null, 'timeout'), SILENT_TIMEOUT_MS);
  });
}
