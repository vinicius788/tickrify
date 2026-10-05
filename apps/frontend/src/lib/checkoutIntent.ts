// Intencao de compra que sobrevive ao login/cadastro.
//
// Antes, o Upgrade deslogado ia para /sign-in sem redirect e o Clerk devolvia
// todo mundo em /dashboard. O plano ficava num sessionStorage que so a /pricing
// lia, entao a compra morria no meio do caminho; ciclo (mensal/anual) e origem
// nem eram guardados.
//
// Agora a intencao viaja de dois jeitos:
// 1. na URL: /sign-in?redirect_url=/dashboard/plans?checkout=starter&cycle=monthly&source=pricing
//    O Clerk respeita `redirect_url` no login, no cadastro e na troca entre os dois.
// 2. no localStorage, por 30 min, como rede para os caminhos que nao carregam a
//    URL (One Tap, verificacao de e-mail aberta em outra aba no celular).
//
// SEGURANCA: nunca se redireciona para um valor vindo de fora. Tudo passa por
// `parseCheckoutIntent`, que aceita so valores de lista fechada, e o destino e
// sempre REMONTADO por `checkoutReturnPath`, um caminho interno fixo.

import type { BillingCycle, PlanType } from './stripe';

export type CheckoutSource = 'pricing' | 'locked_value';

export type CheckoutIntent = {
  plan: PlanType;
  cycle: BillingCycle;
  source: CheckoutSource;
};

// So o plano vendido na vitrine. `pro`/`elite` sao legado: aceitar aqui
// deixaria uma URL montada a mao vender o plano de 150 ticks.
const PLANS: readonly PlanType[] = ['starter'];
const CYCLES: readonly BillingCycle[] = ['monthly', 'yearly', 'weekly'];
const SOURCES: readonly CheckoutSource[] = ['pricing', 'locked_value'];

const STORAGE_KEY = 'tickrify_checkout_intent';
export const CHECKOUT_INTENT_TTL_MS = 30 * 60 * 1000;
// Logado, a compra continua DENTRO do painel (05/10/2026): os Planos do painel
// usam os mesmos cards da /pricing e retomam o checkout sozinhos. A /pricing
// segue aceita na volta do login porque links de login abertos antes da troca
// ainda a carregam.
const RETURN_PATH = '/dashboard/plans';
const LEGACY_RETURN_PATH = '/pricing';

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function validate(plan: unknown, cycle: unknown, source: unknown): CheckoutIntent | null {
  if (!isOneOf(PLANS, plan)) return null;
  return {
    plan,
    cycle: isOneOf(CYCLES, cycle) ? cycle : 'monthly',
    source: isOneOf(SOURCES, source) ? source : 'pricing',
  };
}

/** Le a intencao dos parametros `checkout`, `cycle` e `source` da URL. */
export function parseCheckoutIntent(search: string): CheckoutIntent | null {
  const params = new URLSearchParams(search);
  return validate(params.get('checkout'), params.get('cycle'), params.get('source'));
}

/** Caminho interno para onde o login devolve a pessoa. */
export function checkoutReturnPath(intent: CheckoutIntent): string {
  const params = new URLSearchParams({
    checkout: intent.plan,
    cycle: intent.cycle,
    source: intent.source,
  });
  return `${RETURN_PATH}?${params.toString()}`;
}

/** URL de login que, depois de autenticar, volta direto para o checkout. */
export function authUrlForCheckout(intent: CheckoutIntent, mode: 'sign-in' | 'sign-up' = 'sign-in'): string {
  return `/${mode}?redirect_url=${encodeURIComponent(checkoutReturnPath(intent))}`;
}

/**
 * Destino seguro a partir do `redirect_url` da pagina de login atual.
 * Devolve `null` para qualquer coisa que nao seja uma intencao de checkout
 * valida neste mesmo site.
 *
 * O Clerk carrega o `redirect_url` na QUERY no /sign-in, mas ao trocar para o
 * cadastro ele vai no HASH, e absoluto: `/sign-up#/?redirect_url=https://...`
 * (visto em producao em 21/09/2026). Os dois lugares sao lidos.
 */
export function checkoutTargetFromAuthSearch(search: string, origin: string, hash = ''): string | null {
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const raw =
    new URLSearchParams(search).get('redirect_url') ?? new URLSearchParams(hashQuery).get('redirect_url');
  if (!raw) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || (url.pathname !== RETURN_PATH && url.pathname !== LEGACY_RETURN_PATH)) return null;
    const intent = parseCheckoutIntent(url.search);
    return intent ? checkoutReturnPath(intent) : null;
  } catch {
    return null;
  }
}

export function saveCheckoutIntent(intent: CheckoutIntent, now = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...intent, savedAt: now }));
  } catch {
    /* modo privado ou storage bloqueado: a URL continua carregando a intencao */
  }
}

export function loadCheckoutIntent(now = Date.now()): CheckoutIntent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutIntent> & { savedAt?: number };
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > CHECKOUT_INTENT_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return validate(parsed.plan, parsed.cycle, parsed.source);
  } catch {
    return null;
  }
}

export function clearCheckoutIntent(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
