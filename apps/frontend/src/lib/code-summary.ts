/**
 * Resumo escrito pelo codigo (motor de entrada pelas velas, 23/11/2026).
 * A frase sai de `result.codeSummary`, nos 6 idiomas, com os numeros finais do
 * motor. A prosa do modelo fica so no painel tecnico: uma fonte de verdade.
 */
import type { CandleBias, CodeSummary, CodeSummaryAction } from './api';

/** Textos de `t.analysis.result.codeSummary`. */
export interface CodeSummaryTexts {
  label: Record<CodeSummaryAction, string>;
  lead: Record<CodeSummaryAction, string>;
  stop: string;
  target1: string;
  target2: string;
  turnsBuy: string;
  turnsSell: string;
  flipped: string;
  reasons: Record<string, string>;
}

export function isCodeSummary(value: unknown): value is CodeSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.action === 'string' && v.action in ACTION_SET;
}

const ACTION_SET: Record<CodeSummaryAction, true> = {
  buy_now: true, sell_now: true, buy_pullback: true, sell_pullback: true, buy_breakout: true, sell_breakout: true, wait: true,
};

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');

export interface CodeSummaryView {
  /** Frase completa para a tela. */
  text: string;
  /** So o estado e o motivo, sem preco: serve ao card de compartilhar. */
  headline: string;
}

/** Monta o resumo. `formatPrice` devolve '' para numero nulo. */
export function buildCodeSummaryText(
  cs: CodeSummary,
  texts: CodeSummaryTexts,
  formatPrice: (value: number | null) => string,
): CodeSummaryView {
  const px = (v: number | null) => (v === null || v === undefined ? '' : formatPrice(v));
  const parts: string[] = [];
  const entry = px(cs.entry);
  const level = px(cs.level);
  const needsLevel = cs.action.endsWith('_pullback') || cs.action.endsWith('_breakout');
  const reason = cs.waitReason ? texts.reasons[cs.waitReason] ?? '' : '';

  if (cs.action === 'wait') {
    parts.push(texts.lead.wait);
    if (reason) parts.push(reason);
    const buy = px(cs.turnsBuyAbove);
    const sell = px(cs.turnsSellBelow);
    if (buy) parts.push(fill(texts.turnsBuy, { price: buy }));
    if (sell) parts.push(fill(texts.turnsSell, { price: sell }));
  } else {
    // Sem o numero da frase, cai no rotulo (nunca deixa "{entry}" ou "at ." na tela).
    parts.push(entry && (!needsLevel || level) ? fill(texts.lead[cs.action], { entry, level }) : `${texts.label[cs.action]}.`);
    if (cs.stopLoss !== null) parts.push(fill(texts.stop, { stop: px(cs.stopLoss) }));
    if (cs.takeProfit1 !== null) parts.push(fill(texts.target1, { tp1: px(cs.takeProfit1) }));
    if (cs.takeProfit2 !== null) parts.push(fill(texts.target2, { tp2: px(cs.takeProfit2) }));
  }
  if (cs.flippedFromPrior) parts.push(texts.flipped);

  const headline = cs.action === 'wait' ? [texts.lead.wait, reason].filter(Boolean).join(' ') : `${texts.label[cs.action]}.`;
  return { text: parts.filter(Boolean).join(' '), headline };
}

export type BiasLineKey = 'htfUp' | 'htfDown' | 'structUp' | 'structDown' | 'aboveEma' | 'belowEma' | 'htfAboveEma' | 'htfBelowEma';

/** Argumentos de cada lado, so dos dados das velas; no maximo 3 por coluna. */
export function biasArguments(bias: CandleBias | null | undefined): { buy: BiasLineKey[]; sell: BiasLineKey[] } {
  if (!bias) return { buy: [], sell: [] };
  const buy: BiasLineKey[] = [];
  const sell: BiasLineKey[] = [];
  if (bias.htfTrend === 'uptrend') buy.push('htfUp');
  if (bias.htfTrend === 'downtrend') sell.push('htfDown');
  if (bias.structure === 'up') buy.push('structUp');
  if (bias.structure === 'down') sell.push('structDown');
  if (bias.vsEma50 === 'above') buy.push('aboveEma');
  if (bias.vsEma50 === 'below') sell.push('belowEma');
  if (bias.htfVsEma50 === 'above') buy.push('htfAboveEma');
  if (bias.htfVsEma50 === 'below') sell.push('htfBelowEma');
  return { buy: buy.slice(0, 3), sell: sell.slice(0, 3) };
}
