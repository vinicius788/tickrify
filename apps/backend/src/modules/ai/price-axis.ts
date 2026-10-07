/**
 * Leitura do eixo de precos para as linhas da extensao (06/10/2026).
 *
 * Por que existe: o `entryY/stopY/tp1Y/tp2Y` que o motor devolve (a IA estima
 * a ALTURA de cada nivel na imagem) errou ate ~82 px num grafico real. Ler os
 * NUMEROS do eixo e muito mais facil para a IA: medido em 4 graficos reais do
 * TradingView (EURJPY, BTCUSDT, XAUUSD, GBPUSD; 2 rodadas cada), o pior erro foi
 * 7,5 px com esta instrucao (30 px sem a frase da faixa de datas). Medicao em
 * `_local/extensao/medicao-eixo/`.
 *
 * Chamada SEPARADA da analise: o prompt do motor, o schema e o `promptVer` nao
 * mudam. So roda para analise da extensao com BUY/SELL, uma vez por analise
 * (o resultado fica em `Analysis.clientContext.priceAxis`).
 */
export const PRICE_AXIS_PROMPT = `This image is a cropped trading chart that includes its right-side price axis.
Read the price labels printed on the axis (the axis is linear) and return:
- top: the price that corresponds to the very TOP edge of this image
- bottom: the price that corresponds to the very BOTTOM edge of this image
Extrapolate the axis scale linearly to the image edges. Do not round to the nearest label.
Important: the bottom of the image usually contains the time/date axis strip, below the area
where prices are plotted. Keep extending the price scale linearly through that strip all the
way to the very bottom pixel of the image; do NOT stop at the bottom of the plotted area.
If the image has no readable price axis, return null for both.`;

export const PRICE_AXIS_SCHEMA = {
  type: 'object',
  properties: {
    top: { type: ['number', 'null'] },
    bottom: { type: ['number', 'null'] },
  },
  required: ['top', 'bottom'],
  additionalProperties: false,
} as const;

export type PriceAxis = { top: number; bottom: number };

/** So passa leitura coerente; qualquer duvida vira null (a extensao fica sem linhas). */
export function sanitizePriceAxis(raw: unknown): PriceAxis | null {
  const r = (raw ?? {}) as { top?: unknown; bottom?: unknown };
  const top = r.top;
  const bottom = r.bottom;
  if (typeof top !== 'number' || typeof bottom !== 'number') return null;
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || top <= bottom) return null;
  return { top, bottom };
}
