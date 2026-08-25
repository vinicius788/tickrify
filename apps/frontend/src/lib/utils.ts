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
