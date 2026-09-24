// Consentimento de cookies não essenciais (24/08/2026).
//
// POR QUE ISTO EXISTE
// O site carrega PostHog (persistence: 'localStorage+cookie') e o Meta Pixel.
// Nenhum dos dois é essencial para o produto funcionar, e o público-alvo é
// EUA/UK/UE — ou seja, GDPR e ePrivacy se aplicam, e as duas exigem
// consentimento ANTES de gravar. Até aqui o `initAnalytics()` rodava no
// main.tsx, sem perguntar nada.
//
// Como funciona: sem escolha registrada o banner aparece, e até o aceite só
// roda a contagem anônima do PostHog SEM cookies (24/09/2026, ver
// lib/analytics.ts). Depois da escolha, ela vale para sempre naquele navegador.
//
// A escolha mora no localStorage e não num cookie de propósito: gravar um
// cookie para decidir se pode gravar cookie é exatamente o que a regra evita.

export type ConsentValue = 'granted' | 'denied';

const KEY = 'tickrify_cookie_consent';

/** `null` = ainda não escolheu, e é o único estado em que o banner aparece. */
export function getConsent(): ConsentValue | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'granted' || raw === 'denied' ? raw : null;
  } catch {
    // Navegador com storage bloqueado: trata como "não consentiu".
    return null;
  }
}

export function setConsent(value: ConsentValue): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
}

/** Usado pelo botão "mudar minha escolha" na política de cookies. */
export function resetConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
}

/** O banner e a página de cookies escutam isto para se redesenharem juntos. */
export const CONSENT_EVENT = 'tickrify:consent-changed';
