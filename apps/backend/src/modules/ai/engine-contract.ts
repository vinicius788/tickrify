import type { Recommendation } from '../../common/utils/analysis-normalizer';
import type { SignalDecisionResult, SignalState, ValidatorAction, ValidatorReason } from '../../common/utils/signal-decision';

// ============================================================================
// CONTRATO DE SAIDA DO MOTOR (v2, 12/10/2026)
// ----------------------------------------------------------------------------
// Formato fixo, independente do provedor, gravado em `result.engine` de cada
// analise nova. NAO e o schema que o modelo gera: aquele continua com o
// raciocinio antes do veredito e BUY/SELL/HOLD (ordem e vocabulario medidos,
// ver CLAUDE.md 4.1 e apps/frontend/CLAUDE.md). Este contrato e montado DEPOIS
// do parse e das travas, a partir do resultado final, e e o que a troca de
// provedor tem que reproduzir. Analise antiga nao tem `engine`: nada na tela
// le este bloco, entao o historico nao muda.
// ============================================================================

/** Versao do motor. Unico lugar; vai para o banco e para o PostHog. */
export const ENGINE_VERSION = '4.0.0';

export type EngineVerdict = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface EngineContract {
  verdict: EngineVerdict;
  confidence: number;
  asset: string;
  timeframe: string;
  entry: number | null;
  stop: number | null;
  targets: number[];
  invalidation: number | null;
  key_reasons: string[];
  no_trade_reason: string | null;
  /** Presentation metadata; absent on legacy records. */
  no_trade_reason_code?: string | null;
  no_trade_reason_params?: Record<string, string | number>;
  engine_version: string;
}

/** Tempos medidos na API antes de a analise ir para a fila (viajam no job). */
export interface AnalysisIntakeTimings {
  /** Date.now() quando a requisicao chegou ao service (upload ja recebido). */
  receivedAt: number;
  /** Preparo da imagem: decodificar e subir ao Storage. */
  imagePrepMs: number;
  /** Da chegada ate a analise entrar na fila (inclui cota e cobranca). */
  intakeMs: number;
}

/** Tempo de cada etapa no servidor. null = a etapa nao existe neste caminho. */
export interface EngineTimings {
  image_prep_ms: number | null;
  intake_ms: number | null;
  queue_ms: number | null;
  prompt_ms: number | null;
  grounding_ms: number | null;
  model_ms: number | null;
  parse_ms: number | null;
  validation_ms: number | null;
  server_total_ms: number | null;
}

export interface EngineRecord {
  version: string;
  /** Provedor de IA que respondeu (vision-model.ts). null = caminho sem adapter. */
  provider: string | null;
  /** real_data = niveis e distancia pelos candles reais; print = estimados do print. */
  data_mode: 'real_data' | 'print';
  /** Estado final do v10 (signal-decision.ts). */
  signal_state: SignalState;
  validator_action: ValidatorAction;
  validator_reasons: ValidatorReason[];
  /** Regras quebradas que so medem, sem rebaixar (MEASURE_ONLY_RULES). */
  validator_flags: SignalDecisionResult['validatorFlags'];
  timings: EngineTimings;
  contract: EngineContract | null;
  /** So existe (true) quando o plano anterior do setup entrou no prompt. */
  continuation?: true;
}

const MAX_KEY_REASONS = 3;
const MAX_REASON_CHARS = 160;
const MAX_NO_TRADE_CHARS = 240;

const VERDICTS: Record<Recommendation, EngineVerdict> = {
  BUY: 'BULLISH',
  SELL: 'BEARISH',
  WAIT: 'NEUTRAL',
};

