/**
 * Campanha Founding Member (27/10/2026): oferta unica de US$ 15/mes, preco
 * travado, 30 vagas, so por link pessoal (ver `payments/founding-offer.ts`).
 *
 * Arquivo proprio porque e outra campanha, com a propria marca no AdminAudit
 * (`campaign:founder_2026_10`) e o proprio codigo por pessoa; a de reativacao
 * (`reactivation-campaign.ts`) escolhe quem recebe por cota gratis, e esta
 * recebe a lista pronta de quem o dono decidiu convidar.
 *
 * Regras (as mesmas das outras campanhas):
 * - nunca para assinante, admin, acesso manual nem para quem se descadastrou;
 * - uma vez por pessoa: o AdminAudit e gravado ANTES de enviar;
 * - e-mail recusado pelo provedor perde a marca E o codigo e desativado, para
 *   um proximo disparo tentar de novo so essa pessoa sem deixar codigo solto;
 * - sem `confirm: 'SEND'` e simulacao: conta quem receberia, sem tocar na
 *   Stripe nem no provedor de e-mail;
 * - no maximo 40 por disparo: o Resend gratis e 100 e-mails/dia para o site
 *   inteiro (boas-vindas e recuperacao dividem a mesma cota).
 */
import type { PrismaClient } from '@prisma/client';
import { FOUNDER_CAMPAIGN, FOUNDER_MONTHLY_USD, FOUNDER_SEATS } from '../payments/founding-offer';
import { UNSUBSCRIBE_AUDIT_ACTION, letter, unsubscribeUrl } from './lifecycle-email';
import { cleanFirstName } from './welcome-email';

export const FOUNDER_AUDIT_ACTION = `campaign:${FOUNDER_CAMPAIGN}`;
export const FOUNDER_MAX_PER_SEND = 40;
export const FOUNDER_VALID_DAYS = 7;
const MAX_CONSECUTIVE_FAILURES = 5;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export type FounderEmail = { kind: string; subject: string; html: string; unsubscribeUrl: string };

