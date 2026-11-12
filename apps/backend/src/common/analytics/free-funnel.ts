/**
 * Eventos do funil das analises gratis, emitidos pelo BACKEND.
 *
 * Por que no backend: o PostHog do navegador so liga depois do aceite de
 * cookies, entao quem recusa some do funil inteiro. E o numero da analise
 * (1, 2 ou 3) calculado no navegador vinha de um contador que podia estar
 * defasado. Aqui o numero sai da contagem do banco, pela mesma regra que decide
 * se a pessoa ainda tem analise gratis (`common/free-quota.ts`).
 *
 * Arquivo proprio porque e usado por dois processos: o worker da fila
 * (worker/ai.worker.ts, caminho de producao) e o AiService (fallback sem fila).
 *
 * Eventos (distinctId = id do Clerk, o mesmo do identify do frontend):
 *   free_analysis_started   { analysisNumber, freeRemaining, signalsUsed, source }
 *   free_analysis_completed { analysisNumber, freeRemaining, signalsUsed, isLastFree, symbol, timeframe }
 *   free_quota_exhausted    { analysisNumber, signalsUsed }  (uma vez por usuario)
 *
 * `analysisNumber` = posicao da analise entre as gratis nao falhadas (conta WAIT).
 * `freeRemaining` = sinais (BUY/SELL) que ainda podem ser liberados.
 * `symbol`/`timeframe` = forma canonica (XAUUSD, 5m), lida de `result.engine`;
 * o evento do navegador manda o texto cru do grafico (GOLD, M5, H4).
 */
import { captureServer } from './posthog';
import { getFreeQuota, type FreeQuotaCounter } from '../free-quota';
import { normalizeSymbol } from '../utils/analysis-normalizer';
import { candleMarketOf, normalizeTimeframe } from '../../modules/market/candle-store';

type AnalysisReader = {
  analysis: {
    findUnique?: (args: { where: { id: string }; select: { result: true } }) => Promise<{ result: unknown } | null>;
  };
};

type PrismaLike = FreeQuotaCounter & AnalysisReader & {
  user: {
    findUnique: (args: { where: { id: string }; select: { clerkUserId: true } }) => Promise<{ clerkUserId: string } | null>;
  };
};

async function clerkIdFor(prisma: PrismaLike, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
  return user?.clerkUserId ?? null;
}

/** Ativo e tempo grafico canonicos da analise; null quando o motor nao leu. */
export async function chartOf(
  prisma: AnalysisReader,
  analysisId: string,
): Promise<{ symbol: string | null; timeframe: string | null }> {
  const row = await prisma.analysis.findUnique?.({ where: { id: analysisId }, select: { result: true } });
  const result = row?.result && typeof row.result === 'object' ? (row.result as Record<string, unknown>) : {};
  const engine = result.engine && typeof result.engine === 'object' ? (result.engine as Record<string, unknown>) : {};
  const asset = typeof engine.asset === 'string' && engine.asset !== 'UNKNOWN' ? engine.asset.trim() : '';
  const tf = typeof engine.timeframe === 'string' ? engine.timeframe : '';
  return {
    symbol: asset ? (candleMarketOf(asset)?.key ?? normalizeSymbol(asset).toUpperCase()) : null,
    timeframe: normalizeTimeframe(tf),
  };
}

/** Chamar logo depois de criar a linha de uma analise gratis. */
export async function trackFreeAnalysisStarted(
  prisma: PrismaLike,
  params: { userId: string; analysisId: string; createdAt?: Date; source?: 'web' | 'extension' },
): Promise<void> {
  try {
    const clerkId = await clerkIdFor(prisma, params.userId);
    if (!clerkId) return;
    const quota = await getFreeQuota(prisma, params.userId);
    captureServer(
      clerkId,
      'free_analysis_started',
      {
        analysisId: params.analysisId,
        analysisNumber: quota.totalUsed,
        freeRemaining: quota.remaining,
        signalsUsed: quota.signalsUsed,
        source: params.source ?? 'web',
      },
      { dedupeKey: `free_analysis_started:${params.analysisId}`, timestamp: params.createdAt },
    );
  } catch {
    /* analytics nunca derruba a analise */
  }
}

/** Chamar quando uma analise gratis fica `completed`. */
export async function trackFreeAnalysisCompleted(
  prisma: PrismaLike,
  params: { userId: string; analysisId: string; completedAt?: Date },
): Promise<void> {
  try {
    const clerkId = await clerkIdFor(prisma, params.userId);
    if (!clerkId) return;
    const [quota, chart] = await Promise.all([
      getFreeQuota(prisma, params.userId),
      chartOf(prisma, params.analysisId).catch(() => ({ symbol: null, timeframe: null })),
    ]);
    // So resultado conhecido esgota: analise em andamento ainda pode virar WAIT.
    const isLastFree = quota.settledExhausted;
    captureServer(
      clerkId,
      'free_analysis_completed',
      {
        analysisId: params.analysisId,
        analysisNumber: quota.totalUsed,
        freeRemaining: quota.remaining,
        signalsUsed: quota.signalsUsed,
        isLastFree,
        trial: Boolean(quota.trial),
        ...(quota.trial ? { trial_day: quota.trial.dayIndex } : {}),
        symbol: chart.symbol,
        timeframe: chart.timeframe,
      },
      { dedupeKey: `free_analysis_completed:${params.analysisId}`, timestamp: params.completedAt },
    );
    // Trial: o fim tem evento proprio (`trial_ended`, trial-funnel.ts).
    if (isLastFree && !quota.trial) {
      captureServer(
        clerkId,
        'free_quota_exhausted',
        { analysisId: params.analysisId, analysisNumber: quota.totalUsed, signalsUsed: quota.signalsUsed },
        // Uma vez por pessoa: a chave nao tem a analise.
        { dedupeKey: `free_quota_exhausted:${params.userId}`, timestamp: params.completedAt },
      );
    }
  } catch {
    /* analytics nunca derruba a analise */
  }
}
