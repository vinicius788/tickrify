/**
 * E-mail de recuperacao ("suas analises gratis acabaram").
 *
 * Arquivo proprio porque e usado por dois processos: o AiService (Nest) e o
 * worker da fila (worker/ai.worker.ts), que roda fora do Nest e e o caminho de
 * PRODUCAO. Ate 21/09/2026 so o AiService disparava, entao em producao o e-mail
 * so saia na quarta tentativa, e quem fechava a aba depois da terceira nunca
 * recebia nada.
 *
 * Regras (as mesmas para os dois caminhos):
 * - uma vez por usuario, para sempre (AdminAudit `recovery_email_sent`),
 *   registrado ANTES de enviar: numa corrida, melhor perder 1 e-mail que duplicar;
 * - nunca para quem ja assina (pode ter assinado entre o disparo e o envio);
 * - best-effort: nunca lanca, nunca atrasa a analise.
 */
import type { PrismaClient } from '@prisma/client';
import { fetchClerkEmail } from '../../common/utils/clerk-email';
import { getFreeQuota } from '../../common/free-quota';
import type { FoundingOffer } from '../payments/founding-offer';

export type RecoveryEmailDeps = {
  prisma: Pick<PrismaClient, 'adminAudit' | 'user' | 'analysis'>;
  mail: { sendRecovery(to: string, offer?: FoundingOffer | null): Promise<void> };
  /** Oferta EARLY35 no momento do envio; o cupom so entra no e-mail se ativo. */
  foundingOffer(): Promise<FoundingOffer>;
  hasPaidAccess(userId: string): Promise<boolean>;
  log(level: 'log' | 'warn', message: string): void;
};

export async function sendRecoveryEmailOnce(deps: RecoveryEmailDeps, userId: string): Promise<void> {
  try {
    const already = await deps.prisma.adminAudit.findFirst({
      where: { action: 'recovery_email_sent', targetUserId: userId },
      select: { id: true },
    });
    if (already) return;

    if (await deps.hasPaidAccess(userId)) return;

    const user = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, clerkUserId: true },
    });
    if (!user) return;

    let email = user.email;
    if (!email) {
      // Token do Clerk nao traz e-mail: busca na API e faz backfill.
      email = await fetchClerkEmail(user.clerkUserId);
      if (email) {
        await deps.prisma.user.update({ where: { id: userId }, data: { email } }).catch(() => undefined);
      }
    }
    if (!email) return;

    await deps.prisma.adminAudit.create({
      data: {
        action: 'recovery_email_sent',
        targetUserId: userId,
        targetEmail: email,
        details: { source: 'free_limit_reached' },
      },
    });

    // Falha ao consultar a oferta tira so a oferta, nunca o e-mail.
    const offer = await Promise.resolve()
      .then(() => deps.foundingOffer())
      .catch(() => null);
    await deps.mail.sendRecovery(email, offer?.active ? offer : null);
    deps.log('log', `[recovery] E-mail de recuperação enviado (userId=${userId}).`);
  } catch (err) {
    deps.log('warn', `[recovery] Falha best-effort no e-mail de recuperação: ${(err as Error)?.message ?? err}`);
  }
}

/**
 * Chamado quando uma analise GRATIS termina. Dispara na conclusao, nao na
 * criacao: falha nao conta na cota, e disparar na criacao mandaria "acabou"
 * para quem ainda tem uma. Pelo mesmo motivo usa `settledExhausted`: analise
 * ainda em andamento pode terminar em WAIT e nao consumir sinal.
 */
export async function notifyIfFreeQuotaExhausted(deps: RecoveryEmailDeps, userId: string): Promise<void> {
  try {
    const quota = await getFreeQuota(deps.prisma, userId);
    if (!quota.settledExhausted) return;
    await sendRecoveryEmailOnce(deps, userId);
  } catch (err) {
    deps.log('warn', `[recovery] Falha ao checar cota grátis esgotada: ${(err as Error)?.message ?? err}`);
  }
}
