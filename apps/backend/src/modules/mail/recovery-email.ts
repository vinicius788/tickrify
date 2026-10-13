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
 * - envio RECUSADO pelo provedor tira a marca, e `retryRecoveryEmails` (worker,
 *   a cada 15 min) tenta de novo quem esgotou nas ultimas 72h. Ate 06/10/2026
 *   a falha ficava marcada como enviada para sempre e o log dizia "enviado"
 *   (a cota diaria da Resend estourou e 3 pessoas perderam o e-mail);
 * - nunca para quem ja assina (pode ter assinado entre o disparo e o envio);
 * - best-effort: nunca lanca, nunca atrasa a analise.
 */
import type { PrismaClient } from '@prisma/client';
import { fetchClerkEmail } from '../../common/utils/clerk-email';
import { getFreeQuota } from '../../common/free-quota';
import type { FoundingOffer } from '../payments/founding-offer';

export type RecoveryEmailDeps = {
  prisma: Pick<PrismaClient, 'adminAudit' | 'user' | 'analysis'>;
  mail: { sendRecovery(to: string, offer?: FoundingOffer | null): Promise<boolean> };
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
    // Ex-assinante esta no modo leitura, nao "sem analises gratis".
    if ((await getFreeQuota(deps.prisma, userId)).formerSubscriber) return;

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

    const audit = await deps.prisma.adminAudit.create({
      select: { id: true },
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
    const ok = await deps.mail.sendRecovery(email, offer?.active ? offer : null);
    if (!ok) {
      await deps.prisma.adminAudit.delete({ where: { id: audit.id } }).catch(() => undefined);
      deps.log('warn', `[recovery] Envio recusado (userId=${userId}); sem marca, a varredura tenta de novo.`);
      return;
    }
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
    // Trial de 3 dias tem a propria sequencia (EMAIL_TRIAL_SEQUENCE).
    if (!quota.settledExhausted || quota.trial) return;
    await sendRecoveryEmailOnce(deps, userId);
  } catch (err) {
    deps.log('warn', `[recovery] Falha ao checar cota grátis esgotada: ${(err as Error)?.message ?? err}`);
  }
}

const RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Retentativa (worker, junto da varredura de ciclo de vida): quem concluiu
 * analise gratis nas ultimas 72h, esgotou e nao tem a marca de enviado. Cobre o
 * envio recusado (cota da Resend, queda do provedor). A regra de "uma vez" e de
 * "nunca para assinante" continua em `sendRecoveryEmailOnce`.
 */
export async function retryRecoveryEmails(deps: RecoveryEmailDeps, now: Date = new Date()): Promise<number> {
  try {
    const since = new Date(now.getTime() - RETRY_WINDOW_MS);
    const users = await deps.prisma.user.findMany({
      where: {
        analyses: { some: { isDemo: true, status: 'completed', createdAt: { gte: since } } },
        NOT: { role: 'admin' },
      },
      select: { id: true },
      take: 200,
    });
    if (users.length === 0) return 0;
    const done = new Set(
      (
        await deps.prisma.adminAudit.findMany({
          where: { action: 'recovery_email_sent', targetUserId: { in: users.map((u) => u.id) } },
          select: { targetUserId: true },
        })
      ).map((row) => row.targetUserId as string),
    );
    let tried = 0;
    for (const user of users) {
      if (done.has(user.id)) continue;
      const quota = await getFreeQuota(deps.prisma, user.id);
      if (!quota.settledExhausted || quota.trial) continue;
      tried += 1;
      await sendRecoveryEmailOnce(deps, user.id);
    }
    return tried;
  } catch (err) {
    deps.log('warn', `[recovery] Retentativa falhou: ${(err as Error)?.message ?? err}`);
    return 0;
  }
}

