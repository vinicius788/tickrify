export type Recommendation = 'BUY' | 'SELL' | 'WAIT';
export type Bias = 'bullish' | 'bearish' | 'neutral';

const BUY_HINTS = ['BUY', 'COMPRA', 'LONG', 'BULL', 'ALTA'];
const SELL_HINTS = ['SELL', 'VENDA', 'SHORT', 'BEAR', 'BAIXA'];
const WAIT_HINTS = ['WAIT', 'HOLD', 'AGUARD', 'NEUTR', 'LATERAL', 'ESPERA'];

function normalizeText(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function normalizeRecommendation(value: unknown): Recommendation {
  const text = normalizeText(value);

  if (!text) {
    return 'WAIT';
  }

  if (BUY_HINTS.some((hint) => text.includes(hint))) {
    return 'BUY';
  }

  if (SELL_HINTS.some((hint) => text.includes(hint))) {
    return 'SELL';
  }

  if (WAIT_HINTS.some((hint) => text.includes(hint))) {
    return 'WAIT';
  }

  return 'WAIT';
}

function recommendationToBias(recommendation: Recommendation): Bias {
  if (recommendation === 'BUY') {
    return 'bullish';
  }

  if (recommendation === 'SELL') {
    return 'bearish';
  }

  return 'neutral';
}

export function normalizeBias(value: unknown, recommendation?: Recommendation): Bias {
  const text = String(value || '').trim().toLowerCase();

  if (text === 'bullish' || text.includes('bull')) {
    return 'bullish';
  }

  if (text === 'bearish' || text.includes('bear')) {
    return 'bearish';
  }

  if (text === 'neutral' || text.includes('neut')) {
    return 'neutral';
  }

  return recommendationToBias(recommendation || 'WAIT');
}

export function normalizeConfidence(value: unknown, fallback = 50): number {
  let numeric = Number(value);

  if (!Number.isFinite(numeric) && typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      numeric = Number(match[0]);
    }
  }

  if (!Number.isFinite(numeric)) {
    return clamp(fallback, 0, 100);
  }

  // Accept both scales:
  // - 0..1  => probability (e.g. 0.85 means 85%)
  // - 0..100 => percentage points
  const normalized = numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  return clamp(normalized, 0, 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeReasoning(value: unknown, fallback = 'Analise gerada sem justificativa detalhada.'): string {
  const text = String(value || '').trim();
  return text || fallback;
}

/**
 * Calcula o risco/retorno (reward por 1 unidade de risco) a partir dos níveis de preço.
 * Funciona para BUY (TP > entry > SL) e SELL (TP < entry < SL) — usa valores absolutos.
 * Retorna null quando faltam dados, são inválidos, ou o risco é zero.
 */
export function computeRiskReward(
  entry: number | null | undefined,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): number | null {
  if (entry == null || stopLoss == null || takeProfit == null) {
    return null;
  }

  if (![entry, stopLoss, takeProfit].every((n) => Number.isFinite(n))) {
    return null;
  }

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  if (risk <= 0) {
    return null;
  }

  const ratio = reward / risk;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }

  // Arredonda para 2 casas para estabilidade de exibição.
  return Math.round(ratio * 100) / 100;
}

/**
 * Harmoniza a confiança com a força da tendência para evitar contradições visíveis
 * ao usuário (ex.: "75% Alta" ao lado de "Força: Moderada").
 * Tendência fraca/moderada limita o teto da confiança; tendência forte não altera.
 * Conservador por design: só REDUZ a confiança, nunca aumenta.
 *   weak     → teto 60
 *   moderate → teto 74  (abaixo do limite de "Alta", que é 75)
 *   strong   → sem teto
 */
export function harmonizeConfidenceWithTrend(
  confidence: number,
  trendStrength: unknown,
): number {
  if (!Number.isFinite(confidence)) {
    return confidence;
  }

  const strength = String(trendStrength || '').trim().toLowerCase();
  let cap = 100;
  if (strength === 'weak' || strength.includes('frac')) {
    cap = 60;
  } else if (strength === 'moderate' || strength.includes('moder')) {
    cap = 74;
  }

  return Math.min(confidence, cap);
}

/** Formata um R/R numérico como "1:X.X" (ex.: 2.3 -> "1:2.3"). */
export function formatRiskReward(ratio: number | null | undefined): string | null {
  if (ratio == null || !Number.isFinite(ratio)) {
    return null;
  }
  return `1:${ratio.toFixed(1)}`;
}

export function parseJsonFromContent(content: string): Record<string, any> | null {
  const trimmed = String(content || '').trim();
  if (!trimmed) {
    return null;
  }

  const withoutCodeFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [withoutCodeFence];
  const match = withoutCodeFence.match(/\{[\s\S]*\}/);
  if (match) {
    candidates.push(match[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      continue;
    }
  }

  return null;
}