function formatDay(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function renderFounderEmail(params: {
  appUrl: string;
  firstName?: string | null;
  unsubscribeUrl: string;
  code: string;
  expiresAt: Date;
}): FounderEmail {
  const app = params.appUrl.replace(/\/+$/, '');
  return {
    kind: 'campaign_founder',
    unsubscribeUrl: params.unsubscribeUrl,
    subject: `Your Tickrify founding price: $${FOUNDER_MONTHLY_USD}/month, locked`,
    html: letter({
      firstName: cleanFirstName(params.firstName),
      unsubscribeUrl: params.unsubscribeUrl,
      preview: `One-time offer for ${FOUNDER_SEATS} people. Your link is personal and expires on ${formatDay(params.expiresAt)}.`,
      paragraphs: [
        'You are one of the traders who really used Tickrify, so I am making you an offer that is not on the website.',
        `Founding member plan: $${FOUNDER_MONTHLY_USD} a month instead of $29. Same plan, same 200 analyses a month. The price stays at $${FOUNDER_MONTHLY_USD} for as long as your subscription stays active, even if Tickrify raises its price later.`,
        `This is a one-time offer for ${FOUNDER_SEATS} people and I will not repeat it. Your link is personal, works once and expires on ${formatDay(params.expiresAt)}. If you cancel later you can come back, but at the regular price.`,
        'Tickrify is a second opinion on your chart, not trading signals, and I cannot promise results. If the way it reads a chart is useful to you, this is the lowest price you will see.',
      ],
      cta: { label: 'Claim my founding price', url: `${app}/pricing?offer=${encodeURIComponent(params.code)}` },
      afterCta: ['If something stopped you from subscribing before, reply and tell me what it was. I read every message.'],
    }),
  };
}

export type FounderDeps = {
  prisma: Pick<PrismaClient, 'user' | 'adminAudit'>;
  mail: { sendLifecycle(to: string, email: FounderEmail): Promise<boolean> };
  stripe: {
    issue(userId: string, expiresAt: number): Promise<{ id: string; code: string }>;
    revoke(promotionCodeId: string): Promise<void>;
  };
  appUrl: string;
  apiBaseUrl: string;
  now?: () => Date;
  /** Pausa entre envios (o Resend aceita poucas requisicoes por segundo). */
  sleep?: (ms: number) => Promise<void>;
  log(level: 'log' | 'warn', message: string): void;
};

export type FounderResult = {
  dryRun: boolean;
  requested: number;
  /** Simulacao: quantos sairiam. Envio real: igual a `sent`. */
  eligible: number;
  sent: number;
  failed: number;
  skipped: { notFound: number; admin: number; subscriber: number; unsubscribed: number; alreadySent: number };
};

export async function sendFounderCampaign(deps: FounderDeps, emails: string[], dryRun: boolean): Promise<FounderResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ? deps.now() : new Date();
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, FOUNDER_MAX_PER_SEND);
  const result: FounderResult = {
    dryRun,
    requested: wanted.length,
    eligible: 0,
    sent: 0,
    failed: 0,
    skipped: { notFound: 0, admin: 0, subscriber: 0, unsubscribed: 0, alreadySent: 0 },
  };

  const users = await deps.prisma.user.findMany({
    where: { email: { in: wanted, mode: 'insensitive' } },
    select: { id: true, email: true, name: true, role: true, subscriptions: { select: { status: true, stripeId: true } } },
  });
  const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
  const audits = await deps.prisma.adminAudit.findMany({
    where: { action: { in: [UNSUBSCRIBE_AUDIT_ACTION, FOUNDER_AUDIT_ACTION] }, targetUserId: { in: users.map((u) => u.id) } },
    select: { action: true, targetUserId: true },
  });
  const unsubscribed = new Set(audits.filter((a) => a.action === UNSUBSCRIBE_AUDIT_ACTION).map((a) => a.targetUserId));
  const already = new Set(audits.filter((a) => a.action === FOUNDER_AUDIT_ACTION).map((a) => a.targetUserId));

  const expiresAtDate = new Date(now.getTime() + FOUNDER_VALID_DAYS * 24 * 60 * 60 * 1000);
  let consecutiveFailures = 0;

  for (const address of wanted) {
    const user = byEmail.get(address);
    if (!user || !user.email) { result.skipped.notFound += 1; continue; }
    if (user.role === 'admin') { result.skipped.admin += 1; continue; }
    if (user.subscriptions.some((s) => ['active', 'trialing'].includes(s.status) || s.stripeId.startsWith('manual_'))) {
      result.skipped.subscriber += 1;
      continue;
    }
    if (unsubscribed.has(user.id)) { result.skipped.unsubscribed += 1; continue; }
    if (already.has(user.id)) { result.skipped.alreadySent += 1; continue; }

    result.eligible += 1;
    if (dryRun) continue;

    const url = unsubscribeUrl(deps.apiBaseUrl, user.id);
    if (!url) {
      deps.log('warn', '[founder] Sem segredo de descadastro: nada sai.');
      result.eligible -= 1;
      break;
    }

    let promo: { id: string; code: string };
    try {
      promo = await deps.stripe.issue(user.id, Math.floor(expiresAtDate.getTime() / 1000));
    } catch (error) {
      deps.log('warn', `[founder] Stripe recusou criar o codigo: ${error instanceof Error ? error.message : String(error)}`);
      result.failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
      continue;
    }

    const audit = await deps.prisma.adminAudit.create({
      data: {
        action: FOUNDER_AUDIT_ACTION,
        targetUserId: user.id,
        targetEmail: user.email,
        details: { promotionCodeId: promo.id, code: promo.code, expiresAt: expiresAtDate.toISOString() },
      },
      select: { id: true },
    });
    const ok = await deps.mail.sendLifecycle(
      user.email,
      renderFounderEmail({
        appUrl: deps.appUrl,
        firstName: user.name ? user.name.trim().split(/\s+/)[0] : null,
        unsubscribeUrl: url,
        code: promo.code,
        expiresAt: expiresAtDate,
      }),
    );
    deps.log('log', `[founder] ${FOUNDER_CAMPAIGN} user=${user.id} sent=${ok ? 1 : 0}`);
    if (ok) {
      result.sent += 1;
      consecutiveFailures = 0;
    } else {
      await deps.prisma.adminAudit.delete({ where: { id: audit.id } }).catch(() => undefined);
      await deps.stripe.revoke(promo.id).catch(() => undefined);
      result.failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        deps.log('warn', `[founder] ${MAX_CONSECUTIVE_FAILURES} falhas seguidas do provedor: disparo interrompido.`);
        break;
      }
    }
    await sleep(600);
  }
  deps.log('log', `[founder] ${FOUNDER_CAMPAIGN} fim ${JSON.stringify(result)}`);
  return result;
}
