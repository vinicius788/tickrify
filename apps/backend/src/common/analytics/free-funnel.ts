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
 *   free_analysis_completed { analysisNumber, freeRemaining, signalsUsed, isLastFree }
 *   free_quota_exhausted    { analysisNumber, signalsUsed }  (uma vez por usuario)
 *
 * `analysisNumber` = posicao da analise entre as gratis nao falhadas (conta WAIT).
 * `freeRemaining` = sinais (BUY/SELL) que ainda podem ser liberados.
 */
import { captureServer } from './posthog';
import { getFreeQuota, type FreeQuotaCounter } from '../free-quota';

type PrismaLike = FreeQuotaCounter & {
  user: {
    findUnique: (args: { where: { id: string }; select: { clerkUserId: true } }) => Promise<{ clerkUserId: string } | null>;
  };
};

async function clerkIdFor(prisma: PrismaLike, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
  return user?.clerkUserId ?? null;
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
    const quota = await getFreeQuota(prisma, params.userId);
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
      },
      { dedupeKey: `free_analysis_completed:${params.analysisId}`, timestamp: params.completedAt },
    );
    if (isLastFree) {
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
