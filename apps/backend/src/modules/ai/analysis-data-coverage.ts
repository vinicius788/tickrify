import type { PrismaClient } from '@prisma/client';
import type { AnalysisEvidence } from '../../common/interfaces/ai-response.interface';

/** Categorias de cobertura do contexto enviado ao modelo; nunca recebem texto do usuário. */
export type CandleCoverage =
  | 'disabled'
  | 'not_attempted'
  | 'symbol_unreadable'
  | 'timeframe_unreadable'
  | 'unsupported_asset'
  | 'provider_unconfigured'
  /** Sem candles porque a cota do Twelve Data nao deixou (orcamento, minuto ou dia). */
  | 'provider_quota'
  | 'source_unavailable'
  | 'stale_withheld'
  | 'block_unavailable'
  | 'injected'
  | 'timeout'
  | 'error';

export type ContextCoverage = 'disabled' | 'not_attempted' | 'unavailable' | 'stale_withheld' | 'injected' | 'timeout' | 'error';
export type CalendarCoverage = 'disabled' | 'not_attempted' | 'symbol_unreadable' | 'events_injected' | 'no_events_returned' | 'source_degraded' | 'timeout' | 'error';
export type CoverageAssetClass = 'crypto' | 'forex' | 'metal' | 'index' | 'other' | 'unknown';

export interface AnalysisDataCoverage {
  analysisType: 'quick' | 'deep';
  htfImagesRequested: number;
  htfImagesDelivered: number;
  assetClass: CoverageAssetClass;
  candles: CandleCoverage;
  marketContext: ContextCoverage;
  calendar: CalendarCoverage;
}

const CANDLE_VALUES = new Set<CandleCoverage>([
  'disabled', 'not_attempted', 'symbol_unreadable', 'timeframe_unreadable',
  'unsupported_asset', 'provider_unconfigured', 'provider_quota', 'source_unavailable',
  'stale_withheld', 'block_unavailable', 'injected', 'timeout', 'error',
]);
const CONTEXT_VALUES = new Set<ContextCoverage>([
  'disabled', 'not_attempted', 'unavailable', 'stale_withheld', 'injected', 'timeout', 'error',
]);
const CALENDAR_VALUES = new Set<CalendarCoverage>([
  'disabled', 'not_attempted', 'symbol_unreadable', 'events_injected',
  'no_events_returned', 'source_degraded', 'timeout', 'error',
]);
const ASSET_VALUES = new Set<CoverageAssetClass>([
  'crypto', 'forex', 'metal', 'index', 'other', 'unknown',
]);

/** Só a classe sai no log; o ticker extraído da imagem nunca é registrado aqui. */
export function classifyCoverageAsset(symbol: string, isCrypto: boolean): CoverageAssetClass {
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized) return 'unknown';
  if (isCrypto) return 'crypto';
  if (/^(XAU|XAG)/.test(normalized)) return 'metal';
  if (/^(NAS100|US100|NDX|US30|DJI|US500|SPX|SPX500|DAX|GER40|UK100|FTSE|JP225|NKY|WIN|IBOV)/.test(normalized)) return 'index';
  if (/^(EUR|USD|GBP|JPY|AUD|NZD|CAD|CHF)/.test(normalized)) return 'forex';
  return 'other';
}

function boundedImageCount(value: number): number {
  return Number.isSafeInteger(value) ? Math.min(2, Math.max(0, value)) : 0;
}

export function toAnalysisEvidence(value: AnalysisDataCoverage): AnalysisEvidence {
  return {
    version: 1,
    additionalChartsDelivered: boundedImageCount(value.htfImagesDelivered),
    candleFeedAttached: value.candles === 'injected',
    marketContextAttached: value.marketContext === 'injected',
    calendar: value.calendar === 'events_injected'
      ? 'events_attached'
      : value.calendar === 'no_events_returned' ? 'no_events_returned' : 'not_confirmed',
  };
}

