import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
  ImageStorageClient,
  prepareIncomingImage,
} from '../../common/utils/image-storage';

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];
const DEFAULT_FREE_ANALYSIS_LIMIT = 3;

type ApiAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private aiAdapter: AIAdapter,
  ) {}

  async createAnalysis(
    userId: string,
    imageFile?: UploadedFile,
    base64Image?: string,
    promptOverride?: string,
  ) {
    const preparedImage = this.prepareImagePayload(imageFile, base64Image);

    await this.enforceAccess(userId);
    const queueReadiness = await getAiQueueReadiness();

    if (this.isProduction() && !queueReadiness.configured) {
      throw new ServiceUnavailableException({
        code: 'queue_required',
        message: 'Redis queue is required in production.',
      });
    }

    if (this.isProduction() && !queueReadiness.connected) {
      throw new ServiceUnavailableException({
        code: 'queue_unavailable',
        message: 'Queue service is unavailable.',
      });
    }

    if (this.isProduction() && !queueReadiness.hasWorkers) {
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
      imageUrl = await storage.uploadBuffer({
        buffer: preparedImage.buffer,
        mimeType: preparedImage.mimeType,
        extension: preparedImage.extension,
        pathPrefix: `analyses/${userId}/original`,
      });
    } else if (storage.requiresRemoteStorage()) {
      throw new ServiceUnavailableException({
        code: 'storage_not_configured',
        message: 'Image storage is required in production.',
      });
    }

    const analysis = await this.prisma.analysis.create({
      data: {
        userId,
        imageUrl,
        status: 'pending',
        promptVer: promptVersion,
      },
    });

    const queue = queueReadiness.connected ? getAiQueue() : null;

    if (queue && (queueReadiness.hasWorkers || this.isProduction())) {
      await queue.add('process-analysis', {
        analysisId: analysis.id,
        imageUrl,
        promptOverride,
        promptVersion,
        userId,
      });

      return {
        id: analysis.id,
        status: 'pending',
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      };
    }

    if (this.isProduction()) {
      await this.prisma.analysis.update({
        where: { id: analysis.id },
        data: {
          status: 'failed',
          reasoning: 'Queue service unavailable in production.',
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

    return analyses.map((analysis) => {
      const normalized = normalizeStoredAnalysis(analysis);
      const analysisMeta =
        normalized.fullResponse && typeof normalized.fullResponse.analysis === 'object'
          ? (normalized.fullResponse.analysis as Record<string, unknown>)
          : null;
      const symbol =
        analysisMeta && typeof analysisMeta.symbol === 'string'
          ? (analysisMeta.symbol as string)
          : null;
      const timeframe =
        analysisMeta && typeof analysisMeta.timeframe === 'string'
          ? (analysisMeta.timeframe as string)
          : null;

      return {
        id: analysis.id,
        imageUrl: normalized.originalImageUrl,
        status: this.toApiStatus(analysis.status),
        recommendation: normalized.recommendation,
        bias: normalized.bias,
        confidence: normalized.confidence,
        symbol,
        timeframe,
        createdAt: analysis.createdAt,
      };
    });
  }

  private async processSynchronously(params: {
    analysisId: string;
    imageUrl: string;
    promptOverride?: string;
    promptVersion?: number;
    userId: string;
  }) {
    const { analysisId, imageUrl, promptOverride, promptVersion, userId } = params;

    await this.prisma.analysis.update({
      where: { id: analysisId },
      data: { status: 'processing' },
    });

    try {
      const prompt = await this.resolvePrompt(promptOverride, promptVersion);
      const aiResponse = await this.aiAdapter.analyzeImage(imageUrl, prompt);

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

      const updated = await this.prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          recommendation: normalizedPayload.recommendation as any,
          confidence: normalizedPayload.confidence,
          reasoning: normalizedPayload.reasoning,
          imageUrl: normalizedPayload.originalImageUrl,
          fullResponse: normalizedPayload.fullResponse as any,
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

    const uploadedUrl = await storage.uploadDataUrl(
      annotatedImageUrl,
      `analyses/${userId}/annotated`,
    );

    payload.annotatedImageUrl = uploadedUrl;
    payload.fullResponse.annotated_image_url = uploadedUrl;
    payload.fullResponse.drawing_failed = Boolean(payload.drawingFailed);

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

  private async enforceAccess(userId: string): Promise<void> {
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
    await this.consumeFreeQuotaSlot(userId, freeLimit);
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

  private getFreeLimit(): number {
    const configured = Number(process.env.FREE_ANALYSIS_LIMIT_PER_MONTH || DEFAULT_FREE_ANALYSIS_LIMIT);
    if (!Number.isFinite(configured) || configured < 1) {
      return DEFAULT_FREE_ANALYSIS_LIMIT;
    }
    return Math.floor(configured);
  }

  private async consumeFreeQuotaSlot(userId: string, limit: number) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

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

    if (rows.length === 0) {
      throw new HttpException(
        {
          code: 'quota_exceeded',
          message: 'Free tier monthly quota exceeded. Upgrade required to continue.',
          limit,
          period: 'monthly',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private serializeAnalysis(analysis: {
    id: string;
    imageUrl?: string | null;
    status: string;
    recommendation?: string | null;
    confidence?: number | null;
    reasoning?: string | null;
    fullResponse?: any;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const normalized = normalizeStoredAnalysis(analysis);

    return {
      id: analysis.id,
      imageUrl: normalized.originalImageUrl,
      status: this.toApiStatus(analysis.status),
      recommendation: normalized.recommendation,
      bias: normalized.bias,
      confidence: normalized.confidence,
      reasoning: normalized.reasoning,
      drawing_plan: normalized.drawingPlan,
      original_image_url: normalized.originalImageUrl,
      annotated_image_url: normalized.annotatedImageUrl,
      drawing_failed: normalized.drawingFailed,
      fullResponse: normalized.fullResponse,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
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

  private isProduction(): boolean {
    const runtime = String(process.env.APP_ENV || process.env.NODE_ENV || 'development')
      .trim()
      .toLowerCase();
    return runtime === 'production';
  }
}
