import type { Rect } from '@/lib/crop';
import { readPageMeta, type PageMeta, type Platform } from '@/lib/platform';

const MIN_W = 240;
const MIN_H = 160;

function visibleRect(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const w = Math.min(window.innerWidth, r.right) - x;
  const h = Math.min(window.innerHeight, r.bottom) - y;
  return w >= MIN_W && h >= MIN_H ? { x, y, w, h } : null;
}

/**
 * Area do grafico no TradingView. O grafico e desenhado em <canvas>: aqui so
 * se acha ONDE ele esta para recortar o print, nada e lido de dentro dele.
 * Se o TradingView mudar o layout, cai no maior canvas da tela e, se nem isso,
 * o trader marca a area.
 */
export function findTradingViewChart(): Rect | null {
  for (const selector of ['.layout__area--center', '.chart-container', '.chart-markup-table']) {
    const rect = visibleRect(document.querySelector(selector));
    if (rect) return rect;
  }
  let best: Rect | null = null;
  for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
    const rect = visibleRect(canvas.parentElement ?? canvas);
    if (rect && (!best || rect.w * rect.h > best.w * best.h)) best = rect;
  }
  return best;
}

/** Texto do tempo grafico selecionado no cabecalho do TradingView, se achar. */
function tradingViewTimeframeText(): string | undefined {
  const el =
    document.querySelector('#header-toolbar-intervals [aria-pressed="true"]') ??
    document.querySelector('#header-toolbar-intervals button[aria-checked="true"]') ??
    document.querySelector('#header-toolbar-intervals button');
  return el?.textContent?.trim() || undefined;
}

export function pageMeta(platform: Platform): PageMeta {
  return readPageMeta({
    url: location.href,
    title: document.title,
    timeframeText: platform === 'tradingview' ? tradingViewTimeframeText() : undefined,
  });
}

const areaKey = () => `tk_area:${location.host}`;

/** Area marcada pelo trader neste site, ajustada se a janela encolheu. */
export async function loadSavedArea(): Promise<Rect | null> {
  const stored = (await browser.storage.local.get(areaKey()))[areaKey()] as Rect | undefined;
  if (!stored) return null;
  const x = Math.min(stored.x, window.innerWidth - MIN_W);
  const y = Math.min(stored.y, window.innerHeight - MIN_H);
  const w = Math.min(stored.w, window.innerWidth - Math.max(0, x));
  const h = Math.min(stored.h, window.innerHeight - Math.max(0, y));
  return w >= MIN_W && h >= MIN_H ? { x: Math.max(0, x), y: Math.max(0, y), w, h } : null;
}

export async function saveArea(rect: Rect): Promise<void> {
  await browser.storage.local.set({ [areaKey()]: rect });
}

export async function clearArea(): Promise<void> {
  await browser.storage.local.remove(areaKey());
}
