import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../database/prisma.service';
import { getAiQueue, getAiQueueReadiness } from './ai.queue';
import { resolvePlanForPriceId } from '../../config/stripe.config';
import { AIAdapter, AIAnalysisError, scrubPromptLeak } from './ai.adapter';
import { resolveModel } from './openai-params';
import { TRADING_SYSTEM_PROMPT_V9 } from '../../common/prompts/trading-system-prompt-v9';
import { UploadedFile } from '../../common/interfaces/multer';
import { PromptBuilderService } from '../prompt/prompt-builder.service';
import {
  buildPersistedAnalysisPayload,
  normalizeStoredAnalysis,
  NormalizedPersistedAnalysis,
} from '../../common/utils/analysis-payload';
import {
  normalizeBias,
  normalizeConfidence,
  normalizeRecommendation,
  computeRiskReward,
  formatRiskReward,
} from '../../common/utils/analysis-normalizer';
import {
  ImageStorageClient,
  prepareIncomingImage,
} from '../../common/utils/image-storage';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { TICK_COSTS, AnalysisType } from '../ticks/tick-packages';
import { TicksService } from '../ticks/ticks.service';
import { MailService } from '../mail/mail.service';
import { fetchClerkEmail } from '../../common/utils/clerk-email';
import { StripeService } from '../payments/stripe.service';
import {
  AnalysisContext,
  validateImageHook,
  cacheResultHook,
  logMetricsHook,
  runPreHooks,
  runPostHooks,
} from './analysis-pipeline';

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

type ApiAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';


/**
 * A/B DE PROMPT EM PRODUÇÃO — a medição que não custa API.
 *
 * Por que existe: o backtest usa gráficos renderizados (matplotlib, sem
 * indicador, sem desenho, resolução uniforme). O usuário manda print do
 * TradingView. A limitação nº 1 do próprio relatório de backtest é justamente
 * essa: "gráfico renderizado ≠ print real de usuário". Já existe em produção o
 * sweeper que 48h depois mede TP1-antes-do-SL nos candles reais — então basta
 * marcar QUAL prompt gerou cada análise para a produção medir o A/B sozinha,
 * com print de verdade e sem gastar um centavo em teste.
 *
 * Como ligar: AB_PROMPT_V9_PERCENT=20 no env → ~20% dos usuários recebem o v9.
 * Default 0 (desligado). Qualquer valor fora de 0-100 é tratado como 0.
 *
 * Determinístico POR USUÁRIO, não por análise: o mesmo usuário fica sempre no
 * mesmo lado. Se sorteássemos por análise, o mesmo print poderia dar leituras
 * diferentes em dois cliques — e nos modelos GPT-5 não existe mais controle de
 * temperatura para atenuar isso (temperature é forçada em 1).
 *
 * promptVer = -9 marca a perna B. Negativo de propósito: nunca colide com uma
 * versão real de PromptConfig, e o /accuracy corta por esse valor.
 */
export const AB_V9_PROMPT_VER = -9;

