import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Minus,
  ShieldAlert,
  SlidersVertical,
  Target,
  Zap,
} from 'lucide-react';
import { useEconomicCalendar } from '@/hooks/useEconomicCalendar';
import { useMarketContext } from '@/hooks/useMarketContext';
import { PositionSizingCalculator } from './PositionSizingCalculator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { AIAnalysisResponse } from '@/lib/api';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  calcStopPercent,
  calcTPPercent,
  confidenceToPercent,
  getRecommendationMeta,
  normalizeConfluenceScore,
} from '@/lib/trading-ui';
import { asRecord } from '@/lib/utils';

interface AnalysisResultProps {
  analysisData: AIAnalysisResponse | null;
  uploadedImage: string | null;
}

type MarketSession = { name: string; abbr: string; open: boolean };

function getOpenSessions(date: Date): MarketSession[] {
  const h = date.getUTCHours() + date.getUTCMinutes() / 60;
  const inRange = (start: number, end: number) =>
    start < end ? h >= start && h < end : h >= start || h < end;
  return [
    { name: 'Sydney',    abbr: 'SYD', open: inRange(22, 7)  },
    { name: 'Tóquio',    abbr: 'TKY', open: inRange(0,  9)  },
    { name: 'Londres',   abbr: 'LDN', open: inRange(7, 16)  },
    { name: 'Nova York', abbr: 'NY',  open: inRange(13, 22) },
  ];
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const FOREX_CODES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF']);

/** Tamanho do pip se for par de forex (0.01 p/ JPY, 0.0001 demais); null se não for forex. */
function forexPipSize(symbol: string): number | null {
  const s = String(symbol || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (s.length === 6 && FOREX_CODES.has(s.slice(0, 3)) && FOREX_CODES.has(s.slice(3, 6))) {
    return s.endsWith('JPY') ? 0.01 : 0.0001;
  }
  return null;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  // Detect decimal precision needed:
  // Forex (< 500 and not integer): use 4-5 decimals (e.g. 1.1605, 149.85)
  // Crypto/Gold (>= 500): use 2 decimals
  // Very small values (< 1): use 5 decimals
  let decimals = 2;
  if (value < 1) {
    decimals = 5;
  } else if (value < 500) {
    // Forex range — detect actual decimal places in the number
    const str = value.toString();
    const decPart = str.includes('.') ? str.split('.')[1] : '';
    decimals = Math.min(Math.max(decPart.length, 4), 5);
  }
  return `$ ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)}`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  const signal = value >= 0 ? '+' : '';
  return `${signal}${value.toFixed(2)}%`;
}

function formatPositivePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `+${Math.abs(value).toFixed(2)}%`;
}

function splitItems(text: unknown): string[] {
  return String(text || '')
    .split(/[\n;,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeRiskFactorsForView(value: unknown): string[] {
  if (Array.isArray(value)) {
    const merged: string[] = [];
    for (const item of value) {
      const text = String(item || '').trim();
      if (!text) {
        continue;
      }

      if (merged.length > 0 && /^[a-záéíóúãõàâêô,]/.test(text)) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${text}`;
      } else {
        merged.push(text);
      }
    }

    return merged.map((item) => item.replace(/\s+\d+\.?\s*$/, '').trim()).filter((item, index) => {
      const normalized = item.trim();
      if (normalized.length < 15 || /^\d+\.?$/.test(item)) {
        return false;
      }
      if (index > 0 && /^[a-záéíóúãõàâêô]/.test(normalized)) {
        return false;
      }
      return true;
    });
  }

  return String(value || '')
    .split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚ])|[\n•-]+/)
    .map((item) => item.trim())
    .filter((item, index) => {
      if (item.length < 15) {
        return false;
      }
      if (index > 0 && /^[a-záéíóúãõàâêô]/.test(item)) {
        return false;
      }
      return true;
    });
}

function parseRiskReward(value: unknown): number | null {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const colonMatch = text.match(/1\s*:\s*(\d+(?:\.\d+)?)/);
  if (colonMatch) {
    return Number(colonMatch[1]);
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

const AnalysisResult = ({ analysisData, uploadedImage }: AnalysisResultProps) => {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [showInvalidation, setShowInvalidation] = useState(false);

  if (!analysisData) {
    return (
      <Card className="surface-terminal-elevated rounded-xl">
        <CardContent className="space-y-4 p-6">
          <Alert className="border-[var(--signal-hold-border)] bg-[var(--signal-hold-bg)]">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Demonstração</AlertTitle>
            <AlertDescription>
              Faça login para visualizar o resultado real de uma análise processada pela IA.
            </AlertDescription>
          </Alert>
          <div className="text-sm text-[var(--text-secondary)]">
            Nenhum resultado carregado no momento.
          </div>
        </CardContent>
      </Card>
    );
  }

  const fullResponse = asRecord(analysisData.fullResponse);
  const analysis = asRecord(fullResponse.analysis);
  const marketStructure = asRecord(analysis.marketStructure);

  const recommendationMeta = getRecommendationMeta(analysisData.recommendation);
  const confidence = confidenceToPercent(analysisData.confidence);

  const symbol = String(
    analysis.symbol || analysis.ticker || analysis.asset || fullResponse.symbol || fullResponse.ticker || 'UNKNOWN',
  ).trim() || 'UNKNOWN';
  const timeframe = String(analysis.timeframe || analysis.period || fullResponse.timeframe || 'UNKNOWN').trim() || 'UNKNOWN';
  const detectedSession = String(analysis.detectedSession || fullResponse.detectedSession || '').trim() || null;
  const sessionNote = String(analysis.sessionNote || fullResponse.sessionNote || '').trim() || null;

  const currentPrice = toNumber(analysis.currentPrice);
  const entry = toNumber(analysis.entry);
  const stopLoss = toNumber(analysis.stopLoss);
  const takeProfit1 = toNumber(analysis.takeProfit1);
  const takeProfit2 = toNumber(analysis.takeProfit2);

  const stopPercent = entry !== null && stopLoss !== null ? calcStopPercent(entry, stopLoss) : null;
  const takeProfit1Percent = entry !== null && takeProfit1 !== null ? calcTPPercent(entry, takeProfit1) : null;
  const takeProfit2Percent = entry !== null && takeProfit2 !== null ? calcTPPercent(entry, takeProfit2) : null;

  // Distância em pips (apenas forex). null em outros mercados.
  const pipSize = forexPipSize(symbol);
  const pipsBetween = (a: number | null, b: number | null): number | null =>
    pipSize && a !== null && b !== null ? Math.round(Math.abs(a - b) / pipSize) : null;
  const stopPips = pipsBetween(entry, stopLoss);
  const tp1Pips = pipsBetween(entry, takeProfit1);
  const tp2Pips = pipsBetween(entry, takeProfit2);

  const confluenceRaw = toNumber(analysis.confluenceScore);
  const confluence = confluenceRaw !== null ? normalizeConfluenceScore(confluenceRaw, 8) : null;

  // v7.0 new fields
  const invalidationLevel = toNumber(analysis.invalidationLevel);
  const invalidationNote = String(analysis.invalidationNote || '').trim() || null;
  const entryType = String(analysis.entryType || '').trim() || null;
  const entryCondition = String(analysis.entryCondition || '').trim() || null;
  const partialExitStrategy = String(analysis.partialExitStrategy || '').trim() || null;
  const tp1ClosePercent = toNumber(analysis.tp1ClosePercent);
  const tp2ClosePercent = toNumber(analysis.tp2ClosePercent);
  const breakevenTrigger = String(analysis.breakevenTrigger || '').trim() || null;
  const probabilityTp1 = toNumber(analysis.probabilityTp1);
  const probabilityTp2 = toNumber(analysis.probabilityTp2);
  const probabilityStop = toNumber(analysis.probabilityStop);
  const hasProbabilities = probabilityTp1 !== null || probabilityTp2 !== null || probabilityStop !== null;
  const hasStructuredExit = tp1ClosePercent !== null || tp2ClosePercent !== null || breakevenTrigger !== null;
  const alternativeScenario = String(analysis.alternativeScenario || '').trim() || null;
  const trendStrength = String(analysis.trendStrength || '').trim() || null;
  const trendStrengthNote = String(analysis.trendStrengthNote || '').trim() || null;
  const marketRegime = String(analysis.marketRegime || '').trim().toLowerCase() || null;
  const marketRegimeNote = String(analysis.marketRegimeNote || '').trim() || null;
  const multiTimeframeAlignment = String(analysis.multiTimeframeAlignment || '').trim() || null;

  // R/R por alvo, calculado direto dos níveis (consistente e funciona em análises antigas).
  const computeRR = (e: number | null, sl: number | null, tp: number | null): number | null => {
    if (e === null || sl === null || tp === null) return null;
    const risk = Math.abs(e - sl);
    const reward = Math.abs(tp - e);
    if (!(risk > 0) || !(reward > 0)) return null;
    return Math.round((reward / risk) * 100) / 100;
  };
  const rrTp1 = computeRR(entry, stopLoss, takeProfit1);
  const rrTp2 = computeRR(entry, stopLoss, takeProfit2);
  const riskRewardRatioRaw = analysis.riskRewardRatio;
  // valor principal exibido: alvo final (TP2) ou TP1; cai para o texto da IA se faltarem níveis.
  const riskReward = rrTp2 ?? rrTp1 ?? parseRiskReward(riskRewardRatioRaw);
  // R/R baixo (< 1.5) = vermelho + aviso; >= 2 verde; entre = amarelo.
  const riskRewardLow = riskReward !== null && riskReward < 1.5;
  const riskRewardTone = riskReward === null
    ? 'text-[var(--text-secondary)]'
    : riskReward < 1.5
      ? 'text-[var(--signal-sell)]'
      : riskReward >= 2
        ? 'text-[var(--signal-buy)]'
        : 'text-[var(--signal-hold)]';

  const timestamp = new Date(analysisData.createdAt);
  const openSessions = getOpenSessions(timestamp);
  const { events: calEvents, loading: calLoading } = useEconomicCalendar(symbol);
  const { data: liveMarket } = useMarketContext(symbol);
  const hasLiveMarket = !!liveMarket && (
    liveMarket.fundingRatePercent !== null ||
    liveMarket.openInterest !== null ||
    liveMarket.longShortRatio !== null ||
    liveMarket.fearGreedValue !== null
  );

  // #3 — Leitura automática do contexto ao vivo (não muda o sinal; só interpreta os dados).
  const liveReadings: string[] = [];
  if (liveMarket) {
    const f = liveMarket.fundingRatePercent;
    if (f !== null) {
      if (f >= 0.03) liveReadings.push('Funding alto — mercado muito comprado; cautela perto de resistências.');
      else if (f <= -0.01) liveReadings.push('Funding negativo — mercado vendido; possível squeeze de alta.');
    }
    const ls = liveMarket.longShortRatio;
    if (ls !== null) {
      if (ls >= 2) liveReadings.push('Maioria comprada (long/short alto) — risco de liquidações se o preço cair.');
      else if (ls <= 0.6) liveReadings.push('Maioria vendida — risco de short squeeze (alta rápida).');
    }
    const fg = liveMarket.fearGreedValue;
    if (fg !== null) {
      if (fg <= 25) liveReadings.push('Medo extremo — possível exaustão de venda (sinal contrário de alta).');
      else if (fg >= 75) liveReadings.push('Ganância extrema — possível topo (sinal contrário de baixa).');
    }
  }
  const formattedTimestamp = timestamp.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const imageUrl =
    analysisData.annotated_image_url ||
    fullResponse.annotated_image_url ||
    analysisData.original_image_url ||
    fullResponse.original_image_url ||
    analysisData.imageUrl ||
    uploadedImage ||
    null;

  const confidenceLabel = confidence >= 75 ? t.analysis.highConfidence : confidence >= 50 ? t.analysis.medConfidence : t.analysis.lowConfidence;

  const copyValue = async (label: string, value: number | null) => {
    if (value === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(String(value));
      toast({
        title: 'Copiado!',
        description: `${label} copiado para a área de transferência.`,
      });
    } catch (error) {
      console.error('Falha ao copiar valor:', error);
    }
  };

  const technicalAnalysis =
    String(analysis.technicalAnalysis || analysis.reasoning || analysisData.reasoning || 'Análise não disponível.').trim();
  const executiveSummary = String(analysis.executiveSummary || analysis.technicalSummary || '').trim();
  const whyNotOpposite = String(analysis.whyNotOpposite || '').trim();
  const structureValidation = String(analysis.structureValidation || '').trim();

  const patternItems = splitItems(analysis.identifiedPatterns);
  const indicatorItems = splitItems(analysis.keyIndicators);
  const riskItems = normalizeRiskFactorsForView(analysis.riskFactors);

  const headerIcon = recommendationMeta.tone === 'buy' ? ArrowUp : recommendationMeta.tone === 'sell' ? ArrowDown : Minus;
  const HeaderIcon = headerIcon;

  const signalToneClasses =
    recommendationMeta.tone === 'buy'
      ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
      : recommendationMeta.tone === 'sell'
        ? 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
        : 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]';

  const isDemo = Boolean(analysisData.isDemo);

  return (
    <div className="space-y-5">
      {/* ── Demo notice (subtle) ────────────────────────────────────── */}
      {isDemo && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 py-2.5 text-xs text-[var(--text-secondary)]">
          <span>⚠️ Análise demonstrativa — exemplo fixo, não análise real de IA.</span>
          <a href="/pricing" className="ml-3 flex-shrink-0 font-semibold text-[var(--signal-buy)] hover:underline">
            Ver planos →
          </a>
        </div>
      )}

      <Card className="surface-terminal-elevated rounded-xl fade-in-stagger" style={{ animationDelay: '0ms' }}>
        <CardContent className="p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] md:flex-nowrap md:items-center md:gap-4">
            <span className="whitespace-nowrap font-terminal font-semibold text-[var(--text-primary)]">{symbol}</span>
            <span className="whitespace-nowrap font-terminal">{timeframe}</span>
            <div className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-bold tracking-widest ${signalToneClasses}`}>
              <HeaderIcon className="h-3.5 w-3.5" strokeWidth={2.5} />
              <span>{recommendationMeta.label}</span>
            </div>
            <span>
              {t.analysis.bias.toUpperCase()}:{' '}
              <strong className="whitespace-nowrap font-medium text-[var(--text-primary)]">
                {String(analysisData.bias || marketStructure.bias || 'neutral').toUpperCase()}
              </strong>
            </span>
            <span>
              {t.analysis.confidence.toUpperCase()}:{' '}
              <strong className="font-terminal font-semibold text-[var(--text-primary)]">{confidence}%</strong>{' '}
              <span className="text-[var(--text-secondary)]">{confidenceLabel}</span>
            </span>
            <span className="whitespace-nowrap font-terminal md:ml-auto">{formattedTimestamp}</span>
            {detectedSession && (
              <span className="whitespace-nowrap rounded-sm border border-[var(--border-subtle)] px-2 py-0.5 font-terminal text-xs text-[var(--text-secondary)] uppercase">
                {detectedSession.replace('_', ' ')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0 flex-1">
          <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '80ms' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{t.analysis.chartAnalyzed}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-video overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)]">
                {imageUrl ? (
                  <img src={String(imageUrl)} alt="Gráfico analisado" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                    Imagem indisponível para esta análise.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card
          className="surface-terminal-elevated h-fit w-full rounded-xl fade-in-stagger md:sticky md:top-24 md:w-[300px] md:flex-none"
          style={{ animationDelay: '200ms' }}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base tracking-wide">{t.analysis.levels.toUpperCase()}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
              <div>
                <p className="text-xs text-[var(--text-secondary)]">R/R</p>
                <p className={`font-terminal text-base font-semibold ${riskRewardTone}`}>
                  {riskReward !== null ? `${riskReward.toFixed(1)} : 1` : String(riskRewardRatioRaw || 'N/A')}
                </p>
                {(rrTp1 !== null || rrTp2 !== null) && (
                  <p className="font-terminal text-[10px] text-[var(--text-secondary)]">
                    {rrTp1 !== null ? `TP1 ${rrTp1.toFixed(1)}` : ''}
                    {rrTp1 !== null && rrTp2 !== null ? ' · ' : ''}
                    {rrTp2 !== null ? `TP2 ${rrTp2.toFixed(1)}` : ''}
                  </p>
                )}
                {riskRewardLow && (
                  <p className="mt-0.5 font-terminal text-[10px] font-semibold text-[var(--signal-sell)]">
                    ⚠ R/R abaixo do ideal
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">{t.analysis.confluence}</p>
                <p className="font-terminal text-base font-semibold text-[var(--text-primary)]">
                  {confluence ? confluence.display : 'N/A'}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="flex items-center justify-between gap-3 rounded px-2 py-1">
                <span className="text-[var(--text-secondary)]">{t.analysis.currentPrice.toUpperCase()}</span>
                <button
                  type="button"
                  className="font-terminal font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue('Preço atual', currentPrice)}
                >
                  {formatPrice(currentPrice)}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[var(--text-secondary)]">● {t.analysis.entry.toUpperCase()}</span>
                <button
                  type="button"
                  className="font-terminal font-semibold text-[var(--text-primary)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue('Entrada', entry)}
                >
                  {formatPrice(entry)}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="whitespace-nowrap text-[var(--signal-sell)]">▼ {t.analysis.stopLoss.toUpperCase()}</span>
                <button
                  type="button"
                  className="text-right font-terminal font-semibold text-[var(--signal-sell)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue('Stop Loss', stopLoss)}
                >
                  {formatPrice(stopLoss)} <span className="font-terminal text-xs">{formatSignedPercent(stopPercent)}</span>
                  {stopPips !== null && <span className="ml-1 font-terminal text-[10px] text-[var(--signal-sell)]/70">{stopPips}p</span>}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[var(--signal-buy)]">▲ TP1</span>
                <button
                  type="button"
                  className="text-right font-terminal font-semibold text-[var(--signal-buy)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue('Take Profit 1', takeProfit1)}
                >
                  {formatPrice(takeProfit1)} <span className="font-terminal text-xs">{formatPositivePercent(takeProfit1Percent)}</span>
                  {tp1Pips !== null && <span className="ml-1 font-terminal text-[10px] text-[var(--signal-buy)]/70">{tp1Pips}p</span>}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded border-t border-[var(--border-subtle)] px-2 py-1">
                <span className="text-[var(--signal-buy)]">▲ TP2</span>
                <button
                  type="button"
                  className="text-right font-terminal font-semibold text-[var(--signal-buy)] transition-opacity hover:opacity-80"
                  onClick={() => void copyValue('Take Profit 2', takeProfit2)}
                >
                  {formatPrice(takeProfit2)} <span className="font-terminal text-xs">{formatPositivePercent(takeProfit2Percent)}</span>
                  {tp2Pips !== null && <span className="ml-1 font-terminal text-[10px] text-[var(--signal-buy)]/70">{tp2Pips}p</span>}
                </button>
              </div>

              {entryType && (
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs">
                  <span className="text-[var(--text-secondary)]">{t.analysis.entryType.toUpperCase()}: </span>
                  <span className="font-terminal font-semibold uppercase text-[var(--text-primary)]">{entryType}</span>
                  {entryCondition && <p className="mt-0.5 text-[var(--text-secondary)]">{entryCondition}</p>}
                </div>
              )}

              {invalidationLevel !== null && invalidationLevel > 0 && (
                <div className="rounded border border-[var(--signal-sell)]/30 bg-[var(--signal-sell-bg)] px-2 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowInvalidation((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                    aria-expanded={showInvalidation}
                  >
                    <span>
                      <span className="text-[var(--signal-sell)]">⚠ {t.analysis.invalidation.toUpperCase()}: </span>
                      <span className="font-terminal font-semibold text-[var(--signal-sell)]">{formatPrice(invalidationLevel)}</span>
                    </span>
                    {invalidationNote && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--signal-sell)] transition-transform ${showInvalidation ? 'rotate-180' : ''}`}
                      />
                    )}
                  </button>
                  {showInvalidation && invalidationNote && (
                    <p className="mt-1 text-[var(--signal-sell)]/70">{invalidationNote}</p>
                  )}
                </div>
              )}

              {sessionNote && (
                <p className="rounded-sm bg-[var(--bg-overlay)] px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                  {sessionNote}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '140ms' }}>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="technical-panel" className="border-none">
            <AccordionTrigger className="px-5 py-4 text-base font-semibold hover:no-underline md:px-6">
              <span className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[var(--text-secondary)]" />
                {t.analysis.technicalPanel}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5 md:px-6 md:pb-6">
              <Accordion
                type="multiple"
                defaultValue={['live-market', 'calendar', 'sessions', 'market-structure', 'technical-analysis', 'risk-factors']}
                className="w-full"
              >
                {/* ── Contexto ao vivo (cripto) ──────────────────────── */}
                {hasLiveMarket && liveMarket && (
                  <AccordionItem value="live-market" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-[var(--signal-buy)]" />
                        {t.analysis.liveMarket.title}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        {liveMarket.fundingRatePercent !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.fundingRate}</p>
                            <p className={`font-terminal font-semibold ${liveMarket.fundingRatePercent >= 0 ? 'text-[var(--signal-buy)]' : 'text-[var(--signal-sell)]'}`}>
                              {liveMarket.fundingRatePercent >= 0 ? '+' : ''}{liveMarket.fundingRatePercent.toFixed(4)}%
                            </p>
                          </div>
                        )}
                        {liveMarket.longShortRatio !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.longShort}</p>
                            <p className="font-terminal font-semibold text-[var(--text-primary)]">
                              {liveMarket.longShortRatio.toFixed(2)}
                              {liveMarket.longAccountPercent !== null && liveMarket.shortAccountPercent !== null && (
                                <span className="ml-1 text-[10px] text-[var(--text-secondary)]">
                                  ({liveMarket.longAccountPercent}% / {liveMarket.shortAccountPercent}%)
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                        {liveMarket.openInterest !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.openInterest}</p>
                            <p className="font-terminal font-semibold text-[var(--text-primary)]">
                              {liveMarket.openInterest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                          </div>
                        )}
                        {liveMarket.fearGreedValue !== null && (
                          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2">
                            <p className="text-[var(--text-secondary)]">{t.analysis.liveMarket.fearGreed}</p>
                            <p className={`font-terminal font-semibold ${liveMarket.fearGreedValue >= 55 ? 'text-[var(--signal-buy)]' : liveMarket.fearGreedValue <= 45 ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]'}`}>
                              {liveMarket.fearGreedValue}
                              {liveMarket.fearGreedClassification && (
                                <span className="ml-1 text-[10px] text-[var(--text-secondary)]">{liveMarket.fearGreedClassification}</span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                      {liveReadings.length > 0 && (
                        <ul className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2">
                          {liveReadings.map((r, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]">
                              <span className="mt-0.5 flex-shrink-0 text-[var(--signal-hold)]">▸</span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {liveMarket.binanceSymbol && (
                        <p className="mt-2 text-[10px] text-[var(--text-secondary)]">
                          Binance {liveMarket.binanceSymbol} · alternative.me
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* ── Probabilidades ─────────────────────────────────── */}
                {hasProbabilities && (
                  <AccordionItem value="probabilities" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <SlidersVertical className="h-4 w-4 text-[var(--signal-buy)]" />
                        {t.analysis.outcomeProbabilities}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
                          {probabilityTp1 !== null && <div className="h-full bg-[var(--signal-buy)]" style={{ width: `${Math.max(0, Math.min(100, probabilityTp1))}%` }} />}
                          {probabilityStop !== null && <div className="h-full bg-[var(--signal-sell)]" style={{ width: `${Math.max(0, Math.min(100, probabilityStop))}%` }} />}
                        </div>
                        <div className="mt-1.5 flex justify-between font-terminal text-xs">
                          {probabilityTp1 !== null && <span className="text-[var(--signal-buy)]">TP1 {Math.round(probabilityTp1)}%</span>}
                          {probabilityTp2 !== null && <span className="text-[var(--signal-buy)]/80">TP2 {Math.round(probabilityTp2)}%</span>}
                          {probabilityStop !== null && <span className="text-[var(--signal-sell)]">Stop {Math.round(probabilityStop)}%</span>}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* ── Eventos Econômicos ─────────────────────────────── */}
                <AccordionItem value="calendar" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-amber-400" />
                        {t.analysis.economicEvents}
                        {calEvents.some((e) => e.impact === 'High' && (e.minutesUntil ?? 999) <= 60) && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-terminal text-[10px] font-bold text-amber-400 uppercase">
                            ⚠ Alto impacto
                          </span>
                        )}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {calLoading ? (
                        <p className="text-xs text-[var(--text-secondary)]">Verificando calendário…</p>
                      ) : calEvents.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] opacity-60">
                          ✅ {t.analysis.noHighImpactEvents}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {calEvents.map((ev, i) => {
                            const isHigh = ev.impact === 'High';
                            const isSoon = (ev.minutesUntil ?? 999) <= 30;
                            const isJustHappened = (ev.minutesUntil ?? 0) < 0;
                            const borderColor = isHigh ? 'border-amber-500/40' : 'border-[var(--border-subtle)]';
                            const bgColor = isHigh ? 'bg-amber-500/6' : 'bg-[var(--bg-elevated)]';

                            let timeLabel = '';
                            if (isJustHappened) {
                              timeLabel = `Aconteceu há ${Math.abs(ev.minutesUntil ?? 0)}min`;
                            } else if ((ev.minutesUntil ?? 0) < 60) {
                              timeLabel = `Em ${ev.minutesUntil}min`;
                            } else {
                              const h = Math.floor((ev.minutesUntil ?? 0) / 60);
                              const m = (ev.minutesUntil ?? 0) % 60;
                              timeLabel = `Em ${h}h${m > 0 ? ` ${m}min` : ''}`;
                            }

                            return (
                              <div
                                key={i}
                                className={`rounded-md border px-3 py-2 text-xs ${borderColor} ${bgColor}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    {isHigh && isSoon && <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />}
                                    <span className={`font-medium ${isHigh ? 'text-amber-300' : 'text-[var(--text-primary)]'}`}>
                                      {ev.title}
                                    </span>
                                  </div>
                                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 font-terminal font-semibold ${
                                    isJustHappened
                                      ? 'bg-[var(--bg-overlay)] text-[var(--text-secondary)]'
                                      : isSoon && isHigh
                                        ? 'bg-amber-500/20 text-amber-400'
                                        : 'bg-[var(--bg-overlay)] text-[var(--text-secondary)]'
                                  }`}>
                                    {timeLabel}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center gap-3 text-[var(--text-secondary)]">
                                  <span className="rounded bg-[var(--bg-overlay)] px-1.5 py-0.5 font-terminal font-semibold">
                                    {ev.country}
                                  </span>
                                  <span className={`font-medium ${isHigh ? 'text-amber-400' : 'text-[var(--text-secondary)]'}`}>
                                    {ev.impact === 'High' ? '🔴 Alto impacto' : '🟡 Médio impacto'}
                                  </span>
                                  {ev.time && ev.time !== 'All Day' && (
                                    <span>{ev.time} ET</span>
                                  )}
                                  {isHigh && !isJustHappened && (
                                    <span className="text-amber-400/70">
                                      Pode afetar a análise
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                <AccordionItem value="sessions" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Minus className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.marketSessions}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {openSessions.map((s) => (
                        <span
                          key={s.abbr}
                          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-terminal text-xs ${
                            s.open
                              ? 'border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] text-[var(--signal-buy)]'
                              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] opacity-40'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${s.open ? 'bg-[var(--signal-buy)]' : 'bg-[var(--text-secondary)]'}`} />
                          {s.abbr} · {s.name}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-secondary)] opacity-50">
                      {t.analysis.sessionNote}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="market-structure" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.marketStructure}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-[var(--text-secondary)]">
                    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-1">
                      <p>{t.analysis.bias}: <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.bias || analysisData.bias || 'neutral')}</span></p>
                      <p>{t.analysis.structure}: <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.lastStructure || t.analysis.notInformed)}</span></p>
                      <p>
                        <abbr title="Break of Structure">BOS</abbr>/<abbr title="Change of Character">CHoCH</abbr>:{' '}
                        <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.breakOfStructure || t.analysis.notInformed)}</span>
                      </p>
                      <p>{t.analysis.priceZone}: <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.priceZone || t.analysis.notInformed)}</span></p>
                      <p>
                        <abbr title="Order Block é uma região institucional de oferta/demanda.">Order Block</abbr>:{' '}
                        <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.orderBlock || t.analysis.notInformed)}</span>
                      </p>
                      {trendStrength && (
                        <p className="border-t border-[var(--border-subtle)] pt-1 mt-1">
                          {t.analysis.trendStrength}:{' '}
                          <span className={`font-semibold ${trendStrength === 'strong' ? 'text-[var(--signal-buy)]' : trendStrength === 'weak' ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]'}`}>
                            {trendStrength === 'strong' ? t.analysis.strongTrend : trendStrength === 'weak' ? t.analysis.weakTrend : t.analysis.moderateTrend}
                          </span>
                          {trendStrengthNote && <span className="text-[var(--text-secondary)]"> — {trendStrengthNote}</span>}
                        </p>
                      )}
                      {marketRegime && (
                        <p>
                          {t.analysis.marketRegime}:{' '}
                          <span className={`font-semibold ${marketRegime === 'trending' ? 'text-[var(--signal-buy)]' : marketRegime === 'volatile' ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]'}`}>
                            {marketRegime === 'trending' ? t.analysis.regimeTrending : marketRegime === 'volatile' ? t.analysis.regimeVolatile : t.analysis.regimeRanging}
                          </span>
                          {marketRegimeNote && <span className="text-[var(--text-secondary)]"> — {marketRegimeNote}</span>}
                        </p>
                      )}
                      {multiTimeframeAlignment && (
                        <p>{t.analysis.mtfAlignment}: <span className="font-medium text-[var(--text-primary)]">{multiTimeframeAlignment}</span></p>
                      )}
                      {structureValidation ? (
                        <p className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[var(--text-secondary)]">{structureValidation}</p>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="technical-analysis" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.technicalAnalysis}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
                    {technicalAnalysis}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="patterns" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.identifiedPatterns}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {patternItems.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {patternItems.map((item) => (
                          <span
                            key={item}
                            className="rounded-sm border border-[var(--border-default)] bg-[var(--bg-overlay)] px-2 py-1 text-xs text-[var(--text-primary)]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">Nenhum padrão informado.</p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="indicators" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <SlidersVertical className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.keyIndicators}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {indicatorItems.length > 0 ? (
                      <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
                        {indicatorItems.map((item) => (
                          <li key={item} className="border-b border-[var(--border-subtle)] pb-1 last:border-none">
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">Sem indicadores detalhados.</p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="risk-factors" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-[var(--signal-sell)]" />
                      {t.analysis.riskFactors}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {riskItems.length > 0 ? (
                      <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                        {riskItems.map((item, index) => (
                          <li key={`${item}-${index}`} className="flex items-start gap-2">
                            <span className="mt-0.5 flex-shrink-0 text-[var(--signal-sell)]">●</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-[var(--text-secondary)]">Sem fatores de risco detalhados.</p>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {(partialExitStrategy || hasStructuredExit) && (
                  <AccordionItem value="exit-plan" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-[var(--signal-buy)]" />
                        {t.analysis.partialExit}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      {hasStructuredExit && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {tp1ClosePercent !== null && (
                            <span className="rounded-full border border-[var(--signal-buy)]/30 bg-[var(--signal-buy-bg)] px-2.5 py-1 font-terminal text-xs text-[var(--signal-buy)]">
                              TP1: {Math.round(tp1ClosePercent)}%
                            </span>
                          )}
                          {tp2ClosePercent !== null && (
                            <span className="rounded-full border border-[var(--signal-buy)]/30 bg-[var(--signal-buy-bg)] px-2.5 py-1 font-terminal text-xs text-[var(--signal-buy)]">
                              TP2: {Math.round(tp2ClosePercent)}%
                            </span>
                          )}
                          {breakevenTrigger && (
                            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">
                              {t.analysis.breakeven}: {breakevenTrigger}
                            </span>
                          )}
                        </div>
                      )}
                      {partialExitStrategy && (
                        <div className="rounded-md border border-[var(--signal-buy)]/20 bg-[var(--signal-buy-bg)] p-3">
                          {partialExitStrategy}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {alternativeScenario && (
                  <AccordionItem value="plan-b" className="border-[var(--border-subtle)]">
                    <AccordionTrigger className="font-semibold hover:no-underline">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        {t.analysis.planB}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                        {alternativeScenario}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                <AccordionItem value="opposite" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <CircleHelp className="h-4 w-4 text-[var(--text-secondary)]" />
                      {t.analysis.whyNotOpposite}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {whyNotOpposite || 'Justificativa não informada pelo modelo.'}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4">
                <PositionSizingCalculator entry={entry} stopLoss={stopLoss} />
              </div>

              <div className="mt-4 border-t-2 border-[var(--border-emphasis)] pt-4">
                <div className="rounded-md border border-[var(--border-emphasis)] bg-[var(--bg-overlay)] p-3">
                  <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">{t.analysis.executiveSummary}</h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
                    {executiveSummary || 'Resumo executivo não informado.'}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </div>
  );
};

export default AnalysisResult;
