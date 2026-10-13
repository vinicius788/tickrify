import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Converte um valor desconhecido para Record se for um objeto plano, ou retorna {}. */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Roda `fn(true)` depois que o navegador pintar o proximo quadro (dois
 * requestAnimationFrame: o primeiro cai antes da pintura, o segundo depois).
 * Aba em segundo plano nao pinta: se o quadro nao vier em `maxWaitMs`, roda
 * `fn(false)` mesmo assim, uma vez so. Quem mede nunca perde o evento.
 */
export function afterNextPaint(fn: (painted: boolean) => void, maxWaitMs = 1000): void {
  let done = false;
  const run = (painted: boolean) => {
    if (done) return;
    done = true;
    fn(painted);
  };
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (hidden || typeof requestAnimationFrame !== 'function') {
    setTimeout(() => run(false), 0);
    return;
  }
  setTimeout(() => run(false), maxWaitMs);
  requestAnimationFrame(() => requestAnimationFrame(() => run(true)));
}

/**
 * Leva a janela para o topo, na hora.
 *
 * `behavior: 'instant'` NÃO é enfeite. O `html` deste projeto tem
 * `scroll-behavior: smooth` (index.css), para as âncoras do menu deslizarem.
 * Com isso ligado, qualquer `scrollTop = 0` ou `scrollTo` vira uma ANIMAÇÃO —
 * e a animação é cancelada pela própria troca de página, que desmonta a tela
 * antiga e muda a altura do documento no mesmo quadro. Conferido ao vivo em
 * 25/08/2026: `documentElement.scrollTop = 0` deixava a rolagem parada em
 * 1000px, e `scroll({ behavior: 'instant' })` zerava no mesmo instante.
 *
 * O caminho do `scrollTop` fica como reserva: o jsdom não implementa
 * `Element.scroll`, e é ele que roda nos testes.
 */
export function scrollToTop(): void {
  const root = document.scrollingElement ?? document.documentElement;
  if (!root) return;

  if (typeof root.scroll === 'function') {
    root.scroll({ top: 0, left: 0, behavior: 'instant' });
    return;
  }

  root.scrollTop = 0;
  root.scrollLeft = 0;
}

/** Rotas logadas: o painel ja existe nos 6 idiomas, entao nao precisa de tradutor. */
const LOGGED_AREA = /^\/(dashboard|demo|admin|affiliate)(\/|$)/;

export function isLoggedAreaPath(pathname: string): boolean {
  return LOGGED_AREA.test(pathname);
}

/**
 * Liga ou desliga a traducao automatica do navegador na pagina inteira.
 *
 * O Google Translate troca os nos de texto por `<font>` por fora do React; na
 * proxima troca de tela o React tenta remover um no que nao existe mais e o
 * painel cai no ErrorBoundary ("removeChild"). Reproduzido em 05/10/2026 ao
 * arrastar o grafico. Vale no <html> (e nao so num container) porque dialogos
 * e avisos abrem em portal, fora da arvore do painel. A vitrine publica
 * continua traduzivel.
 */
export function setPageTranslatable(translatable: boolean): void {
  const html = document.documentElement;
  if (translatable) {
    html.removeAttribute('translate');
    html.classList.remove('notranslate');
  } else {
    html.setAttribute('translate', 'no');
    html.classList.add('notranslate');
  }
}

/** A pagina foi traduzida pelo navegador? (Chrome marca o <html> com `translated-ltr`/`translated-rtl`.) */
export function isPageTranslated(): boolean {
  return typeof document !== 'undefined' && /\btranslated-/.test(document.documentElement.className);
}

/**
 * Erro que aconteceu so dentro do codigo do tradutor do navegador: pagina
 * traduzida e NENHUMA linha da pilha vem do nosso bundle (`/assets/`).
 * Visto em 06/10/2026: Chrome do iPhone com traducao, `RangeError: Maximum
 * call stack size exceeded` em 50 linhas de script injetado pelo tradutor
 * (linhas 190 a 226 de uma pagina que tem 166) e o painel seguiu funcionando.
 * Pilha vazia NAO conta: sem pilha nao da para saber de quem e o erro, e erro
 * nosso de verdade (como o `removeChild` de 05/10) tem linha no bundle.
 */
export function isTranslatorOnlyError(
  translated: boolean,
  frames: ReadonlyArray<{ filename?: string | null }> | undefined,
): boolean {
  if (!translated || !frames || frames.length === 0) return false;
  return frames.every((frame) => !String(frame.filename || '').includes('/assets/'));
}