// Motivo fixo de cada mudanca de estado (o texto da IA defendia o estado dela).
const VALIDATOR_REASON_TEXT: Record<ValidatorReason, string> = {
  state_mismatch: 'The state and the recommendation did not agree.',
  watch_plan_invalid: 'The plan has its levels out of order.',
  implausible_price: 'A price level is outside a plausible range of the chart price.',
  invalidation_unsnapped: 'There is no real swing between price and the invalidation, within 0.5 ATR of it.',
  plan_invalidated: 'Price is already beyond the invalidation.',
  market_entry_invalid: 'An entry at the current price needs a risk of at most 2.0 ATR and a first target at least 1R away.',
  market_entry_valid: 'The entry at the current price meets every condition to enter now.',
  limit_order_retired: 'Pending limit orders are no longer issued: the plan waits for its level instead.',
  required_check_failed: 'A required checklist item failed for this state.',
  checks_below_min: 'Too few checklist items passed for this state.',
  late_move: 'The move is late, so it is not a market entry.',
  setup_failed: 'There is no complete setup.',
  no_valid_geometry: 'Neither an entry at the current price nor one at the plan level is valid.',
  levels_unverified: 'No real candles, and the plan levels or the chart price could not be read.',
  not_at_price: 'Price is not inside the area, so there is no entry at the current price.',
  news_event: 'A high-impact economic event is due within 45 minutes or came out in the last 15.',
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function sentences(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function level(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export interface EngineContractInput {
  /** Recomendação FINAL (depois das travas). */
  recommendation: Recommendation;
  /** Confiança final, 0 a 100. */
  confidencePct: number;
  symbol: unknown;
  timeframe: unknown;
  entry: unknown;
  stopLoss: unknown;
  takeProfit1: unknown;
  takeProfit2: unknown;
  invalidationLevel: unknown;
  executiveSummary: unknown;
  validatorReasons: ValidatorReason[];
}

export function buildEngineContract(input: EngineContractInput): EngineContract {
  const verdict = VERDICTS[input.recommendation];
  const isTrade = verdict !== 'NEUTRAL';
  const summary = sentences(input.executiveSummary);
  // O ultimo motivo e o da mudanca que levou ao estado final.
  const validatorReason = input.validatorReasons[input.validatorReasons.length - 1];

  return {
    verdict,
    confidence: Math.max(0, Math.min(100, Math.round(Number(input.confidencePct) || 0))),
    asset: clip(String(input.symbol ?? '') || 'UNKNOWN', 40),
    timeframe: clip(String(input.timeframe ?? '') || 'UNKNOWN', 20),
    entry: isTrade ? level(input.entry) : null,
    stop: isTrade ? level(input.stopLoss) : null,
    targets: isTrade
      ? [input.takeProfit1, input.takeProfit2].map(level).filter((n): n is number => n !== null)
      : [],
    invalidation: isTrade ? level(input.invalidationLevel) : null,
    key_reasons: summary.slice(0, MAX_KEY_REASONS).map((s) => clip(s, MAX_REASON_CHARS)),
    no_trade_reason: isTrade
      ? null
      : validatorReason
        ? VALIDATOR_REASON_TEXT[validatorReason]
        : clip(summary[0] ?? 'No trade setup on this chart.', MAX_NO_TRADE_CHARS),
    no_trade_reason_code: isTrade ? null : validatorReason ? `engine_${validatorReason}` : summary[0] ? null : 'engine_no_setup',
    no_trade_reason_params: {},
    engine_version: ENGINE_VERSION,
  };
}

/** Confere o formato do contrato campo a campo. Fora do formato = null. */
export function parseEngineContract(value: unknown): EngineContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  const isLevel = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0);
  const isText = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;

  const ok =
    (c.verdict === 'BULLISH' || c.verdict === 'BEARISH' || c.verdict === 'NEUTRAL') &&
    typeof c.confidence === 'number' && Number.isInteger(c.confidence) &&
    c.confidence >= 0 && c.confidence <= 100 &&
    isText(c.asset, 40) &&
    isText(c.timeframe, 20) &&
    isLevel(c.entry) &&
    isLevel(c.stop) &&
    Array.isArray(c.targets) && c.targets.length <= 2 && c.targets.every((t) => isLevel(t) && t !== null) &&
    isLevel(c.invalidation) &&
    Array.isArray(c.key_reasons) && c.key_reasons.length <= MAX_KEY_REASONS &&
    c.key_reasons.every((r) => isText(r, MAX_REASON_CHARS)) &&
    (c.verdict === 'NEUTRAL'
      ? isText(c.no_trade_reason, MAX_NO_TRADE_CHARS) &&
        c.entry === null && c.stop === null && (c.targets as unknown[]).length === 0
      : c.no_trade_reason === null && c.entry !== null && c.stop !== null &&
        (c.targets as unknown[]).length > 0) &&
    typeof c.engine_version === 'string' && c.engine_version.length > 0;

  return ok ? (c as unknown as EngineContract) : null;
}

/** Arredonda e descarta tempo negativo/ausente (-1 no worker = etapa que nao rodou). */
function ms(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function buildEngineRecord(params: {
  contract: EngineContractInput;
  signalState: SignalState;
  dataMode: 'real_data' | 'print';
  provider?: string | null;
  validatorAction: ValidatorAction;
  validatorFlags: SignalDecisionResult['validatorFlags'];
  timings: Partial<Record<keyof EngineTimings, number | null | undefined>>;
  continuation?: boolean;
  warn: (message: string) => void;
}): EngineRecord {
  const built = buildEngineContract(params.contract);
  const contract = parseEngineContract(built);
  if (!contract) params.warn(`[engine] contrato v${ENGINE_VERSION} fora do formato; gravado sem contrato`);

  const t = params.timings;
  return {
    version: ENGINE_VERSION,
    provider: params.provider ?? null,
    data_mode: params.dataMode,
    signal_state: params.signalState,
    validator_action: params.validatorAction,
    validator_reasons: [...params.contract.validatorReasons],
    validator_flags: [...params.validatorFlags],
    ...(params.continuation ? { continuation: true as const } : {}),
    timings: {
      image_prep_ms: ms(t.image_prep_ms),
      intake_ms: ms(t.intake_ms),
      queue_ms: ms(t.queue_ms),
      prompt_ms: ms(t.prompt_ms),
      grounding_ms: ms(t.grounding_ms),
      model_ms: ms(t.model_ms),
      parse_ms: ms(t.parse_ms),
      validation_ms: ms(t.validation_ms),
      server_total_ms: ms(t.server_total_ms),
    },
    contract,
  };
}
