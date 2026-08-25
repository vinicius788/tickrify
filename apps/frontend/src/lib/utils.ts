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
 * Leva a janela para o topo.
 *
 * Mexe no elemento de rolagem em vez de chamar `window.scrollTo`: o jsdom não
 * implementa `scrollTo` e enchia a saída dos testes de "Not implemented", e o
 * `document.scrollingElement` já resolve a diferença histórica entre body e
 * documentElement como raiz da rolagem.
 */
export function scrollToTop(): void {
  const root = document.scrollingElement ?? document.documentElement;
  if (!root) return;
  root.scrollTop = 0;
  root.scrollLeft = 0;
}
