export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Retangulo da pagina (pixels CSS, relativo a area visivel) para pixels da
 * imagem do `captureVisibleTab`. A escala sai da PROPRIA imagem (largura da
 * captura / largura da janela), nunca do devicePixelRatio: com zoom do
 * navegador ou em certos monitores a captura nao sai em dpr x, e o recorte
 * escorregava para fora do grafico (06/10, pego no teste automatizado no
 * TradingView). Corta o que passa da borda; null quando nao sobra nada.
 */
export function cropRectToPixels(
  rect: Rect,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): Rect | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const sx = image.width / viewport.width;
  const sy = image.height / viewport.height;
  const x1 = Math.max(0, Math.round(rect.x * sx));
  const y1 = Math.max(0, Math.round(rect.y * sy));
  const x2 = Math.min(image.width, Math.round((rect.x + rect.w) * sx));
  const y2 = Math.min(image.height, Math.round((rect.y + rect.h) * sy));
  if (x2 - x1 < 1 || y2 - y1 < 1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Tamanho final pelo lado maior (mesma ideia do shrinkChartImage do site). Nunca aumenta. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
