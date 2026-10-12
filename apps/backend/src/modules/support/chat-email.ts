/**
 * Avisos por e-mail do chat com o fundador (12/10/2026).
 *
 *   chat_founder_notify  mensagem de usuario chegou: vai para o suporte
 *                        (FOUNDER_CHAT_NOTIFY_TO, padrao support@), com o
 *                        texto, no maximo 1 por conversa a cada 15 min.
 *   chat_reply           o fundador respondeu e a pessoa nao leu em 10 min:
 *                        e-mail SEM o texto, no maximo 1 por conversa a cada
 *                        6 h, nunca para quem se descadastrou.
 *
 * Por que os tetos: a Resend gratis da 100 e-mails por dia UTC para TUDO
 * (boas-vindas e recuperacao inclusive); a campanha de 05/10 ja gastou um dia
 * inteiro. Chave CHAT_EMAIL_NOTIFY no /admin, DESLIGADA por padrao: desligada,
 * so loga `[chat] dry-run`.
 *
 * Arquivo sem Nest (mesmo motivo do lifecycle-email.ts): a varredura da
 * resposta roda no worker. A "reserva" de cada envio e um UPDATE condicional
 * no banco, porque o Render roda 2 instancias e estado em memoria nao vale
 * entre elas. Envio recusado devolve a reserva.
 */
import type { PrismaClient } from '@prisma/client';
import { captureServer } from '../../common/analytics/posthog';
import { UNSUBSCRIBE_AUDIT_ACTION, letter, unsubscribeUrl } from '../mail/lifecycle-email';
import { cleanFirstName } from '../mail/welcome-email';

export const CHAT_EMAIL_FLAG = 'CHAT_EMAIL_NOTIFY';
const MINUTE = 60 * 1000;
export const FOUNDER_NOTIFY_EVERY_MS = 15 * MINUTE;
export const REPLY_EMAIL_AFTER_MS = 10 * MINUTE;
export const REPLY_EMAIL_EVERY_MS = 6 * 60 * MINUTE;
/** Resposta mais velha que isto nao gera e-mail (ligar a chave nao dispara para o passado). */
export const REPLY_EMAIL_WINDOW_MS = 48 * 60 * MINUTE;
export const CHAT_SWEEP_INTERVAL_MS = 5 * MINUTE;

type Log = (level: 'info' | 'warn', message: string) => void;
type RawPrisma = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export type ChatMail = {
  sendChatFounderNotify: (
    to: string,
    info: { userEmail: string | null; isSubscriber: boolean; freeLocked: boolean; body: string },
  ) => Promise<boolean>;
  sendLifecycle: (to: string, email: { kind: string; subject: string; html: string; unsubscribeUrl: string }) => Promise<boolean>;
};

export function founderNotifyTo(): string {
  return process.env.FOUNDER_CHAT_NOTIFY_TO?.trim() || 'support@tickrify.com';
}

/**
 * Mensagem de usuario chegou. Reserva o envio no banco (1 por conversa a cada
 * 15 min) e manda para o suporte. Nunca lanca.
 */
