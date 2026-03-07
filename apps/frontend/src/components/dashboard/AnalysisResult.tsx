import { useMemo } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleHelp,
  Copy,
  Minus,
  ShieldAlert,
  SlidersVertical,
  Target,
  Zap,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import type { AIAnalysisResponse } from '@/lib/api';
import {
  calcStopPercent,
  calcTPPercent,
  confidenceToPercent,
  getRecommendationMeta,
  normalizeConfluenceScore,
} from '@/lib/trading-ui';

interface AnalysisResultProps {
  analysisData: AIAnalysisResponse | null;
  uploadedImage: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `$ ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

    return merged.filter((item, index) => {
      const normalized = item.trim();
      if (normalized.length < 15) {
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

  const currentPrice = toNumber(analysis.currentPrice);
  const entry = toNumber(analysis.entry);
  const stopLoss = toNumber(analysis.stopLoss);
  const takeProfit1 = toNumber(analysis.takeProfit1);
  const takeProfit2 = toNumber(analysis.takeProfit2);

  const stopPercent = entry !== null && stopLoss !== null ? calcStopPercent(entry, stopLoss) : null;
  const takeProfit1Percent = entry !== null && takeProfit1 !== null ? calcTPPercent(entry, takeProfit1) : null;
  const takeProfit2Percent = entry !== null && takeProfit2 !== null ? calcTPPercent(entry, takeProfit2) : null;

  const confluenceRaw = toNumber(analysis.confluenceScore);
  const confluence = confluenceRaw !== null ? normalizeConfluenceScore(confluenceRaw, 8) : null;

  const riskRewardRatioRaw = analysis.riskRewardRatio;
  const riskReward = parseRiskReward(riskRewardRatioRaw);
  const riskRewardTone = riskReward !== null && riskReward >= 2 ? 'text-[var(--signal-buy)]' : 'text-[var(--signal-hold)]';

  const timestamp = new Date(analysisData.createdAt);
  const formattedTimestamp = timestamp.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const isLive = Date.now() - timestamp.getTime() <= 5 * 60 * 1000;

  const imageUrl =
    analysisData.annotated_image_url ||
    fullResponse.annotated_image_url ||
    analysisData.original_image_url ||
    fullResponse.original_image_url ||
    analysisData.imageUrl ||
    uploadedImage ||
    null;

  const confidenceLabel = confidence >= 75 ? 'Alta' : confidence >= 50 ? 'Moderada' : 'Baixa';

  const headerToneClasses =
    recommendationMeta.tone === 'buy'
      ? 'bg-[var(--signal-buy-bg)] border-[var(--signal-buy-border)] text-[var(--signal-buy)]'
      : recommendationMeta.tone === 'sell'
        ? 'bg-[var(--signal-sell-bg)] border-[var(--signal-sell-border)] text-[var(--signal-sell)]'
        : 'bg-[var(--signal-hold-bg)] border-[var(--signal-hold-border)] text-[var(--signal-hold)]';

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

  const patternItems = useMemo(() => splitItems(analysis.identifiedPatterns), [analysis.identifiedPatterns]);
  const indicatorItems = useMemo(() => splitItems(analysis.keyIndicators), [analysis.keyIndicators]);
  const riskItems = useMemo(() => normalizeRiskFactorsForView(analysis.riskFactors), [analysis.riskFactors]);

  const headerIcon = recommendationMeta.tone === 'buy' ? ArrowUp : recommendationMeta.tone === 'sell' ? ArrowDown : Minus;
  const HeaderIcon = headerIcon;

  return (
    <div className="space-y-5">
      <Card className="surface-terminal-elevated rounded-xl fade-in-stagger" style={{ animationDelay: '0ms' }}>
        <CardContent className="space-y-4 p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3 text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <span className="font-terminal font-semibold text-[var(--text-primary)]">{symbol}</span>
              <span>•</span>
              <span className="font-terminal">{timeframe}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-terminal">{formattedTimestamp}</span>
              <span className={`inline-flex items-center gap-1 ${isLive ? 'text-[var(--signal-buy)]' : 'text-[var(--text-secondary)]'}`}>
                <span className={`h-2 w-2 rounded-full ${isLive ? 'animate-pulse bg-[var(--signal-buy)]' : 'bg-[var(--text-muted)]'}`} />
                {isLive ? 'LIVE' : 'ARQUIVADO'}
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">Relatório Técnico Institucional</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Leitura de estrutura, confluência e gestão de risco.</p>
            </div>

            <div className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${headerToneClasses}`}>
              <HeaderIcon className="h-4 w-4" />
              <span>{recommendationMeta.icon}</span>
              <span>{recommendationMeta.label}</span>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <span>
              BIAS:{' '}
              <strong className="font-medium text-[var(--text-primary)]">
                {String(analysisData.bias || marketStructure.bias || 'neutral').toUpperCase()}
              </strong>
            </span>
            <span>•</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${confidence}%`,
                    backgroundColor:
                      confidence >= 70
                        ? 'var(--signal-buy)'
                        : confidence >= 50
                          ? 'var(--signal-hold)'
                          : 'var(--signal-sell)',
                  }}
                />
              </div>
              <span className="font-terminal text-xs text-[var(--text-primary)]">{confidence}%</span>
              <span className="text-xs text-[var(--text-secondary)]">{confidenceLabel}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '80ms' }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Gráfico analisado</CardTitle>
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

          <Card className="surface-terminal rounded-xl fade-in-stagger" style={{ animationDelay: '140ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Painel técnico</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion
                type="multiple"
                defaultValue={['market-structure', 'technical-analysis', 'risk-factors']}
                className="w-full"
              >
                <AccordionItem value="market-structure" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-[var(--text-secondary)]" />
                      Estrutura de Mercado
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm text-[var(--text-secondary)]">
                    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                      <p>
                        Bias: <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.bias || analysisData.bias || 'neutral')}</span>
                      </p>
                      <p>
                        Estrutura: <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.lastStructure || 'Não informado')}</span>
                      </p>
                      <p>
                        <abbr title="Break of Structure">BOS</abbr>/<abbr title="Change of Character">CHoCH</abbr>:{' '}
                        <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.breakOfStructure || 'Não informado')}</span>
                      </p>
                      <p>
                        Zona de preço: <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.priceZone || 'Não informado')}</span>
                      </p>
                      <p>
                        <abbr title="Order Block é uma região institucional de oferta/demanda.">Order Block</abbr>:{' '}
                        <span className="font-medium text-[var(--text-primary)]">{String(marketStructure.orderBlock || 'Não informado')}</span>
                      </p>
                      {structureValidation ? (
                        <p className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-[var(--text-secondary)]">
                          {structureValidation}
                        </p>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="technical-analysis" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-[var(--text-secondary)]" />
                      Análise Técnica
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
                      Padrões Identificados
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
                      Indicadores-Chave
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
                      Fatores de Risco
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

                <AccordionItem value="opposite" className="border-[var(--border-subtle)]">
                  <AccordionTrigger className="font-semibold hover:no-underline">
                    <span className="flex items-center gap-2">
                      <CircleHelp className="h-4 w-4 text-[var(--text-secondary)]" />
                      Por que não o oposto
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {whyNotOpposite || 'Justificativa não informada pelo modelo.'}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 border-t-2 border-[var(--border-emphasis)] pt-4">
                <div className="rounded-md border border-[var(--border-emphasis)] bg-[var(--bg-overlay)] p-3">
                  <h4 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Resumo Executivo</h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
                    {executiveSummary || 'Resumo executivo não informado.'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="surface-terminal-elevated sticky top-24 h-fit rounded-xl fade-in-stagger" style={{ animationDelay: '200ms' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base tracking-wide">NÍVEIS DE OPERAÇÃO</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
              <div>
                <p className="text-xs text-[var(--text-secondary)]">R/R</p>
                <p className={`font-terminal text-base font-semibold ${riskRewardTone}`}>
                  {riskReward !== null ? `${riskReward.toFixed(1)} : 1` : String(riskRewardRatioRaw || 'N/A')}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">Confluência</p>
                <p className="font-terminal text-base font-semibold text-[var(--text-primary)]">{confluence ? confluence.display : 'N/A'}</p>
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1 transition-colors hover:bg-[var(--bg-overlay)]"
                onClick={() => void copyValue('Preço atual', currentPrice)}
              >
                <span className="text-[var(--text-secondary)]">PREÇO ATUAL</span>
                <span className="font-terminal font-semibold text-[var(--text-primary)]">{formatPrice(currentPrice)}</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded border-t border-[var(--border-subtle)] px-2 py-1 transition-colors hover:bg-[var(--bg-overlay)]"
                onClick={() => void copyValue('Entrada', entry)}
              >
                <span className="text-[var(--text-secondary)]">● ENTRADA</span>
                <span className="font-terminal font-semibold text-[var(--text-primary)]">{formatPrice(entry)}</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded border-t border-[var(--border-subtle)] px-2 py-1 transition-colors hover:bg-[var(--bg-overlay)]"
                onClick={() => void copyValue('Stop Loss', stopLoss)}
              >
                <span className="text-[var(--signal-sell)]">▼ STOP LOSS</span>
                <span className="font-terminal font-semibold text-[var(--signal-sell)]">
                  {formatPrice(stopLoss)}{' '}
                  <span className="font-terminal text-xs">{formatSignedPercent(stopPercent)}</span>
                </span>
              </button>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded border-t border-[var(--border-subtle)] px-2 py-1 transition-colors hover:bg-[var(--bg-overlay)]"
                onClick={() => void copyValue('Take Profit 1', takeProfit1)}
              >
                <span className="text-[var(--signal-buy)]">▲ TP1</span>
                <span className="font-terminal font-semibold text-[var(--signal-buy)]">
                  {formatPrice(takeProfit1)} <span className="font-terminal text-xs">{formatPositivePercent(takeProfit1Percent)}</span>
                </span>
              </button>

              <button
                type="button"
                className="flex w-full items-center justify-between rounded border-t border-[var(--border-subtle)] px-2 py-1 transition-colors hover:bg-[var(--bg-overlay)]"
                onClick={() => void copyValue('Take Profit 2', takeProfit2)}
              >
                <span className="text-[var(--signal-buy)]">▲ TP2</span>
                <span className="font-terminal font-semibold text-[var(--signal-buy)]">
                  {formatPrice(takeProfit2)} <span className="font-terminal text-xs">{formatPositivePercent(takeProfit2Percent)}</span>
                </span>
              </button>
            </div>

            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3 text-xs text-[var(--text-secondary)]">
              <div className="flex items-center gap-2">
                <Copy className="h-3.5 w-3.5" />
                Clique em qualquer nível para copiar o valor.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AnalysisResult;
