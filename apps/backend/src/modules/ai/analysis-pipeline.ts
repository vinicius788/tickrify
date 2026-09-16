import { BadRequestException, Logger } from '@nestjs/common';
import { AIAnalysisResponse } from '../../common/interfaces/ai-response.interface';
import { AnalysisType } from '../ticks/tick-packages';

export interface AnalysisContext {
  userId: string;
  imageUrl: string;
  analysisType: AnalysisType;
  tickBalance: number;
  metadata?: Record<string, unknown>;
}

export type PreAnalysisHook = (
  ctx: AnalysisContext,
) => Promise<void | { block: true; reason: string }>;

export type PostAnalysisHook = (
  ctx: AnalysisContext,
  result: AIAnalysisResponse,
) => Promise<void>;

/** Validates that the imageUrl has an acceptable scheme/format. */
export function validateImageHook(): PreAnalysisHook {
  return async (ctx: AnalysisContext) => {
    const url = String(ctx.imageUrl || '').trim();
    if (!url) {
      return { block: true, reason: 'Image URL is empty.' };
    }

    const isDataUrl = url.startsWith('data:');
    const isHttpUrl = /^https?:\/\//i.test(url);

    if (!isDataUrl && !isHttpUrl) {
      return { block: true, reason: 'Invalid image URL format.' };
    }

    if (isDataUrl) {
      const mimeMatch = url.match(/^data:([^;,]+)/);
      const mimeType = mimeMatch?.[1]?.toLowerCase() || '';
      const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/jpg']);
      if (!allowed.has(mimeType)) {
        return { block: true, reason: `Unsupported image type: ${mimeType}` };
      }

      // Rough size check: base64 overhead is ~33%
      const base64Part = url.split(',')[1] || '';
      const estimatedBytes = Math.ceil((base64Part.length * 3) / 4);
      const maxBytes = Number(process.env.MAX_IMAGE_UPLOAD_BYTES || 10 * 1024 * 1024);
      if (estimatedBytes > maxBytes) {
        return { block: true, reason: `Image exceeds maximum size of ${Math.round(maxBytes / 1024 / 1024)}MB.` };
      }
    }
  };
}

/** Logs latency and metadata metrics. */
export function logMetricsHook(
  logger: Logger | undefined,
  startedAt: number,
  model: string,
): PostAnalysisHook {
  return async (ctx: AnalysisContext) => {
    const latencyMs = Date.now() - startedAt;
    logger?.log(
      `[Metrics] analysis completed | userId=${ctx.userId} analysisType=${ctx.analysisType} model=${model} latencyMs=${latencyMs}`,
    );
  };
}

/**
 * Runs all pre-analysis hooks in sequence.
 * If any hook returns { block: true }, throws BadRequestException immediately.
 */
export async function runPreHooks(
  ctx: AnalysisContext,
  hooks: PreAnalysisHook[],
): Promise<void> {
  for (const hook of hooks) {
    const result = await hook(ctx);
    if (result && result.block) {
      throw new BadRequestException(result.reason);
    }
  }
}

/**
 * Runs all post-analysis hooks in sequence.
 * Errors in post-hooks are swallowed (best-effort side effects).
 */
export async function runPostHooks(
  ctx: AnalysisContext,
  result: AIAnalysisResponse,
  hooks: PostAnalysisHook[],
  logger?: Logger,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(ctx, result);
    } catch (err) {
      logger?.warn(
        `[Pipeline] post-hook error: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