export async function notifyFounder(
  deps: { prisma: RawPrisma; mail: ChatMail; isEnabled: () => boolean; log: Log; now?: () => Date; to?: string },
  input: { threadId: string; clerkUserId: string | null; userEmail: string | null; isSubscriber: boolean; freeLocked: boolean; body: string },
): Promise<boolean> {
  try {
    if (!deps.isEnabled()) {
      deps.log('info', `[chat] dry-run kind=chat_founder_notify thread=${input.threadId}`);
      return false;
    }
    const now = deps.now?.() ?? new Date();
    const claimed = await deps.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "tickrify"."SupportThread"
      SET "lastFounderNotifyAt" = ${now}
      WHERE "id" = ${input.threadId}
        AND ("lastFounderNotifyAt" IS NULL OR "lastFounderNotifyAt" <= ${new Date(now.getTime() - FOUNDER_NOTIFY_EVERY_MS)})
      RETURNING "id"
    `;
    if (claimed.length === 0) return false;
    const sent = await deps.mail.sendChatFounderNotify(deps.to ?? founderNotifyTo(), {
      userEmail: input.userEmail,
      isSubscriber: input.isSubscriber,
      freeLocked: input.freeLocked,
      body: input.body,
    });
    if (!sent) {
      // Devolve a reserva: a proxima mensagem tenta de novo.
      await deps.prisma.$executeRaw`
        UPDATE "tickrify"."SupportThread" SET "lastFounderNotifyAt" = NULL
        WHERE "id" = ${input.threadId} AND "lastFounderNotifyAt" = ${now}
      `;
      return false;
    }
    if (input.clerkUserId) captureServer(input.clerkUserId, 'chat_founder_notify_sent', { threadId: input.threadId });
    return true;
  } catch (error) {
    deps.log('warn', `[chat] Aviso ao fundador falhou (${input.threadId}): ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

export function renderChatReplyEmail(params: { appUrl: string; firstName?: string | null; unsubscribeUrl: string }) {
  const app = params.appUrl.replace(/\/+$/, '');
  return {
    kind: 'chat_reply',
    // Nome do dono com acento (Vinícius), nunca o apelido.
    subject: 'Vinícius replied to your message',
    unsubscribeUrl: params.unsubscribeUrl,
    html: letter({
      preview: 'Open your Tickrify dashboard to read it.',
      firstName: cleanFirstName(params.firstName),
      paragraphs: ['I replied to the message you sent me in Tickrify.', 'Open your Tickrify dashboard to read it and answer there.'],
      cta: { label: 'Open Tickrify', url: `${app}/dashboard?chat=open` },
      unsubscribeUrl: params.unsubscribeUrl,
    }),
  };
}

/**
 * Varredura do worker (a cada 5 min): conversas em que o fundador respondeu
 * ha 10 min ou mais e a pessoa ainda nao leu. Devolve quantos sairam.
 */
export async function runChatReplySweep(deps: {
  prisma: RawPrisma;
  mail: ChatMail;
  isEnabled: () => boolean;
  appUrl: string;
  apiBaseUrl: string;
  log: Log;
  now?: () => Date;
}): Promise<{ sent: number; dryRun: number }> {
  const now = deps.now?.() ?? new Date();
  const readyBefore = new Date(now.getTime() - REPLY_EMAIL_AFTER_MS);
  const oldest = new Date(now.getTime() - REPLY_EMAIL_WINDOW_MS);
  const lastEmailBefore = new Date(now.getTime() - REPLY_EMAIL_EVERY_MS);
  const candidates = await deps.prisma.$queryRaw<
    Array<{ threadId: string; userId: string; clerkUserId: string | null; email: string; name: string | null; lastFounderMessageAt: Date; lastReplyEmailAt: Date | null }>
  >`
    SELECT t."id" AS "threadId", t."userId", u."clerkUserId", u."email", u."name", t."lastFounderMessageAt", t."lastReplyEmailAt"
    FROM "tickrify"."SupportThread" t
    JOIN "tickrify"."User" u ON u."id" = t."userId"
    WHERE t."lastFounderMessageAt" IS NOT NULL
      AND t."lastFounderMessageAt" <= ${readyBefore}
      AND t."lastFounderMessageAt" > ${oldest}
      AND (t."lastUserReadAt" IS NULL OR t."lastUserReadAt" < t."lastFounderMessageAt")
      AND (t."lastReplyEmailAt" IS NULL OR (t."lastReplyEmailAt" < t."lastFounderMessageAt" AND t."lastReplyEmailAt" <= ${lastEmailBefore}))
      AND u."email" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "tickrify"."AdminAudit" a
        WHERE a."targetUserId" = u."id" AND a."action" = ${UNSUBSCRIBE_AUDIT_ACTION}
      )
    ORDER BY t."lastFounderMessageAt" ASC
    LIMIT 50
  `;

  if (!deps.isEnabled()) {
    // Uma linha por resposta, na primeira volta depois dos 10 min (nao a cada 5 min).
    const fresh = candidates.filter((c) => c.lastFounderMessageAt.getTime() > readyBefore.getTime() - CHAT_SWEEP_INTERVAL_MS);
    for (const c of fresh) deps.log('info', `[chat] dry-run kind=chat_reply thread=${c.threadId}`);
    return { sent: 0, dryRun: fresh.length };
  }

  let sent = 0;
  for (const c of candidates) {
    const link = unsubscribeUrl(deps.apiBaseUrl, c.userId);
    // Sem link de descadastro nao sai (mesma regra dos e-mails de ciclo de vida).
    if (!link) {
      deps.log('warn', '[chat] Sem segredo de descadastro: e-mail de resposta nao enviado.');
      break;
    }
    const claimed = await deps.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "tickrify"."SupportThread" SET "lastReplyEmailAt" = ${now}
      WHERE "id" = ${c.threadId}
        AND ("lastReplyEmailAt" IS NULL OR ("lastReplyEmailAt" < "lastFounderMessageAt" AND "lastReplyEmailAt" <= ${lastEmailBefore}))
      RETURNING "id"
    `;
    if (claimed.length === 0) continue;
    const email = renderChatReplyEmail({ appUrl: deps.appUrl, firstName: c.name, unsubscribeUrl: link });
    const ok = await deps.mail.sendLifecycle(c.email, email).catch(() => false);
    if (!ok) {
      await deps.prisma.$executeRaw`
        UPDATE "tickrify"."SupportThread" SET "lastReplyEmailAt" = ${c.lastReplyEmailAt}
        WHERE "id" = ${c.threadId} AND "lastReplyEmailAt" = ${now}
      `;
      continue;
    }
    sent += 1;
    if (c.clerkUserId) captureServer(c.clerkUserId, 'chat_reply_email_sent', { threadId: c.threadId });
  }
  return { sent, dryRun: 0 };
}