export function resolveAbPromptVariant(userId: string): 'A' | 'B' {
  const pct = Number(process.env.AB_PROMPT_V9_PERCENT);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 'A';
  // Hash estável (FNV-1a): mesmo userId → sempre o mesmo bucket, sem estado.
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 100) < pct ? 'B' : 'A';
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  /** true quando as colunas de resultado existem no banco (verificado no boot). */
  private outcomeColumnsReady = false;

  constructor(
    private prisma: PrismaService,
    private aiAdapter: AIAdapter,
    private ticksService: TicksService,
    private promptBuilder: PromptBuilderService,
    private stripeService: StripeService,
    private mailService: MailService,
  ) {}

  /**
   * Garante (de forma idempotente e isolada) que as colunas de resultado existam.
   * Não depende do pipeline de migração e NUNCA derruba o boot: se falhar, o recurso
   * de resultado fica indisponível, mas o resto da aplicação segue normal.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "outcome" TEXT',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "pnlPercent" DOUBLE PRECISION',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "pnlAmount" DOUBLE PRECISION',
      );
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3)',
      );
      // Watchlist: favorito por análise (mesmo padrão aditivo e idempotente).
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "isFavorite" BOOLEAN NOT NULL DEFAULT false',
      );
      // Veredicto manual do trader, separado do outcome automático do sweeper.
      // Existe também como migração Prisma; isto aqui é a rede de segurança
      // (mesmo padrão das colunas acima) para o caso de a migração não rodar.
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "userVerdict" TEXT',
      );
      // Modelo da OpenAI que gerou a análise. Sem esta coluna é impossível
      // comparar calibração antes/depois de uma troca de modelo — e a migração
      // gpt-4o-mini → gpt-5.6 é obrigatória (gpt-4o desliga em 23/10/2026).
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE "tickrify"."Analysis" ADD COLUMN IF NOT EXISTS "model" TEXT',
      );
      // Índice para cortar a acurácia por versão de prompt sem varrer a tabela
      // (o A/B de prompt em produção consulta exatamente por isto).
      await this.prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS "Analysis_promptVer_outcome_idx" ON "tickrify"."Analysis"("promptVer", "outcome")',
      );
      // Backfill idempotente: move para a coluna certa os veredictos manuais
      // que ficaram presos em "outcome" antes da separação (27/07/2026).
      // Só toca em valores MINÚSCULOS — os do sweeper são MAIÚSCULOS. Depois da
      // primeira execução não há mais linhas elegíveis e isto vira no-op.
      // Efeito desejado: essas análises voltam a ter outcome NULL e o sweeper
      // as reavalia, recuperando pontos perdidos da amostra da /accuracy.
      const moved = await this.prisma.$executeRawUnsafe(
        `UPDATE "tickrify"."Analysis"
         SET "userVerdict" = "outcome", "outcome" = NULL
         WHERE "outcome" IN ('tp1', 'tp2', 'stop', 'breakeven', 'open')`,
      );
      if (Number(moved) > 0) {
        this.logger.log(`[outcome] Backfill: ${moved} veredicto(s) manual(is) movido(s) para userVerdict.`);
      }
      this.outcomeColumnsReady = true;
      this.logger.log('[outcome] Colunas de resultado prontas.');
    } catch (err) {
      this.outcomeColumnsReady = false;
      this.logger.warn(
        `[outcome] Não foi possível garantir colunas de resultado (recurso ficará indisponível): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Mapa id -> resultado, lido por SQL isolado. Nunca lança (retorna mapa vazio em falha). */
  private async getOutcomesMap(
    userId: string,
  ): Promise<Map<string, { outcome: string | null; pnlPercent: number | null; pnlAmount: number | null; isFavorite: boolean }>> {
    const map = new Map<string, { outcome: string | null; pnlPercent: number | null; pnlAmount: number | null; isFavorite: boolean }>();
    if (!this.outcomeColumnsReady) {
      return map;
    }
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; outcome: string | null; pnlPercent: number | null; pnlAmount: number | null; isFavorite: boolean | null }>
      >`SELECT "id", "userVerdict" AS "outcome", "pnlPercent", "pnlAmount", "isFavorite" FROM "tickrify"."Analysis" WHERE "userId" = ${userId}`;
      // O campo `outcome` da API é, e sempre foi, o veredicto do TRADER — agora
      // lido da coluna certa. O outcome automático do sweeper não é exposto aqui
      // (ele aparece agregado e anonimizado em GET /api/ai/accuracy).
      for (const r of rows) {
        map.set(r.id, {
          outcome: r.outcome ?? null,
          pnlPercent: r.pnlPercent ?? null,
          pnlAmount: r.pnlAmount ?? null,
          isFavorite: r.isFavorite === true,
        });
      }
    } catch (err) {
      this.logger.warn(`[outcome] Falha ao ler resultados: ${err instanceof Error ? err.message : err}`);
    }
    return map;
  }

  /** Resultado de uma única análise por id. Nunca lança (retorna null em falha). */
  private async getOutcomeById(
    id: string,
  ): Promise<{ outcome: string | null; pnlPercent: number | null; pnlAmount: number | null } | null> {
    if (!this.outcomeColumnsReady) {
      return null;
    }
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ outcome: string | null; pnlPercent: number | null; pnlAmount: number | null }>
      >`SELECT "userVerdict" AS "outcome", "pnlPercent", "pnlAmount" FROM "tickrify"."Analysis" WHERE "id" = ${id} LIMIT 1`;
      const r = rows[0];
      return r
        ? { outcome: r.outcome ?? null, pnlPercent: r.pnlPercent ?? null, pnlAmount: r.pnlAmount ?? null }
        : null;
    } catch {
      return null;
    }
  }

  async createAnalysis(
    userId: string,
    imageFile?: UploadedFile,
    base64Image?: string,
    promptOverride?: string,
    analysisType: AnalysisType = 'quick',
    userLanguage?: string,
    htfBase64Images?: string[],
  ) {
    const preparedImage = this.prepareImagePayload(imageFile, base64Image);
    const queueReadiness = await getAiQueueReadiness();

    // Deep é recurso de assinante (gpt-4o, ~15x mais caro). Conta grátis/demo
    // roda como 'quick' — mesma regra do multi-timeframe. Degradação graciosa:
    // a análise segue normal, só sem o enriquecimento deep.
    const normalizedAnalysisType: AnalysisType =
      analysisType === 'deep' && (await this.hasPaidAccess(userId)) ? 'deep' : 'quick';
    const storage = new ImageStorageClient();

    if (storage.requiresRemoteStorage() && !storage.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'storage_not_configured',
        message: 'Image storage is required in production.',
      });
    }

    // A/B de prompt em produção: fração determinística dos usuários recebe o v9.
    // Desligado por default (AB_PROMPT_V9_PERCENT ausente ou 0).
    const abVariant = promptOverride ? 'A' : resolveAbPromptVariant(userId);
    const effectivePromptOverride =
      promptOverride ?? (abVariant === 'B' ? TRADING_SYSTEM_PROMPT_V9 : undefined);

    // Paraleliza: upload da imagem + busca da versão do prompt ao mesmo tempo
    const [imageUrl, promptVersion] = await Promise.all([
      (async (): Promise<string> => {
        if (!storage.isConfigured()) {
          return preparedImage.dataUrl;
        }
        try {
          return await storage.uploadBuffer({
            buffer: preparedImage.buffer,
            mimeType: preparedImage.mimeType,
            extension: preparedImage.extension,
            pathPrefix: `analyses/${userId}/original`,
          });
        } catch (error) {
          if (isProductionRuntime()) throw error;
          this.logger.warn(
            `Storage upload failed in non-production, falling back to inline image payload: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          return preparedImage.dataUrl;
        }
      })(),
      (async (): Promise<number | undefined> => {
        if (promptOverride) return undefined;
        // Perna B marcada com o sentinela negativo — é assim que o /accuracy
        // separa v9 de v7.3 sem precisar de tabela nova.
        if (abVariant === 'B') return AB_V9_PROMPT_VER;
        const latestPrompt = await this.prisma.promptConfig.findFirst({
          where: { isActive: true },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        return latestPrompt?.version;
      })(),
    ]);

    // Upload das imagens de timeframe maior (top-down), se houver. Máx 2; falhas ignoradas.
    const htfImageUrls: string[] = [];
    if (Array.isArray(htfBase64Images) && htfBase64Images.length > 0) {
      for (const b64 of htfBase64Images.slice(0, 2)) {
        try {
          const prepared = this.prepareImagePayload(undefined, b64);
          if (!storage.isConfigured()) {
            htfImageUrls.push(prepared.dataUrl);
          } else {
            htfImageUrls.push(
              await storage.uploadBuffer({
                buffer: prepared.buffer,
                mimeType: prepared.mimeType,
                extension: prepared.extension,
                pathPrefix: `analyses/${userId}/htf`,
              }),
            );
          }
        } catch (err) {
          this.logger.warn(
            `[htf] Falha ao preparar imagem extra (ignorada): ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Only consume free quota / ticks after infrastructure/storage prerequisites are validated.
    // enforceAccessAndCreate conta a cota grátis e cria a análise na MESMA transação,
    // evitando que requisições simultâneas ultrapassem o limite gratuito.
    const { isDemo, analysis } = await this.enforceAccessAndCreate(
      userId,
      normalizedAnalysisType,
      { imageUrl, promptVer: promptVersion, model: resolveModel(normalizedAnalysisType), status: 'pending' },
    );

    const queue = queueReadiness.connected ? getAiQueue() : null;

    // Use queue when workers are available — async, fastest path.
    if (queue && queueReadiness.hasWorkers) {
      await queue.add('process-analysis', {
        analysisId: analysis.id,
        imageUrl,
        htfImageUrls,
        promptOverride: effectivePromptOverride,
        promptVersion,
        userId,
        analysisType: normalizedAnalysisType,
        isDemo,
        userLanguage,
      });

      return {
        id: analysis.id,
        status: 'pending',
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      };
    }

    // No workers available (or no queue) — process synchronously.
    // Keeps the app functional on Render Free where a separate worker service may be absent.
    this.logger.warn(
      `[AiService] No queue workers available — processing analysis ${analysis.id} synchronously.`,
    );

    return this.processSynchronously({
      analysisId: analysis.id,
      imageUrl,
      htfImageUrls,
      promptOverride: effectivePromptOverride,
      promptVersion,
      userId,
      analysisType: normalizedAnalysisType,
      userLanguage,
      isDemo,
    });
  }

  /**
   * Streaming analysis via Server-Sent Events.
   * Emits: progress (phase/pct), chunk (text delta), result (full response), error.
   * Does not use the queue — runs synchronously for immediate feedback.
   */
  async streamAnalysis(
    userId: string,
    imageFile: UploadedFile | undefined,
    base64Image: string | undefined,
    promptOverride: string | undefined,
    analysisType: AnalysisType = 'quick',
    sendEvent: (event: string, data: unknown) => void,
  ): Promise<void> {
    // Deep é recurso de assinante — mesma regra do caminho normal (createAnalysis).
    const normalizedAnalysisType: AnalysisType =
      analysisType === 'deep' && (await this.hasPaidAccess(userId)) ? 'deep' : 'quick';

    sendEvent('progress', { phase: 'uploading', pct: 0 });

    const preparedImage = this.prepareImagePayload(imageFile, base64Image);
    const storage = new ImageStorageClient();
    let imageUrl = preparedImage.dataUrl;

    if (storage.isConfigured()) {
      try {
        imageUrl = await storage.uploadBuffer({
          buffer: preparedImage.buffer,
          mimeType: preparedImage.mimeType,
          extension: preparedImage.extension,
          pathPrefix: `analyses/${userId}/original`,
        });
      } catch (error) {
        if (isProductionRuntime()) throw error;
        imageUrl = preparedImage.dataUrl;
      }
    }

    sendEvent('progress', { phase: 'uploading', pct: 20 });

    // Mesmo A/B do caminho normal — sem isto o streaming sempre usaria o v7.3
    // e a perna B ficaria com amostra torta.
    const abVariant = promptOverride ? 'A' : resolveAbPromptVariant(userId);
    const effectivePromptOverride =
      promptOverride ?? (abVariant === 'B' ? TRADING_SYSTEM_PROMPT_V9 : undefined);
    const promptVersion = promptOverride
      ? undefined
      : abVariant === 'B'
        ? AB_V9_PROMPT_VER
        : (await this.prisma.promptConfig.findFirst({
            where: { isActive: true },
            orderBy: { version: 'desc' },
            select: { version: true },
          }))?.version;

    // Mesma reserva atômica do fluxo normal. Importante: marca isDemo corretamente
    // (antes o streaming criava a análise sem isDemo, permitindo grátis ilimitado).
    const { isDemo, analysis } = await this.enforceAccessAndCreate(
      userId,
      normalizedAnalysisType,
      { imageUrl, promptVer: promptVersion, model: resolveModel(normalizedAnalysisType), status: 'processing' },
    );

    sendEvent('progress', { phase: 'analyzing', pct: 25 });

    try {
      const prompt = await this.promptBuilder.buildPromptByVersion(
        normalizedAnalysisType,
        promptVersion,
        effectivePromptOverride,
      );

      let partialText = '';
      let chunkCount = 0;
      const totalEstimatedChunks = 80;

      for await (const delta of this.aiAdapter.streamAnalyzeImage(
        imageUrl,
        prompt,
        normalizedAnalysisType,
      )) {
        partialText += delta;
        // Blindagem anti-extração: NÃO encaminhamos o texto bruto do modelo ao
        // cliente. Só progresso. Isso impede que uma tentativa de extrair o
        // system prompt apareça em tempo real no navegador.

        chunkCount++;
        const analyzingPct = Math.min(
          79,
          25 + Math.floor((chunkCount / totalEstimatedChunks) * 54),
        );
        sendEvent('progress', { phase: 'analyzing', pct: analyzingPct });
      }

      sendEvent('progress', { phase: 'structuring', pct: 80 });

      // Parse final JSON from accumulated text (same logic as analyzeImage)
      const { parseJsonFromContent } = await import('../../common/utils/analysis-normalizer');
      const parsed = parseJsonFromContent(partialText);
      if (!parsed) {
        throw new Error('AI response did not contain valid JSON.');
      }

      // Blindagem anti-extração: limpa qualquer campo de texto que tente ecoar o
      // system prompt antes de persistir/serializar o resultado deste caminho.
      if (parsed.analysis && typeof parsed.analysis === 'object') {
        const a = parsed.analysis as Record<string, unknown>;
        for (const field of [
          'reasoning',
          'executiveSummary',
          'technicalAnalysis',
          'keyIndicators',
          'identifiedPatterns',
          'structureValidation',
          'riskFactors',
          'whyNotOpposite',
        ]) {
          if (typeof a[field] === 'string') {
            a[field] = scrubPromptLeak(a[field] as string, 'Conteúdo indisponível.');
          }
        }
      }

      // Build a minimal AIAnalysisResponse from parsed data
      const {
        normalizeRecommendation,
        normalizeBias: normalizeBiasUtil,
        normalizeConfidence: normalizeConf,
        harmonizeConfidenceWithTrend: harmonizeConf,
      } = await import('../../common/utils/analysis-normalizer');
      const recommendation = normalizeRecommendation(parsed.recommendation);
      const bias = normalizeBiasUtil(parsed.analysis?.marketStructure?.bias, recommendation);
      const confidence = harmonizeConf(
        normalizeConf(parsed.confidence, 50),
        parsed.analysis?.trendStrength,
      );

      const aiResponse = {
        recommendation,
        bias,
        confidence,
        reasoning: String(parsed.analysis?.reasoning || ''),
        analysis: parsed.analysis,
        drawingPlan: null as null,
        drawingFailed: true,
        rawResponse: parsed,
        rawContent: partialText,
      };

      let normalizedPayload = buildPersistedAnalysisPayload({
        source: (parsed as Record<string, unknown>) || {},
        recommendation,
        bias,
        confidence,
        reasoning: aiResponse.reasoning,
        analysis: aiResponse.analysis,
        drawingPlan: null,
        originalImageUrl: imageUrl,
      });

      normalizedPayload = await this.persistAnnotatedImage(normalizedPayload, userId);

      const updated = await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: 'completed',
          recommendation: normalizedPayload.recommendation as any,
          confidence: normalizedPayload.confidence,
          reasoning: normalizedPayload.reasoning,
          imageUrl: normalizedPayload.originalImageUrl,
          result: normalizedPayload.fullResponse as any,
          fullResponse: partialText,
          errorMessage: null,
        },
      });

      sendEvent('progress', { phase: 'structuring', pct: 100 });
      sendEvent('result', await this.serializeAnalysis(updated));
    } catch (error) {
      const safeMessage = this.safeErrorMessage(error);
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: 'failed',
          reasoning: safeMessage,
          errorMessage: safeMessage,
          result: Prisma.DbNull,
        },
      });

      // Paid analysis failed → give the tick(s) back. Idempotent per analysisId.
      if (!isDemo) {
        const tickCost =
          normalizedAnalysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;
        try {
          await this.ticksService.refundTicks(
            userId,
            tickCost,
            'Refund: analysis failed',
            analysis.id,
          );
        } catch (refundError) {
          this.logger.error(
            `[AiService] Failed to refund ticks for analysis ${analysis.id}: ${
              refundError instanceof Error ? refundError.message : refundError
            }`,
          );
        }
      }

      sendEvent('error', {
        code: 'analysis_failed',
        message: safeMessage,
        retriable: false,
      });
    }
  }

  async getAnalysis(id: string, userId: string) {
    const analysis = await this.prisma.analysis.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!analysis) {
      throw new BadRequestException('Analysis not found');
    }

    const serialized = await this.serializeAnalysis(analysis);
    const calibration = await this.getCalibration(
      userId,
      serialized.recommendation,
      serialized.confidence,
    );
    return { ...serialized, calibration };
  }

  async listAnalyses(userId: string, limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const analyses = await this.prisma.analysis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });

    const outcomesMap = await this.getOutcomesMap(userId);

    return Promise.all(
      analyses.map(async (analysis) => {
        const fullResponse = this.getStoredAnalysisPayload(analysis);
        const operationFields = this.extractOperationFields(fullResponse, analysis.reasoning ?? null);
        const analysisMeta = operationFields.analysisMeta;
        const outcomeData = outcomesMap.get(analysis.id) ?? null;

        const symbolFromAnalysis =
          analysisMeta && typeof analysisMeta.symbol === 'string'
            ? (analysisMeta.symbol as string)
            : null;
        const timeframeFromAnalysis =
          analysisMeta && typeof analysisMeta.timeframe === 'string'
            ? (analysisMeta.timeframe as string)
            : null;

        const recommendation = normalizeRecommendation(
          analysis.recommendation ?? (fullResponse?.recommendation as string),
        );
        const bias = normalizeBias(
          (fullResponse?.bias as string) ?? operationFields.marketStructure?.bias,
          recommendation,
        );
        const confidence = normalizeConfidence(
          analysis.confidence ?? (fullResponse?.confidence as number),
          50,
        );

        const symbol =
          String(
            symbolFromAnalysis ||
              (fullResponse?.symbol as string) ||
              (fullResponse?.ticker as string) ||
              (fullResponse?.asset as string) ||
              '',
          ).trim() || 'N/A';

        const timeframe =
          String(
            timeframeFromAnalysis ||
              (analysisMeta && typeof analysisMeta.period === 'string' ? analysisMeta.period : '') ||
              (fullResponse?.timeframe as string) ||
              (fullResponse?.period as string) ||
              '',
          ).trim() || 'N/A';

        const rawImageUrl =
          String(
            analysis.imageUrl ||
              (fullResponse?.original_image_url as string) ||
              (fullResponse?.originalImageUrl as string) ||
              '',
          ).trim() || null;
        const signedImageUrl = await this.getSignedImageUrl(rawImageUrl);

        return {
          id: analysis.id,
          imageUrl: signedImageUrl,
          status: this.toApiStatus(analysis.status),
          recommendation,
          bias,
          confidence,
          symbol,
          timeframe,
          createdAt: analysis.createdAt,
          entry: operationFields.entry,
          stopLoss: operationFields.stopLoss,
          stopLossPercent: operationFields.stopLossPercent,
          takeProfit1: operationFields.takeProfit1,
          takeProfit1Percent: operationFields.takeProfit1Percent,
          takeProfit2: operationFields.takeProfit2,
          takeProfit2Percent: operationFields.takeProfit2Percent,
          reasoning: operationFields.reasoning,
          riskReward: operationFields.riskReward,
          riskRewardRatio: operationFields.riskReward,
          riskRewardTp1: operationFields.riskRewardTp1,
          riskRewardTp2: operationFields.riskRewardTp2,
          outcome: outcomeData?.outcome ?? null,
          pnlPercent: outcomeData?.pnlPercent ?? null,
          pnlAmount: outcomeData?.pnlAmount ?? null,
          isFavorite: outcomeData?.isFavorite ?? false,
        };
      }),
    );
  }

  /**
   * Marca/desmarca uma análise como favorita (Watchlist). Owner-checked.
   * Mesmo padrão tolerante do setOutcome: SQL isolado, nunca derruba nada.
   */
  async setFavorite(userId: string, id: string, isFavorite: boolean) {
    const analysis = await this.prisma.analysis.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!analysis) {
      throw new BadRequestException('Analysis not found');
    }

    if (!this.outcomeColumnsReady) {
      throw new ServiceUnavailableException(
        'Favoritos temporariamente indisponíveis. Tente novamente em instantes.',
      );
    }

    const value = isFavorite === true;
    await this.prisma.$executeRaw`
      UPDATE "tickrify"."Analysis"
      SET "isFavorite" = ${value}
      WHERE "id" = ${id} AND "userId" = ${userId}
    `;

    return { id, isFavorite: value };
  }

  /**
   * Registra o resultado de uma análise (TP1/TP2/Stop/BE/aberto + P&L manual).
   * Owner-checked. Usa SQL isolado e tolera a ausência das colunas (sem derrubar nada).
   */
  async setOutcome(
    userId: string,
    id: string,
    input: { outcome: string | null; pnlPercent?: number | null; pnlAmount?: number | null },
  ) {
    // Ownership check usando o modelo Prisma padrão (colunas garantidas).
    const analysis = await this.prisma.analysis.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!analysis) {
      throw new BadRequestException('Analysis not found');
    }

    if (!this.outcomeColumnsReady) {
      throw new ServiceUnavailableException(
        'Registro de resultado temporariamente indisponível. Tente novamente em instantes.',
      );
    }

    const VALID = ['tp1', 'tp2', 'stop', 'breakeven', 'open'];
    const outcome = input.outcome && VALID.includes(input.outcome) ? input.outcome : null;
    const pnlPercent = Number.isFinite(Number(input.pnlPercent)) ? Number(input.pnlPercent) : null;
    const pnlAmount = Number.isFinite(Number(input.pnlAmount)) ? Number(input.pnlAmount) : null;
    const closedAt = outcome ? new Date() : null;

    await this.prisma.$executeRaw`
      UPDATE "tickrify"."Analysis"
      SET "userVerdict" = ${outcome}, "pnlPercent" = ${pnlPercent}, "pnlAmount" = ${pnlAmount}, "closedAt" = ${closedAt}
      WHERE "id" = ${id} AND "userId" = ${userId}
    `;

    return { id, outcome, pnlPercent, pnlAmount };
  }

  /** Estatísticas de performance do usuário (win rate, R:R médio, contagens). */
  async getPerformance(userId: string) {
    const analyses = await this.prisma.analysis.findMany({
      where: { userId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const outcomesMap = await this.getOutcomesMap(userId);

    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let open = 0;
    let pending = 0;
    let pnlSum = 0;
    let pnlCount = 0;
    let rrSum = 0;
    let rrCount = 0;

    for (const a of analyses) {
      const outcome = outcomesMap.get(a.id)?.outcome ?? null;
      const pnl = outcomesMap.get(a.id)?.pnlPercent ?? null;
      if (pnl != null && Number.isFinite(Number(pnl))) {
        pnlSum += Number(pnl);
        pnlCount += 1;
      }

      const operationFields = this.extractOperationFields(this.getStoredAnalysisPayload(a), null);
      const rr = operationFields.riskRewardTp2 ?? operationFields.riskRewardTp1;
      if (rr != null && Number.isFinite(rr)) {
        rrSum += rr;
        rrCount += 1;
      }

      switch (outcome) {
        case 'tp1':
        case 'tp2':
          wins += 1;
          break;
        case 'stop':
          losses += 1;
          break;
        case 'breakeven':
          breakeven += 1;
          break;
        case 'open':
          open += 1;
          break;
        default:
          pending += 1;
      }
    }

    const decided = wins + losses;
    return {
      total: analyses.length,
      wins,
      losses,
      breakeven,
      open,
      pending,
      winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
      avgRiskReward: rrCount > 0 ? Math.round((rrSum / rrCount) * 100) / 100 : null,
      totalPnlPercent: pnlCount > 0 ? Math.round(pnlSum * 100) / 100 : null,
      pnlCount,
    };
  }

  /**
   * #2 — Calibração: taxa de acerto histórica de setups SEMELHANTES (mesma direção +
   * faixa de confiança parecida), a partir dos resultados registrados pelo usuário.
   * Transforma a confiança da IA em prova com dados. Nunca lança.
   */
  async getCalibration(
    userId: string,
    recommendation: string | null | undefined,
    confidence: number | null | undefined,
  ): Promise<{ sampleSize: number; winRate: number | null }> {
    const rec = normalizeRecommendation(recommendation);
    if (rec === 'WAIT') {
      return { sampleSize: 0, winRate: null };
    }

    const outcomesMap = await this.getOutcomesMap(userId);
    if (outcomesMap.size === 0) {
      return { sampleSize: 0, winRate: null };
    }

    const analyses = await this.prisma.analysis.findMany({
      where: { userId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: { id: true, confidence: true, recommendation: true },
    });

    let wins = 0;
    let losses = 0;
    for (const a of analyses) {
      if (normalizeRecommendation(a.recommendation) !== rec) continue;
      const outcome = outcomesMap.get(a.id)?.outcome;
      if (outcome !== 'tp1' && outcome !== 'tp2' && outcome !== 'stop') continue;
      // Faixa de confiança parecida (±12 pontos), quando ambos disponíveis.
      if (
        confidence != null &&
        a.confidence != null &&
        Math.abs(a.confidence - confidence) > 12
      ) {
        continue;
      }
      if (outcome === 'stop') losses += 1;
      else wins += 1;
    }

    const decided = wins + losses;
    return {
      sampleSize: decided,
      winRate: decided > 0 ? Math.round((wins / decided) * 100) : null,
    };
  }

  async getUsage(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const periodStart = this.getCurrentUsagePeriodStart();
    const paidAccess = await this.hasPaidAccess(userId);

    const usageRow = await this.prisma.analysisUsage.findUnique({
      where: {
        userId_periodType_periodStart: {
          userId,
          periodType: 'MONTH',
          periodStart,
        },
      },
      select: { count: true },
    });

    const used = usageRow?.count ?? 0;
    const tickBalance = await this.ticksService.getBalance(userId);
    const canAnalyzeWithTicks = paidAccess && tickBalance >= TICK_COSTS.ANALYSIS_QUICK;

    // Usuário grátis: o contador exibido precisa refletir EXATAMENTE o que o paywall
    // conta (análises demo não-falhas), senão fica eternamente em 0/3. A tabela
    // analysisUsage só é usada por assinantes; para o grátis a fonte de verdade são
    // as linhas Analysis isDemo=true (mesma usada em checkDemoEligibility).
    if (!paidAccess) {
      const demoUsed = await this.prisma.analysis.count({
        where: { userId, isDemo: true, status: { not: 'failed' } },
      });
      const demoTotal = AiService.DEMO_ANALYSIS_LIMIT;
      const demoRemaining = Math.max(0, demoTotal - demoUsed);
      return {
        plan: 'free',
        period: 'monthly',
        periodStart,
        total: demoTotal,
        used: demoUsed,
        remaining: demoRemaining,
        isUnlimited: false,
        tickBalance,
        canAnalyze: demoRemaining > 0,
      };
    }

    // Resolve nome real do plano (starter/pro/elite) a partir da subscription ativa
    let planName: string = 'free';
    const activeSub = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      select: { priceId: true },
      orderBy: { updatedAt: 'desc' },
    });
    const resolved = activeSub?.priceId ? resolvePlanForPriceId(activeSub.priceId) : null;
    planName = resolved ?? 'pro';

    return {
      plan: planName,
      period: 'monthly',
      periodStart,
      total: null,
      used,
      remaining: null,
      isUnlimited: true,
      tickBalance,
      canAnalyze: canAnalyzeWithTicks,
    };
  }

  private async processSynchronously(params: {
    analysisId: string;
    imageUrl: string;
    htfImageUrls?: string[];
    promptOverride?: string;
    promptVersion?: number;
    userId: string;
    analysisType: AnalysisType;
    userLanguage?: string;
    isDemo?: boolean;
  }) {
    const { analysisId, imageUrl, htfImageUrls, promptOverride, promptVersion, userId, analysisType, userLanguage, isDemo } = params;
    const startedAt = Date.now();

    await this.prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing' },
    });

    const tickBalance = await this.ticksService.getBalance(userId);
    const pipelineCtx: AnalysisContext = { userId, imageUrl, analysisType, tickBalance };

    // Pre-hooks (image validation only — access/tick checks already done in createAnalysis)
    await runPreHooks(pipelineCtx, [validateImageHook()]);

    try {
      const prompt = await this.promptBuilder.buildPromptByVersion(
        analysisType,
        promptVersion,
        promptOverride,
        userLanguage,
      );
      const aiResponse = await this.aiAdapter.analyzeImage(imageUrl, prompt, analysisType, htfImageUrls ?? []);

      let normalizedPayload = buildPersistedAnalysisPayload({
        source: (aiResponse.rawResponse as Record<string, any>) || {},
        recommendation: aiResponse.recommendation,
        bias: aiResponse.bias,
        confidence: aiResponse.confidence,
        reasoning: aiResponse.reasoning,
        analysis: aiResponse.analysis,
        drawingPlan: aiResponse.drawingPlan,
        originalImageUrl: imageUrl,
      });

      normalizedPayload = await this.persistAnnotatedImage(normalizedPayload, userId);
      const rawContent =
        typeof aiResponse.rawContent === 'string' && aiResponse.rawContent.trim().length > 0
          ? aiResponse.rawContent
          : JSON.stringify(aiResponse.rawResponse || {});

      const updated = await this.prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          recommendation: normalizedPayload.recommendation as any,
          confidence: normalizedPayload.confidence,
          reasoning: normalizedPayload.reasoning,
          imageUrl: normalizedPayload.originalImageUrl,
          result: normalizedPayload.fullResponse as any,
          fullResponse: rawContent,
          errorMessage: null,
        },
      });

      const model = resolveModel(analysisType);
      await runPostHooks(pipelineCtx, aiResponse, [
        cacheResultHook({ ticksService: this.ticksService }),
        logMetricsHook({ ticksService: this.ticksService, logger: this.logger }, startedAt, model),
      ], this.logger);

      return this.serializeAnalysis(updated);
    } catch (error) {
      const safeMessage = this.safeErrorMessage(error);
      await this.prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          reasoning: safeMessage,
          errorMessage: safeMessage,
          result: Prisma.DbNull,
        },
      });

      // Paid analysis failed → give the tick(s) back. Idempotent per analysisId.
      if (!isDemo) {
        const tickCost =
          analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;
        try {
          await this.ticksService.refundTicks(
            userId,
            tickCost,
            'Refund: analysis failed',
            analysisId,
          );
        } catch (refundError) {
          this.logger.error(
            `[AiService] Failed to refund ticks for analysis ${analysisId}: ${
              refundError instanceof Error ? refundError.message : refundError
            }`,
          );
        }
      }

      // Convert non_chart_image to a 400 HTTP exception so the frontend receives
      // a proper error code + user-friendly message instead of a generic 500.
      if (error instanceof AIAnalysisError && error.code === 'non_chart_image') {
        throw new BadRequestException({ code: 'non_chart_image', message: error.message });
      }
      throw error;
    }
  }

  private prepareImagePayload(imageFile?: UploadedFile, base64Image?: string) {
    try {
      return prepareIncomingImage(imageFile, base64Image);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid image payload');
    }
  }

  private async persistAnnotatedImage(
    payload: NormalizedPersistedAnalysis,
    userId: string,
  ): Promise<NormalizedPersistedAnalysis> {
    const annotatedImageUrl = payload.annotatedImageUrl;
    if (!annotatedImageUrl || !annotatedImageUrl.startsWith('data:')) {
      return payload;
    }

    const storage = new ImageStorageClient();

    if (!storage.isConfigured()) {
      if (storage.requiresRemoteStorage()) {
        payload.annotatedImageUrl = null;
        payload.drawingFailed = true;
        payload.fullResponse.annotated_image_url = null;
        payload.fullResponse.drawing_failed = true;
      }
      return payload;
    }

    try {
      const uploadedUrl = await storage.uploadDataUrl(
        annotatedImageUrl,
        `analyses/${userId}/annotated`,
      );

      payload.annotatedImageUrl = uploadedUrl;
      payload.fullResponse.annotated_image_url = uploadedUrl;
      payload.fullResponse.drawing_failed = Boolean(payload.drawingFailed);
    } catch (error) {
      this.logger.warn(
        `Failed to persist annotated image for user ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      payload.annotatedImageUrl = null;
      payload.drawingFailed = true;
      payload.fullResponse.annotated_image_url = null;
      payload.fullResponse.drawing_failed = true;
    }

    return payload;
  }

  /**
   * Heatmap de consistência: contagem de análises por dia (UTC) dos últimos
   * ~119 dias (17 semanas, grade estilo GitHub). O dado já existe — só agrega.
   */
  async getActivityHeatmap(userId: string): Promise<{ days: Array<{ day: string; count: number }> }> {
    const rows = await this.prisma.$queryRaw<Array<{ day: string; count: number }>>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "tickrify"."Analysis"
      WHERE "userId" = ${userId}
        AND "createdAt" > NOW() - INTERVAL '119 days'
        AND status != 'failed'
      GROUP BY 1
      ORDER BY 1
    `;
    return { days: rows.map((r) => ({ day: r.day, count: Number(r.count) })) };
  }

  static readonly DEMO_ANALYSIS_LIMIT = 3;

  /**
   * Returns true if the user still has free (demo) analyses available.
   * Failed analyses (status='failed') are NOT counted, so a failed attempt never
   * consumes one of the 3 free analyses.
   */
  async checkDemoEligibility(userId: string): Promise<boolean> {
    const demoCount = await this.prisma.analysis.count({
      where: { userId, isDemo: true, status: { not: 'failed' } },
    });
    return demoCount < AiService.DEMO_ANALYSIS_LIMIT;
  }

  private readonly DEMO_LIMIT_ERROR = {
    code: 'DEMO_LIMIT_REACHED',
    message: 'You have used your 3 free analyses. Subscribe to a plan to continue.',
  };

  /**
   * E-mail de recuperação: disparado quando o usuário grátis bate o limite.
   * Dedup permanente via AdminAudit (action 'recovery_email_sent') — zero migração.
   * Best-effort absoluto: fire-and-forget, nunca propaga erro nem atrasa a resposta.
   */
  private async triggerRecoveryEmail(userId: string): Promise<void> {
    try {
      const already = await this.prisma.adminAudit.findFirst({
        where: { action: 'recovery_email_sent', targetUserId: userId },
        select: { id: true },
      });
      if (already) return;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, clerkUserId: true },
      });
      if (!user) return;

      let email = user.email;
      if (!email) {
        // Token do Clerk não traz e-mail → busca na API e faz backfill.
        email = await fetchClerkEmail(user.clerkUserId);
        if (email) {
          await this.prisma.user
            .update({ where: { id: userId }, data: { email } })
            .catch(() => undefined);
        }
      }
      if (!email) return;

      // Registra ANTES de enviar: numa corrida, melhor perder 1 e-mail que duplicar.
      await this.prisma.adminAudit.create({
        data: {
          action: 'recovery_email_sent',
          targetUserId: userId,
          targetEmail: email,
          details: { source: 'free_limit_reached' },
        },
      });

      await this.mailService.sendRecovery(email);
      this.logger.log(`[recovery] E-mail de recuperação enviado (userId=${userId}).`);
    } catch (err) {
      this.logger.warn(
        `[recovery] Falha best-effort no e-mail de recuperação: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /**
   * Enforces plan/quota access AND creates the Analysis row atomically.
   *
   * Paid users: debits ticks (already race-safe) and creates the row.
   * Free users: counts non-failed demo analyses and creates the row inside a
   * Serializable transaction, so two concurrent requests cannot both slip past
   * the 3-free limit. Failed analyses don't count, so a failed attempt is never
   * charged against the free quota.
   */
  private async enforceAccessAndCreate(
    userId: string,
    analysisType: AnalysisType,
    rowData: { imageUrl: string; promptVer?: number; model?: string; status: ApiAnalysisStatus },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const tickCost =
      analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;

    if (await this.hasPaidAccess(userId)) {
      // Assinante: consome ticks do plano mensal (débito atômico).
      await this.ticksService.debitTicks(
        userId,
        tickCost,
        `Análise ${analysisType === 'deep' ? 'deep' : 'rápida'} de gráfico`,
        { analysisType },
      );

      const analysis = await this.prisma.analysis.create({
        data: {
          userId,
          imageUrl: rowData.imageUrl,
          status: rowData.status,
          promptVer: rowData.promptVer,
          model: rowData.model,
          isDemo: false,
        },
      });

      return { isDemo: false, analysis };
    }

    // Sem assinatura: reserva atômica de UMA das análises grátis.
    // Contagem + criação na mesma transação serializável garantem que requisições
    // simultâneas não consigam ultrapassar o limite gratuito.
    try {
      const analysis = await this.prisma.$transaction(
        async (tx) => {
          const used = await tx.analysis.count({
            where: { userId, isDemo: true, status: { not: 'failed' } },
          });

          if (used >= AiService.DEMO_ANALYSIS_LIMIT) {
            throw new ForbiddenException(this.DEMO_LIMIT_ERROR);
          }

          return tx.analysis.create({
            data: {
              userId,
              imageUrl: rowData.imageUrl,
              status: rowData.status,
              promptVer: rowData.promptVer,
              model: rowData.model,
              isDemo: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return { isDemo: true, analysis };
    } catch (error) {
      if (error instanceof ForbiddenException) {
        // Limite grátis atingido → e-mail de recuperação (1x por usuário, fire-and-forget).
        void this.triggerRecoveryEmail(userId);
        throw error;
      }

      // Conflito de serialização (P2034): uma requisição concorrente ficou com a
      // última vaga grátis — tratamos como limite atingido.
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code || '')
          : '';
      if (code === 'P2034') {
        void this.triggerRecoveryEmail(userId);
        throw new ForbiddenException(this.DEMO_LIMIT_ERROR);
      }

      throw error;
    }
  }

  private async hasPaidAccess(userId: string): Promise<boolean> {
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ACTIVE_SUBSCRIPTION_STATUSES,
        },
      },
      select: { id: true, priceId: true },
    });

    if (activeSubscription) {
      // Ensure ticks are initialized — handles webhook-miss on first analysis
      await this.stripeService.ensureTicksForActiveSubscriber(userId, activeSubscription.priceId);
      return true;
    }

    // Fallback: webhook may have been missed — check Stripe API directly
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) return false;

    return this.stripeService.syncActiveSubscriptionFromStripe(userId, user.stripeCustomerId);
  }

  private getCurrentUsagePeriodStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  }

  private async serializeAnalysis(analysis: {
    id: string;
    imageUrl?: string | null;
    status: string;
    recommendation?: string | null;
    confidence?: number | null;
    reasoning?: string | null;
    result?: unknown;
    fullResponse?: unknown;
    errorMessage?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const normalized = normalizeStoredAnalysis(analysis);
    const signedOriginalImageUrl = await this.getSignedImageUrl(normalized.originalImageUrl);
    const signedAnnotatedImageUrl = await this.getSignedImageUrl(normalized.annotatedImageUrl);
    const storedPayload = this.getStoredAnalysisPayload(analysis);
    const operationFields = this.extractOperationFields(
      storedPayload ?? normalized.fullResponse,
      analysis.errorMessage || normalized.reasoning,
    );
    const outcomeData = await this.getOutcomeById(analysis.id);

    return {
      id: analysis.id,
      imageUrl: signedOriginalImageUrl,
      status: this.toApiStatus(analysis.status),
      recommendation: normalized.recommendation,
      bias: normalized.bias,
      confidence: normalized.confidence,
      reasoning: analysis.errorMessage || normalized.reasoning,
      drawing_plan: normalized.drawingPlan,
      original_image_url: signedOriginalImageUrl,
      annotated_image_url: signedAnnotatedImageUrl,
      drawing_failed: normalized.drawingFailed,
      fullResponse: normalized.fullResponse,
      entry: operationFields.entry,
      stopLoss: operationFields.stopLoss,
      stopLossPercent: operationFields.stopLossPercent,
      takeProfit1: operationFields.takeProfit1,
      takeProfit1Percent: operationFields.takeProfit1Percent,
      takeProfit2: operationFields.takeProfit2,
      takeProfit2Percent: operationFields.takeProfit2Percent,
      riskReward: operationFields.riskReward,
      riskRewardRatio: operationFields.riskReward,
      riskRewardTp1: operationFields.riskRewardTp1,
      riskRewardTp2: operationFields.riskRewardTp2,
      outcome: outcomeData?.outcome ?? null,
      pnlPercent: outcomeData?.pnlPercent ?? null,
      pnlAmount: outcomeData?.pnlAmount ?? null,
      errorMessage: analysis.errorMessage || null,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  }

  private async getSignedImageUrl(rawUrl: string | null): Promise<string | null> {
    if (!rawUrl) {
      return null;
    }

    if (rawUrl.startsWith('data:')) {
      return rawUrl;
    }

    let storagePath = rawUrl.trim();
    if (!storagePath) {
      return null;
    }

    if (storagePath.startsWith('http')) {
      const match = storagePath.match(/analysis-images\/(.+?)(\?|$)/);
      if (match?.[1]) {
        storagePath = decodeURIComponent(match[1]);
      } else {
        return storagePath;
      }
    }

    const supabaseUrl = process.env.SUPABASE_URL?.trim() || '';
    const supabaseServiceKey =
      process.env.SUPABASE_SERVICE_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      '';

    if (!supabaseUrl || !supabaseServiceKey) {
      this.logger.warn('[AiService] Missing Supabase configuration while signing image URL.');
      return null;
    }

    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'analysis-images';
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);

      if (error || !data?.signedUrl) {
        this.logger.warn(
          `[AiService] Failed to generate signed URL for ${storagePath}: ${
            error?.message || 'signed URL unavailable'
          }`,
        );
        return null;
      }

      return data.signedUrl;
    } catch (error) {
      this.logger.warn(
        `[AiService] getSignedImageUrl error: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private getStoredAnalysisPayload(analysis: {
    result?: unknown;
    fullResponse?: unknown;
  }): Record<string, unknown> | null {
    if (analysis.result && typeof analysis.result === 'object' && !Array.isArray(analysis.result)) {
      return analysis.result as Record<string, unknown>;
    }

    if (
      analysis.fullResponse &&
      typeof analysis.fullResponse === 'object' &&
      !Array.isArray(analysis.fullResponse)
    ) {
      return analysis.fullResponse as Record<string, unknown>;
    }

    if (typeof analysis.fullResponse === 'string') {
      try {
        const parsed = JSON.parse(analysis.fullResponse);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private toNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private extractOperationFields(
    fullResponse: Record<string, unknown> | null,
    fallbackReasoning?: string | null,
  ): {
    analysisMeta: Record<string, unknown> | null;
    marketStructure: Record<string, unknown> | null;
    entry: number | null;
    stopLoss: number | null;
    stopLossPercent: number | null;
    takeProfit1: number | null;
    takeProfit1Percent: number | null;
    takeProfit2: number | null;
    takeProfit2Percent: number | null;
    reasoning: string | null;
    riskReward: string | null;
    riskRewardTp1: number | null;
    riskRewardTp2: number | null;
  } {
    const analysisMeta = this.asRecord(fullResponse?.analysis);
    const marketStructure = this.asRecord(analysisMeta?.marketStructure);

    const entry = this.toNullableNumber(
      analysisMeta?.entry ??
        analysisMeta?.entryPrice ??
        analysisMeta?.entry_price ??
        fullResponse?.entry ??
        fullResponse?.entryPrice ??
        fullResponse?.entry_price,
    );
    const stopLoss = this.toNullableNumber(
      analysisMeta?.stopLoss ??
        analysisMeta?.stop_loss ??
        fullResponse?.stopLoss ??
        fullResponse?.stop_loss,
    );
    const stopLossPercent = this.toNullableNumber(
      analysisMeta?.stopLossPercent ?? analysisMeta?.stop_loss_percent ?? fullResponse?.stopLossPercent,
    );
    const takeProfit1 = this.toNullableNumber(
      analysisMeta?.takeProfit1 ??
        analysisMeta?.take_profit_1 ??
        fullResponse?.takeProfit1 ??
        fullResponse?.take_profit_1,
    );
    const takeProfit1Percent = this.toNullableNumber(
      analysisMeta?.takeProfit1Percent ??
        analysisMeta?.take_profit_1_percent ??
        fullResponse?.takeProfit1Percent,
    );
    const takeProfit2 = this.toNullableNumber(
      analysisMeta?.takeProfit2 ??
        analysisMeta?.take_profit_2 ??
        fullResponse?.takeProfit2 ??
        fullResponse?.take_profit_2,
    );
    const takeProfit2Percent = this.toNullableNumber(
      analysisMeta?.takeProfit2Percent ??
        analysisMeta?.take_profit_2_percent ??
        fullResponse?.takeProfit2Percent,
    );
    const reasoning =
      this.toNullableString(fallbackReasoning) ??
      this.toNullableString(analysisMeta?.reasoning) ??
      this.toNullableString(fullResponse?.reasoning);
    // R/R recalculado a partir dos níveis (determinístico). Também corrige análises
    // antigas retroativamente, pois recalcula a partir dos números já armazenados.
    const riskRewardTp1 = computeRiskReward(entry, stopLoss, takeProfit1);
    const riskRewardTp2 = computeRiskReward(entry, stopLoss, takeProfit2);

    const aiRiskReward =
      this.toNullableString(
        analysisMeta?.riskReward ?? analysisMeta?.risk_reward ?? analysisMeta?.riskRewardRatio,
      ) ??
      this.toNullableString(
        fullResponse?.riskReward ?? fullResponse?.risk_reward ?? fullResponse?.riskRewardRatio,
      );
    const riskReward = formatRiskReward(riskRewardTp2 ?? riskRewardTp1) ?? aiRiskReward;

    return {
      analysisMeta,
      marketStructure,
      entry,
      stopLoss,
      stopLossPercent,
      takeProfit1,
      takeProfit1Percent,
      takeProfit2,
      takeProfit2Percent,
      reasoning,
      riskReward,
      riskRewardTp1,
      riskRewardTp2,
    };
  }

  private toApiStatus(status: string): ApiAnalysisStatus {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'done' || normalized === 'completed') {
      return 'completed';
    }
    if (normalized === 'failed') {
      return 'failed';
    }
    if (normalized === 'processing') {
      return 'processing';
    }
    return 'pending';
  }

  private safeErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse() as { message?: string | string[] } | string;
      if (typeof response === 'string') {
        return response;
      }
      if (Array.isArray(response?.message)) {
        return response.message.join(', ');
      }
      if (typeof response?.message === 'string') {
        return response.message;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Failed to process analysis';
  }
}
