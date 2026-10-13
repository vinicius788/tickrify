import {
  ACTIONS,
  SITUATIONS,
  priceSituation,
  type Direction,
  type TradeAction,
  type TradeSituation,
} from '../../common/trade-state';

/**
 * MODO GERENCIAMENTO (13/10/2026): o trader ja tem a operacao (ou uma ordem
 * pendente) e manda um grafico novo. Chamada SEPARADA da analise normal
 * (mesmo provedor e mesmo modelo, via VisionModel): prompt, schema e
 * `promptVer` do motor ficam intocados, como no eixo de preco (price-axis.ts).
 *
 * A IA so julga ESTA operacao. O schema nao tem campo de entrada nova nem de
 * direcao: nao ha como ela propor "compre de novo". O codigo ainda corrige o
 * que a IA devolver fora das regras (`finalizeManagement`).
 */

export type ManagementContext = {
  direction: Direction;
  status: 'pending_order' | 'in_trade';
  symbol: string | null;
  timeframe: string | null;
  plannedEntry: number | null;
  entryType: string | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  invalidationLevel: number | null;
  thesis: string | null;
  /** Preco real de entrada que o trader digitou (in_trade). */
  entryPrice: number | null;
  hoursSinceAnalysis: number;
  /** Preco atual digitado pelo trader: vence o que a IA le no grafico. */
  currentPrice: number | null;
  language: string;
};

export type ManagementResult = {
  situation: TradeSituation;
  action: TradeAction;
  reason: string;
  watch: string;
  /** A IA conseguiu ler o preco atual no grafico? */
  priceReadable: boolean;
  readPrice: number | null;
  /** Sem preco digitado e sem leitura segura: a tela pede o preco atual. */
  needsCurrentPrice: boolean;
  /** Situacao decidida pelo codigo a partir do preco digitado. */
  decidedByPrice: boolean;
};

/** Ordem das chaves = ordem de geracao: le o preco e explica ANTES de decidir. */
export const MANAGEMENT_SCHEMA = {
  type: 'object',
  properties: {
    priceReadable: { type: 'boolean' },
    readPrice: { type: ['number', 'null'] },
    reason: { type: 'string' },
    situation: { type: 'string', enum: [...SITUATIONS] },
    action: { type: 'string', enum: [...ACTIONS] },
    watch: { type: 'string' },
  },
  required: ['priceReadable', 'readPrice', 'reason', 'situation', 'action', 'watch'],
  additionalProperties: false,
} as const;

const fmt = (v: number | null) => (v === null ? 'not set' : String(v));

export function buildManagementPrompt(ctx: ManagementContext): string {
  const status =
    ctx.status === 'in_trade'
      ? `The trader is IN this trade${ctx.entryPrice !== null ? `, real entry price ${ctx.entryPrice}` : ''}.`
      : `The trader has a PENDING ORDER at the planned entry (${fmt(ctx.plannedEntry)}); it may or may not have been filled.`;
  const price =
    ctx.currentPrice !== null
      ? `Current price typed by the trader: ${ctx.currentPrice}. This overrides anything you read on the chart.`
      : 'The trader did not type the current price. Read it from the chart only if you can do so with confidence.';
  return [
    'You are managing a trade the trader ALREADY has. You are not looking for a new trade.',
    '',
    'Original plan (from the analysis the trader marked):',
    `- Asset: ${ctx.symbol ?? 'unknown'}${ctx.timeframe ? `, timeframe ${ctx.timeframe}` : ''}`,
    `- Direction: ${ctx.direction}`,
    `- Planned entry: ${fmt(ctx.plannedEntry)}${ctx.entryType ? ` (${ctx.entryType})` : ''}`,
    `- Stop loss: ${fmt(ctx.stopLoss)}`,
    `- Target 1: ${fmt(ctx.takeProfit1)}; Target 2: ${fmt(ctx.takeProfit2)}`,
    `- Invalidation: ${fmt(ctx.invalidationLevel)}`,
    `- Thesis: ${ctx.thesis ? ctx.thesis.slice(0, 600) : 'not available'}`,
    `- Time since the original analysis: ${Math.max(0, Math.round(ctx.hoursSinceAnalysis))} hours.`,
    '',
    status,
    price,
    '',
    'Rules:',
    '- Judge THIS trade only, on the new chart. Never suggest a new entry, never flip the direction, never treat the chart as a new setup.',
    '- Lines drawn on the chart (positions, orders) are hints only. The trade status above is the truth.',
    '- If you cannot read the current price with confidence and none was typed, set priceReadable to false, readPrice to null and situation to "unclear".',
    ctx.status === 'pending_order'
      ? '- Pending order: say whether price reached the entry zone and whether the setup is still valid. Action is "wait" (keep the order) or "cancel_order".'
      : '- Open trade: situation is on_track, near_target, near_stop, invalidated, target_hit, stop_hit or unclear. Action is hold, move_stop_to_breakeven, partial_exit or exit.',
    '- reason: at most two short sentences. watch: one short sentence with the level or event to watch next.',
    `- Write reason and watch in this language: ${ctx.language || 'en'}. No emoji.`,
    'Answer only with the JSON of the schema.',
  ].join('\n');
}

const PENDING_ACTIONS: readonly TradeAction[] = ['wait', 'cancel_order'];
const OPEN_ACTIONS: readonly TradeAction[] = ['hold', 'move_stop_to_breakeven', 'partial_exit', 'exit'];

/**
 * Le a resposta e aplica as regras por CODIGO. Lanca se o JSON nao abre ou
 * vem fora do schema (quem chama repete uma vez).
 */
export function finalizeManagement(content: string, ctx: ManagementContext): ManagementResult {
  const raw = JSON.parse(content) as Record<string, unknown>;
  const situation = SITUATIONS.find((s) => s === raw.situation);
  const action = ACTIONS.find((a) => a === raw.action);
  if (!situation || !action || typeof raw.reason !== 'string' || typeof raw.watch !== 'string') {
    throw new Error('management response outside the schema');
  }
  const readPrice = typeof raw.readPrice === 'number' && Number.isFinite(raw.readPrice) && raw.readPrice > 0 ? raw.readPrice : null;
  const priceReadable = raw.priceReadable === true && readPrice !== null;

  let finalSituation: TradeSituation = situation;
  let finalAction: TradeAction = action;

  // Acao que nao existe para o estado: pendente nao sai parcial; aberto nao cancela ordem.
  if (ctx.status === 'pending_order' && !PENDING_ACTIONS.includes(finalAction)) {
    finalAction = finalSituation === 'invalidated' ? 'cancel_order' : 'wait';
  }
  if (ctx.status === 'in_trade' && !OPEN_ACTIONS.includes(finalAction)) {
    finalAction = 'hold';
  }

  // Preco digitado pelo trader cruzou alvo/stop: decide o codigo, nao a IA.
  const hit = priceSituation(ctx.direction, ctx.stopLoss, ctx.takeProfit1, ctx.currentPrice);
  if (hit) {
    finalSituation = hit;
    finalAction = ctx.status === 'in_trade' ? 'exit' : 'cancel_order';
  }

  const needsCurrentPrice = ctx.currentPrice === null && !priceReadable;
  if (needsCurrentPrice && !hit) finalSituation = 'unclear';

  return {
    situation: finalSituation,
    action: finalAction,
    reason: raw.reason.slice(0, 400),
    watch: raw.watch.slice(0, 240),
    priceReadable,
    readPrice,
    needsCurrentPrice,
    decidedByPrice: Boolean(hit),
  };
}
