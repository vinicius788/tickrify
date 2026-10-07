export type LevelKey = 'entry' | 'stop' | 'tp1' | 'tp2';
export type LevelFractions = Record<LevelKey, number | null | undefined>;
export type LevelMark = { key: LevelKey; top: number | null; edge: 'above' | 'below' | null };

const ORDER: LevelKey[] = ['tp2', 'tp1', 'entry', 'stop'];
// Nivel fora da escala visivel fica preso em 0 ou 1 e vira etiqueta de borda.
const EDGE = 0.005;

function valid(f: unknown): f is number {
  return typeof f === 'number' && Number.isFinite(f) && f >= 0 && f <= 1;
}

/**
 * Altura de cada nivel (0 = topo do recorte, 1 = base) calculada pela escala
 * do eixo de precos (preco no topo e na base do recorte). NAO usa o
 * `entryY/stopY/tp1Y/tp2Y` do motor: na medicao real de 06/10 eles erraram
 * ate ~80 px (stop 182,3 desenhado em ~183,7). Sem escala valida, ou com a
 * entrada fora dela (o eixo lido nao bate com o grafico), devolve null e o
 * painel fica so com os precos.
 */
export function fractionsFromAxis(
  prices: Record<LevelKey, number | null | undefined>,
  axis: { top?: number | null; bottom?: number | null } | null | undefined,
): LevelFractions | null {
  const top = axis?.top;
  const bottom = axis?.bottom;
  if (typeof top !== 'number' || typeof bottom !== 'number' || !Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) {
    return null;
  }
  const at = (p: number | null | undefined) =>
    typeof p === 'number' && Number.isFinite(p) ? Math.min(1, Math.max(0, (top - p) / (top - bottom))) : null;
  const entry = prices.entry;
  if (typeof entry !== 'number' || entry > top || entry < bottom) return null;
  return { entry: at(entry), stop: at(prices.stop), tp1: at(prices.tp1), tp2: at(prices.tp2) };
}

/** Onde desenhar cada nivel sobre o recorte. Nivel no limite vira etiqueta de borda. Sem entrada, nada. */
export function placeLevels(y: LevelFractions, height: number): LevelMark[] {
  if (!valid(y.entry)) return [];
  const marks: LevelMark[] = [];
  for (const key of ORDER) {
    const f = y[key];
    if (!valid(f)) continue;
    if (f <= EDGE) marks.push({ key, top: null, edge: 'above' });
    else if (f >= 1 - EDGE) marks.push({ key, top: null, edge: 'below' });
    else marks.push({ key, top: Math.round(f * height), edge: null });
  }
  return marks;
}
