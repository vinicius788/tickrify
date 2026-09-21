/**
 * Eventos do funil das 3 analises gratis, emitidos pelo BACKEND.
 *
 * Por que no backend: o PostHog do navegador so liga depois do aceite de
 * cookies, entao quem recusa some do funil inteiro. E o numero da analise
 * (1, 2 ou 3) calculado no navegador vinha de um contador que podia estar
 * defasado. Aqui o numero sai da contagem do banco, a mesma regra que decide
 * se a pessoa ainda tem analise gratis.
 *
 * Arquivo proprio porque e usado por dois processos: o worker da fila
 * (worker/ai.worker.ts, caminho de producao) e o AiService (fallback sem fila).
 *
 * Eventos (distinctId = id do Clerk, o mesmo do identify do frontend):
 *   free_analysis_started   { analysisNumber, freeRemaining }
 *   free_analysis_completed { analysisNumber, freeRemaining, isLastFree }
 *   free_quota_exhausted    { analysisNumber }  (uma vez por usuario)
 */
import { captureServer } from './posthog';

export const FREE_ANALYSIS_LIMIT = 3;

type PrismaLike = {
  user: {
    findUnique: (args: { where: { id: string }; select: { clerkUserId: true } }) => Promise<{ clerkUserId: string } | null>;
  };
  analysis: {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
};

async function clerkIdFor(prisma: PrismaLike, userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
  return user?.clerkUserId ?? null;
}

/** Quantas gratis a pessoa ja usou (falha nao conta, mesma regra da cota). */
async function freeUsed(prisma: PrismaLike, userId: string): Promise<number> {
  return prisma.analysis.count({ where: { userId, isDemo: true, status: { not: 'failed' } } });
}

/** Chamar logo depois de criar a linha de uma analise gratis. */
export async function trackFreeAnalysisStarted(
  prisma: PrismaLike,
  params: { userId: string; analysisId: string; createdAt?: Date },
): Promise<void> {
  try {
    const clerkId = await clerkIdFor(prisma, params.userId);
    if (!clerkId) return;
    const used = await freeUsed(prisma, params.userId);
    captureServer(
      clerkId,
      'free_analysis_started',
      { analysisId: params.analysisId, analysisNumber: used, freeRemaining: Math.max(0, FREE_ANALYSIS_LIMIT - used) },
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
    const used = await freeUsed(prisma, params.userId);
    const isLastFree = used >= FREE_ANALYSIS_LIMIT;
    captureServer(
      clerkId,
      'free_analysis_completed',
      {
        analysisId: params.analysisId,
        analysisNumber: used,
        freeRemaining: Math.max(0, FREE_ANALYSIS_LIMIT - used),
        isLastFree,
      },
      { dedupeKey: `free_analysis_completed:${params.analysisId}`, timestamp: params.completedAt },
    );
    if (isLastFree) {
      captureServer(
        clerkId,
        'free_quota_exhausted',
        { analysisId: params.analysisId, analysisNumber: used },
        // Uma vez por pessoa: a chave nao tem a analise.
        { dedupeKey: `free_quota_exhausted:${params.userId}`, timestamp: params.completedAt },
      );
    }
  } catch {
    /* analytics nunca derruba a analise */
  }
}
