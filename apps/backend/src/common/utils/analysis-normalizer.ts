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

export interface PriceLevels {
  currentPrice: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  invalidationLevel: number | null;
}

const FOREX_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF']);
const isForexPair = (s: string): boolean =>
  s.length === 6 && FOREX_CODES.has(s.slice(0, 3)) && FOREX_CODES.has(s.slice(3, 6));

// Faixas plausíveis por ativo. Só corrigimos erros ÓBVIOS de ordem de grandeza.
const PRICE_RANGES: Array<{ test: (s: string) => boolean; min: number; max: number }> = [
  // ── Cripto ──
  { test: (s) => s.startsWith('BTC'), min: 10_000, max: 1_000_000 },
  { test: (s) => s.startsWith('ETH'), min: 300, max: 50_000 },
  { test: (s) => s.startsWith('SOL'), min: 5, max: 5_000 },
  { test: (s) => s.startsWith('BNB'), min: 30, max: 10_000 },
  // ── Metais ──
  { test: (s) => s.includes('XAU'), min: 800, max: 6_000 }, // ouro
  { test: (s) => s.includes('XAG'), min: 3, max: 200 }, // prata
  // ── Índices globais ──
  { test: (s) => s.includes('NAS') || s === 'US100' || s.includes('NDX') || s.includes('USTEC'), min: 5_000, max: 40_000 }, // Nasdaq 100
  { test: (s) => s === 'US30' || s.includes('DJI') || s.includes('DOW') || s.includes('WALL'), min: 15_000, max: 70_000 }, // Dow
  { test: (s) => s.includes('SPX') || s === 'US500' || s.includes('SP500'), min: 1_500, max: 12_000 }, // S&P 500
  { test: (s) => s.includes('GER') || s.includes('DAX') || s === 'DE40' || s === 'DE30', min: 8_000, max: 35_000 }, // DAX
  { test: (s) => s.includes('UK100') || s.includes('FTSE'), min: 4_000, max: 15_000 }, // FTSE
  { test: (s) => s.includes('JP225') || s.includes('NIKKEI') || s.includes('JPN'), min: 15_000, max: 70_000 }, // Nikkei
  // ── Petróleo ──
  { test: (s) => s.includes('OIL') || s.includes('WTI') || s.includes('BRENT') || s.includes('USOIL'), min: 15, max: 250 },
  // ── B3 (Brasil) ──
  { test: (s) => s.startsWith('WIN') || s.includes('IBOV'), min: 70_000, max: 250_000 }, // mini índice / Ibovespa
  { test: (s) => s.startsWith('WDO') || s.startsWith('DOL'), min: 3_000, max: 9_000 }, // mini dólar
  // ── Forex ──
  // JPY (USDJPY ~150): real 90–160, faixa segura 50–300.
  { test: (s) => isForexPair(s) && s.endsWith('JPY'), min: 50, max: 300 },
  // demais majors (EURUSD ~1.08): real 0.5–2.0, faixa segura 0.3–3.0.
  { test: (s) => isForexPair(s) && !s.endsWith('JPY'), min: 0.3, max: 3 },
];

/**
 * Corrige erros de ordem de grandeza na leitura de preço pela IA de visão
 * (ex.: BTC lido como 6.356 quando o real é 63.560). Multiplica TODOS os níveis
 * pelo mesmo fator de potência de 10 que traz o preço atual para a faixa plausível.
 * Conservador: só age quando há um fator de 10 limpo; caso contrário, não mexe.
 */
export function correctPriceMagnitude<T extends PriceLevels>(symbol: string, levels: T): T {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const range = PRICE_RANGES.find((r) => r.test(s));
  const price = levels.currentPrice;

  if (!range || !Number.isFinite(price) || price <= 0) {
    return levels;
  }
  if (price >= range.min && price <= range.max) {
    return levels; // já está na faixa correta
  }

  const candidates = [10, 100, 1000, 10_000, 0.1, 0.01, 0.001, 0.0001];
  let factor: number | null = null;
  for (const f of candidates) {
    const p = price * f;
    if (p >= range.min && p <= range.max) {
      factor = f;
      break;
    }
  }
  if (factor === null) {
    return levels; // não encaixou num fator limpo → não arrisca
  }

  const scale = (v: number | null): number | null =>
    v == null || !Number.isFinite(v) ? v : Math.round(v * (factor as number) * 100) / 100;

  return {
    ...levels,
    currentPrice: scale(price) as number,
    entry: scale(levels.entry),
    stopLoss: scale(levels.stopLoss),
    takeProfit1: scale(levels.takeProfit1),
    takeProfit2: scale(levels.takeProfit2),
    invalidationLevel: scale(levels.invalidationLevel),
  };
}

/**
 * Deriva o regime de mercado de forma determinística a partir do bias + força,
 * para NUNCA contradizer (ex.: nunca mais "Lateral" num mercado em tendência de baixa).
 * Respeita "volatile" quando a IA detecta volatilidade (estado distinto).
 */