/** Uma linha agregável nos logs, sem símbolo, preço, imagem, prompt, id ou erro bruto. */
export function formatAnalysisDataCoverage(value: AnalysisDataCoverage): string {
  return `[AnalysisDataCoverage] ${JSON.stringify({
    schema: 2,
    analysisType: value.analysisType === 'deep' ? 'deep' : 'quick',
    htfImagesRequested: boundedImageCount(value.htfImagesRequested),
    htfImagesDelivered: boundedImageCount(value.htfImagesDelivered),
    assetClass: ASSET_VALUES.has(value.assetClass) ? value.assetClass : 'unknown',
    candles: CANDLE_VALUES.has(value.candles) ? value.candles : 'error',
    marketContext: CONTEXT_VALUES.has(value.marketContext) ? value.marketContext : 'error',
    calendar: CALENDAR_VALUES.has(value.calendar) ? value.calendar : 'error',
  })}`;
}

// ─── Telemetria por analise (12/10/2026) ────────────────────────────────────
// A re-simulacao de 12/10 mostrou que o resultado depende de onde o motor poe
// entrada e stop, e nada no banco dizia o tamanho do stop frente a volatilidade
// do grafico, nem qual snapshot do modelo respondeu. Estas duas colunas
// ("responseModel" TEXT e "groundingStats" JSONB) ficam FORA do schema.prisma
// ate existirem em producao: criadas no boot (AiService) e gravadas por SQL.

/** Numeros que o grounding do quick calculou e injetou no prompt. */
export interface GroundingNumbers {
  candles: number;
  lastClose: number | null;
  windowHigh: number | null;
  windowLow: number | null;
  atr14: number | null;
  rsi14: number | null;
  rangePosPct: number | null;
  momentumPct: number | null;
  momentumLookback: number;
  swingHighs: number[];
  swingLows: number[];
  relVolumeLast: number | null;
  volumeProfile: { poc: number; val: number; vah: number } | null;
  /** Resumo do 4h (v10.1): estrutura e fechamento contra a EMA50; null sem velas de 4h. */
  htfTrend?: HtfTrend | null;
  htfVsEma50?: 'above' | 'below' | null;
  /** Swings fractais das velas fechadas (v11): onde a invalidacao encaixa. */
  swings?: { kind: 'high' | 'low'; price: number }[];
  /** Movimento atrasado por direcao (v11, moveIsLate); null sem ATR. */
  late?: { long: boolean; short: boolean } | null;
  /** Regime de volatilidade (v11, volatilityRegime): chave da calibracao. */
  volRegime?: 'low' | 'normal' | 'high' | null;
}

export type HtfTrend = 'uptrend' | 'downtrend' | 'range';

/** O que vai para "groundingStats". `numbers` e null quando os candles nao entraram no prompt. */
export interface GroundingStats {
  v: 1;
  symbol: string;
  interval: string | null;
  coverage: CandleCoverage;
  numbers: GroundingNumbers | null;
}

export interface AnalysisTelemetry {
  respondedModel: string | null;
  groundingStats: GroundingStats | null;
}

/** Le a telemetria da resposta do adapter; qualquer coisa fora do formato vira null. */
export function telemetryFromAiSource(source: unknown): AnalysisTelemetry {
  const s = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  const model = typeof s.respondedModel === 'string' ? s.respondedModel.trim().slice(0, 100) : '';
  const stats = s.groundingStats as GroundingStats | null | undefined;
  return {
    respondedModel: model || null,
    groundingStats: stats && typeof stats === 'object' && stats.v === 1 ? stats : null,
  };
}

let telemetryWarned = false;

/**
 * Grava a telemetria da analise concluida. Nunca lanca: o worker pode rodar
 * antes de a API criar as colunas no boot, e medir nunca derruba uma analise.
 */
export async function saveAnalysisTelemetry(
  db: Pick<PrismaClient, '$executeRaw'>,
  analysisId: string,
  telemetry: AnalysisTelemetry,
  warn: (message: string) => void,
): Promise<void> {
  if (!telemetry.respondedModel && !telemetry.groundingStats) return;
  try {
    await db.$executeRaw`
      UPDATE "tickrify"."Analysis"
      SET "responseModel" = ${telemetry.respondedModel},
          "groundingStats" = ${telemetry.groundingStats ? JSON.stringify(telemetry.groundingStats) : null}::jsonb
      WHERE "id" = ${analysisId}
    `;
  } catch (err) {
    if (telemetryWarned) return;
    telemetryWarned = true;
    warn(`[telemetry] Telemetria da analise nao gravada: ${err instanceof Error ? err.message : err}`);
  }
}
