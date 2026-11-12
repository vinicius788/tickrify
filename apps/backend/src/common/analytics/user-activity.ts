/**
 * Eventos de USO do produto emitidos pelo backend, para qualquer usuario
 * logado (pagante ou nao). Mesmo motivo do free-funnel.ts: o PostHog do
 * navegador so liga a pessoa depois do aceite de cookies, e o que o assinante
 * faz dentro do produto precisa aparecer para todo assinante.
 *
 * Eventos (distinctId = id do Clerk):
 *   paid_analysis_started { analysisId, analysisType, ticksCost, ticksLeft, plan, billingCycle, source }
 *     e no perfil: plan, billing_cycle, ticks_left, last_paid_analysis_at
 *   trade_outcome_set     { analysisId, outcome, hasPnl }
 *   strategy_saved        { hasProfile }
 *   setup_update_completed { setupId, analysisId, version, daysSinceRoot, daysSinceLast,
 *                            analysisType, ticksCost, recommendation } (setups.service.ts)
 */
import { captureServer, type CaptureOptions } from './posthog';

type PrismaLike = {
  user: {
    findUnique: (args: { where: { id: string }; select: { clerkUserId: true } }) => Promise<{ clerkUserId: string } | null>;
  };
};

export async function trackUserActivity(
  prisma: PrismaLike,
  userId: string,
  event:
    | 'paid_analysis_started'
    | 'trade_outcome_set'
    | 'trade_note_saved'
    | 'strategy_saved'
    | 'setup_update_completed'
    | 'trade_marked_pending'
    | 'trade_marked_open'
    | 'trade_management_requested'
    | 'trade_closed'
    | 'watch_entry_logged'
    | 'watch_entry_removed',
  properties: Record<string, unknown>,
  options: CaptureOptions = {},
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { clerkUserId: true } });
    if (!user?.clerkUserId) return;
    captureServer(user.clerkUserId, event, properties, options);
  } catch {
    /* analytics nunca derruba a requisicao */
  }
}