export function deriveMarketRegime(aiRegime: unknown, bias: unknown, trendStrength: unknown): string {
  const ai = String(aiRegime || '').trim().toLowerCase();
  if (ai === 'volatile' || ai.includes('volát') || ai.includes('volat')) {
    return 'volatile';
  }
  const b = String(bias || '').trim().toLowerCase();
  const directional = b === 'bullish' || b === 'bearish' || b.includes('alta') || b.includes('baixa');
  const s = String(trendStrength || '').trim().toLowerCase();
  const weak = s === 'weak' || s.includes('frac');
  if (directional && !weak) {
    return 'trending';
  }
  return 'ranging';
}

/**
 * Cap determinístico de confiança pela confluência (checklist 0-7 do prompt).
 * Evita contradições visíveis tipo "85% de confiança" com 4/7 fatores.
 * Regra: ≤3 fatores → máx 50 | 4-5 → máx 74 | 6-7 → sem cap extra.
 * Sem dado de confluência (0/ausente/inválido), não mexe — degradação graciosa.
 */
export function capConfidenceByConfluence(confidence: number, factorsPresent: unknown): number {
  const f = Number(factorsPresent);
  if (!Number.isFinite(f) || f <= 0 || f > 7) {
    return confidence;
  }
  if (f <= 3) {
    return Math.min(confidence, 50);
  }
  if (f <= 5) {
    return Math.min(confidence, 74);
  }
  return confidence;
}

/**
 * Guard determinístico de R/R: um BUY/SELL cujo R/R calculado no TP1 fica abaixo
 * do mínimo objetivamente não compensa o risco — rebaixa para WAIT e limita a
 * confiança a 45. Os níveis de preço NÃO são apagados (o usuário continua vendo
 * a estrutura completa); muda apenas o sinal.
 * Kill-switch: ENABLE_RR_GUARD=false desliga (default: ligado).
 * Conservador: usa 1.2 como piso (o prompt pede ≥1.5) — só derruba o que é
 * indefensável, sem virar censor de sinais razoáveis.
 */
export function applyRiskRewardGuard(
  recommendation: Recommendation,
  confidence: number,
  riskRewardTp1: number | null | undefined,
  minRatio = 1.2,
): { recommendation: Recommendation; confidence: number; downgraded: boolean } {
  if (process.env.ENABLE_RR_GUARD === 'false') {
    return { recommendation, confidence, downgraded: false };
  }
  if (recommendation === 'WAIT' || riskRewardTp1 == null || !Number.isFinite(riskRewardTp1)) {
    return { recommendation, confidence, downgraded: false };
  }
  if (riskRewardTp1 >= minRatio) {
    return { recommendation, confidence, downgraded: false };
  }
  return {
    recommendation: 'WAIT',
    confidence: Math.min(confidence, 45),
    downgraded: true,
  };
}

export interface TargetProbabilities {
  probabilityTp1: number | null;
  probabilityTp2: number | null;
  probabilityStop: number | null;
}

/**
 * Normaliza as probabilidades por alvo (TP1/TP2/Stop) vindas do modelo.
 *
 * Regras:
 * - Aceita escala 0..1 (probabilidade) ou 0..100 (pontos percentuais).
 * - 0, negativo, >100 ou não-numérico = "não preenchido" (evita o bug "0%/0%/0%").
 * - Sem plano de trade (entry ausente, ex.: HOLD/WAIT) → tudo null (a UI esconde a seção).
 * - Quando o modelo não preenche, deriva um default determinístico da confiança:
 *   TP1 ≈ 0.85×confiança (limitado a 25–80), Stop = 100−TP1 (20–75), TP2 ≈ 0.55×TP1 (10–60).
 * - Coerência: TP2 nunca acima de TP1.
 */
export function normalizeTargetProbabilities(
  raw: { tp1?: unknown; tp2?: unknown; stop?: unknown },
  options: { hasTradePlan: boolean; confidence: number },
): TargetProbabilities {
  if (!options.hasTradePlan) {
    return { probabilityTp1: null, probabilityTp2: null, probabilityStop: null };
  }

  const toPct = (value: unknown): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      return null;
    }
    const pct = n <= 1 ? n * 100 : n;
    return clamp(Math.round(pct), 1, 99);
  };

  const confidence = clamp(
    Number.isFinite(options.confidence) ? options.confidence : 50,
    0,
    100,
  );

  const tp1 = toPct(raw.tp1) ?? clamp(Math.round(confidence * 0.85), 25, 80);
  const stop = toPct(raw.stop) ?? clamp(100 - tp1, 20, 75);
  let tp2 = toPct(raw.tp2) ?? clamp(Math.round(tp1 * 0.55), 10, 60);
  if (tp2 > tp1) {
    tp2 = tp1;
  }

  return { probabilityTp1: tp1, probabilityTp2: tp2, probabilityStop: stop };
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
