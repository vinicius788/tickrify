import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { getAiQueue, getAiQueueReadiness } from './ai.queue';
import { AIAdapter } from './ai.adapter';
import { TRADING_SYSTEM_PROMPT } from '../../common/prompts/trading-system-prompt';
import { UploadedFile } from '../../common/interfaces/multer';
import {
  buildPersistedAnalysisPayload,
  normalizeStoredAnalysis,
  NormalizedPersistedAnalysis,
} from '../../common/utils/analysis-payload';
import {
  normalizeBias,
  normalizeConfidence,
  normalizeRecommendation,
} from '../../common/utils/analysis-normalizer';
import {
  ImageStorageClient,
  prepareIncomingImage,
} from '../../common/utils/image-storage';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { TICK_COSTS, AnalysisType } from '../ticks/tick-packages';
import { TicksService } from '../ticks/ticks.service';

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];
const DEFAULT_FREE_ANALYSIS_LIMIT = 3;

type ApiAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private prisma: PrismaService,
    private aiAdapter: AIAdapter,
    private ticksService: TicksService,
  ) {}

  async createAnalysis(
    userId: string,
    imageFile?: UploadedFile,
    base64Image?: string,
    promptOverride?: string,
    analysisType: AnalysisType = 'quick',
  ) {
    const preparedImage = this.prepareImagePayload(imageFile, base64Image);
    const queueReadiness = await getAiQueueReadiness();

    if (isProductionRuntime() && !queueReadiness.configured) {
      throw new ServiceUnavailableException({
        code: 'queue_required',
        message: 'Redis queue is required in production.',
      });
    }

    if (isProductionRuntime() && !queueReadiness.connected) {
      throw new ServiceUnavailableException({
        code: 'queue_unavailable',
        message: 'Queue service is unavailable.',
      });
    }

    if (isProductionRuntime() && !queueReadiness.hasWorkers) {
      throw new ServiceUnavailableException({
        code: 'worker_unavailable',
        message: 'Queue worker is unavailable.',
      });
    }

    let promptVersion: number | undefined;
    if (!promptOverride) {
      const latestPrompt = await this.prisma.promptConfig.findFirst({
        where: { isActive: true },
        orderBy: { version: 'desc' },
      });
      promptVersion = latestPrompt?.version;
    }

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
        if (isProductionRuntime()) {
          throw error;
        }

        this.logger.warn(
          `Storage upload failed in non-production, falling back to inline image payload: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        imageUrl = preparedImage.dataUrl;
      }
    } else if (storage.requiresRemoteStorage()) {
      throw new ServiceUnavailableException({
        code: 'storage_not_configured',
        message: 'Image storage is required in production.',
      });
    }

    // Only consume free quota / ticks after infrastructure/storage prerequisites are validated.
    const normalizedAnalysisType: AnalysisType = analysisType === 'deep' ? 'deep' : 'quick';
    await this.enforceAccess(userId, normalizedAnalysisType);

    const analysis = await this.prisma.analysis.create({
      data: {
        userId,
        imageUrl,
        status: 'pending',
        promptVer: promptVersion,
      },
    });

    const queue = queueReadiness.connected ? getAiQueue() : null;

    if (queue && (queueReadiness.hasWorkers || isProductionRuntime())) {
      await queue.add('process-analysis', {
        analysisId: analysis.id,
        imageUrl,
        promptOverride,
        promptVersion,
        userId,
        analysisType: normalizedAnalysisType,
      });

      return {
        id: analysis.id,
        status: 'pending',
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      };
    }

    if (isProductionRuntime()) {
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: 'failed',
          reasoning: 'Queue service unavailable in production.',
          errorMessage: 'Queue service unavailable in production.',
          result: Prisma.DbNull,
        },
      });

      throw new ServiceUnavailableException({
        code: queueReadiness.configured ? 'worker_unavailable' : 'queue_required',
        message: 'Queue processing is required in production.',
      });
    }

    return this.processSynchronously({
      analysisId: analysis.id,
      imageUrl,
      promptOverride,
      promptVersion,
      userId,
      analysisType: normalizedAnalysisType,
    });
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

    return this.serializeAnalysis(analysis);
  }

  async listAnalyses(userId: string, limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const analyses = await this.prisma.analysis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });

    return Promise.all(
      analyses.map(async (analysis) => {
        const fullResponse = this.getStoredAnalysisPayload(analysis);
        const analysisMeta =
          fullResponse && typeof fullResponse.analysis === 'object'
            ? (fullResponse.analysis as Record<string, unknown>)
            : null;
      const symbolFromAnalysis =
        analysisMeta && typeof analysisMeta.symbol === 'string'
          ? (analysisMeta.symbol as string)
          : null;
      const timeframeFromAnalysis =
        analysisMeta && typeof analysisMeta.timeframe === 'string'
          ? (analysisMeta.timeframe as string)
          : null;

      const marketStructure =
        analysisMeta && typeof analysisMeta.marketStructure === 'object'
          ? (analysisMeta.marketStructure as Record<string, unknown>)
          : null;
      const recommendation = normalizeRecommendation(
        analysis.recommendation ?? (fullResponse?.recommendation as string),
      );
      const bias = normalizeBias(
        (fullResponse?.bias as string) ?? marketStructure?.bias,
        recommendation,
      );
      const confidence = normalizeConfidence(
        analysis.confidence ?? (fullResponse?.confidence as number),
        50,
      );

      const symbol = String(
        symbolFromAnalysis ||
          (fullResponse?.symbol as string) ||
          (fullResponse?.ticker as string) ||
          (fullResponse?.asset as string) ||
          '',
      ).trim() || 'N/A';

      const timeframe = String(
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
      };
      }),
    );
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
    const freeLimit = this.getFreeLimit();
    const paidAccess = await this.hasPaidAccess(userId);
    const freeUnlimited = freeLimit === null;

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
    const canAnalyzeWithTicks = tickBalance >= TICK_COSTS.ANALYSIS_QUICK;

    return {
      plan: paidAccess ? 'pro' : 'free',
      period: 'monthly',
      periodStart,
      total: paidAccess || freeUnlimited ? null : freeLimit,
      used,
      remaining: paidAccess || freeUnlimited ? null : Math.max(0, freeLimit - used),
      isUnlimited: paidAccess || freeUnlimited,
      tickBalance,
      canAnalyze: paidAccess || freeUnlimited || used < freeLimit || canAnalyzeWithTicks,
    };
  }

  private async processSynchronously(params: {
    analysisId: string;
    imageUrl: string;
    promptOverride?: string;
    promptVersion?: number;
    userId: string;
    analysisType: AnalysisType;
  }) {
    const { analysisId, imageUrl, promptOverride, promptVersion, userId, analysisType } = params;

    await this.prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing' },
    });

    try {
      const prompt = await this.resolvePrompt(promptOverride, promptVersion);
      const aiResponse = await this.aiAdapter.analyzeImage(imageUrl, prompt, analysisType);

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

  private async resolvePrompt(promptOverride?: string, promptVersion?: number): Promise<string> {
    if (promptOverride) {
      return promptOverride;
    }

    if (promptVersion) {
      const promptConfig = await this.prisma.promptConfig.findUnique({
        where: { version: promptVersion },
      });
      if (promptConfig?.prompt) {
        return promptConfig.prompt;
      }
    }

    const latestPrompt = await this.prisma.promptConfig.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });

    return latestPrompt?.prompt || TRADING_SYSTEM_PROMPT;
  }

  private async enforceAccess(userId: string, analysisType: AnalysisType): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    if (await this.hasPaidAccess(userId)) {
      return;
    }

    const freeLimit = this.getFreeLimit();
    if (freeLimit === null) {
      return;
    }

    const isQuickAnalysis = analysisType !== 'deep';
    if (isQuickAnalysis) {
      const consumed = await this.consumeFreeQuotaSlot(userId, freeLimit);
      if (consumed) {
        return;
      }
    }

    const tickCost =
      analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;

    await this.ticksService.debitTicks(
      userId,
      tickCost,
      `Análise ${analysisType === 'deep' ? 'deep' : 'rápida'} de gráfico`,
      { analysisType },
    );
  }

  private async hasPaidAccess(userId: string): Promise<boolean> {
    const activeSubscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: {
          in: ACTIVE_SUBSCRIPTION_STATUSES,
        },
      },
      select: { id: true },
    });

    return Boolean(activeSubscription);
  }

  private getFreeLimit(): number | null {
    const configured = Number(process.env.FREE_ANALYSIS_LIMIT_PER_MONTH || DEFAULT_FREE_ANALYSIS_LIMIT);
    if (!Number.isFinite(configured)) {
      return DEFAULT_FREE_ANALYSIS_LIMIT > 0 ? DEFAULT_FREE_ANALYSIS_LIMIT : null;
    }

    const normalized = Math.floor(configured);
    if (normalized <= 0) {
      return null;
    }

    return normalized;
  }

  private async consumeFreeQuotaSlot(userId: string, limit: number): Promise<boolean> {
    const periodStart = this.getCurrentUsagePeriodStart();

    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      INSERT INTO "tickrify"."AnalysisUsage"
        ("id", "userId", "periodType", "periodStart", "count", "createdAt", "updatedAt")
      VALUES
        (${randomUUID()}, ${userId}, 'MONTH', ${periodStart}, 1, NOW(), NOW())
      ON CONFLICT ("userId", "periodType", "periodStart")
      DO UPDATE SET
        "count" = "AnalysisUsage"."count" + 1,
        "updatedAt" = NOW()
      WHERE "AnalysisUsage"."count" < ${limit}
      RETURNING "count"
    `);

    return rows.length > 0;
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
