/** Categorias de cobertura do contexto enviado ao modelo; nunca recebem texto do usuário. */
export type CandleCoverage =
  | 'disabled'
  | 'not_attempted'
  | 'symbol_unreadable'
  | 'timeframe_unreadable'
  | 'unsupported_asset'
  | 'provider_unconfigured'
  | 'source_unavailable'
  | 'stale_withheld'
  | 'block_unavailable'
  | 'injected'
  | 'timeout'
  | 'error';

export type ContextCoverage = 'disabled' | 'not_attempted' | 'unavailable' | 'injected' | 'timeout' | 'error';
export type CoverageAssetClass = 'crypto' | 'forex' | 'metal' | 'index' | 'other' | 'unknown';

export interface AnalysisDataCoverage {
  analysisType: 'quick' | 'deep';
  htfImagesRequested: number;
  htfImagesDelivered: number;
  assetClass: CoverageAssetClass;
  candles: CandleCoverage;
  marketContext: ContextCoverage;
}

const CANDLE_VALUES = new Set<CandleCoverage>([
  'disabled', 'not_attempted', 'symbol_unreadable', 'timeframe_unreadable',
  'unsupported_asset', 'provider_unconfigured', 'source_unavailable',
  'stale_withheld', 'block_unavailable', 'injected', 'timeout', 'error',
]);
const CONTEXT_VALUES = new Set<ContextCoverage>([
  'disabled', 'not_attempted', 'unavailable', 'injected', 'timeout', 'error',
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

/** Uma linha agregável nos logs, sem símbolo, preço, imagem, prompt, id ou erro bruto. */
export function formatAnalysisDataCoverage(value: AnalysisDataCoverage): string {
  return `[AnalysisDataCoverage] ${JSON.stringify({
    schema: 1,
    analysisType: value.analysisType === 'deep' ? 'deep' : 'quick',
    htfImagesRequested: boundedImageCount(value.htfImagesRequested),
    htfImagesDelivered: boundedImageCount(value.htfImagesDelivered),
    assetClass: ASSET_VALUES.has(value.assetClass) ? value.assetClass : 'unknown',
    candles: CANDLE_VALUES.has(value.candles) ? value.candles : 'error',
    marketContext: CONTEXT_VALUES.has(value.marketContext) ? value.marketContext : 'error',
  })}`;
}
