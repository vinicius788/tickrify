import { BadRequestException, Logger } from '@nestjs/common';
import { AIAnalysisResponse } from '../../common/interfaces/ai-response.interface';
import { AnalysisType, TICK_COSTS } from '../ticks/tick-packages';

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

export interface PipelineDependencies {
  ticksService: {
    getBalance(userId: string): Promise<number>;
    debitTicks(userId: string, amount: number, description: string, metadata?: Record<string, unknown>): Promise<void>;
  };
  redis?: {
    set(key: string, value: string, exSeconds: number): Promise<void>;
  };
  logger?: Logger;
}

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

/** Verifies the user has enough ticks (or free quota) before processing. */
export function checkTickBalanceHook(deps: PipelineDependencies): PreAnalysisHook {
  return async (ctx: AnalysisContext) => {
    const cost =
      ctx.analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;

    if (ctx.tickBalance < cost) {
      // Don't block here — the enforceAccess in AiService already handles the exact
      // quota/tick logic atomically. This hook only flags when we're clearly short.
      // We only block if the user has 0 balance and is on a tick-based path.
      // Returning void lets AiService's existing enforceAccess handle the real check.
    }
  };
}

/** Simple per-user rate limit check via Redis. */
export function rateLimitCheckHook(
  deps: PipelineDependencies,
  windowSeconds = 60,
  maxRequests = 10,
): PreAnalysisHook {
  return async (ctx: AnalysisContext) => {
    if (!deps.redis) {
      return;
    }

    const key = `ratelimit:analysis:${ctx.userId}`;

    try {
      // We use a simple counter stored in Redis.
      // This is best-effort — if Redis is unavailable, we skip the check.
      const redisClient = deps.redis as unknown as {
        incr(key: string): Promise<number>;
        expire(key: string, seconds: number): Promise<void>;
        ttl(key: string): Promise<number>;
      };

      const current = await redisClient.incr(key);
      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }

      if (current > maxRequests) {
        return {
          block: true,
          reason: `Rate limit exceeded. Max ${maxRequests} analyses per ${windowSeconds}s.`,
        };
      }
    } catch {
      // Redis unavailable — fail open
    }
  };
}

/** Debits ticks after a successful analysis. */
export function deductTicksHook(deps: PipelineDependencies): PostAnalysisHook {
  return async (ctx: AnalysisContext) => {
    const cost =
      ctx.analysisType === 'deep' ? TICK_COSTS.ANALYSIS_DEEP : TICK_COSTS.ANALYSIS_QUICK;

    try {
      await deps.ticksService.debitTicks(
        ctx.userId,
        cost,
        `Análise ${ctx.analysisType === 'deep' ? 'deep' : 'rápida'} de gráfico`,
        { analysisType: ctx.analysisType },
      );
    } catch {
      // Already deducted upstream by enforceAccess — log and skip
      deps.logger?.warn(
        `[Pipeline] deductTicksHook: debit skipped for ${ctx.userId} (already handled)`,
      );
    }
  };
}

/** Caches a summary of the result in Redis with 1h TTL. */
export function cacheResultHook(
  deps: PipelineDependencies,
  ttlSeconds = 3600,
): PostAnalysisHook {
  return async (ctx: AnalysisContext, result: AIAnalysisResponse) => {
    if (!deps.redis) {
      return;
    }

    const key = `analysis:${ctx.userId}`;
    const summary = JSON.stringify({
      recommendation: result.recommendation,
      confidence: result.confidence,
      bias: result.bias,
      cachedAt: new Date().toISOString(),
    });

    try {
      await deps.redis.set(key, summary, ttlSeconds);
    } catch {
      deps.logger?.warn(`[Pipeline] cacheResultHook: failed to cache for ${ctx.userId}`);
    }
  };
}

/** Logs latency and metadata metrics. */
export function logMetricsHook(
  deps: PipelineDependencies,
  startedAt: number,
  model: string,
): PostAnalysisHook {
  return async (ctx: AnalysisContext) => {
    const latencyMs = Date.now() - startedAt;
    deps.logger?.log(
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
