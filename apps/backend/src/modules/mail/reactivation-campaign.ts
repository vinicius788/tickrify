/**
 * Campanha de reativacao (05/10/2026): UM e-mail para a base antiga que nao
 * assinou, separado pelo que ainda resta da cota gratis.
 *
 *   exhausted   usou os planos gratis (settledExhausted): o semanal de US$ 7,99
 *   one_left    resta 1 plano de trade gratis
 *   two_left    restam 2
 *   three_left  fez analises (so WAIT ou falhas) e ainda tem os 3
 *   never       nunca concluiu analise (fora do envio por padrao)
 *
 * Por que existe: ate 05/10 o pagamento so aparecia ao tentar a 4a analise e o
 * resto do painel seguia aberto; quem esgotou nunca viu bem o preco. Os
 * e-mails automaticos (lifecycle-email.ts) so pegam quem esta numa janela de
 * dias; esta campanha e o toque unico na base inteira.
 *
 * Regras (as mesmas dos automaticos, mais duas):
 * - nunca para assinante, para admin, para quem se descadastrou nem sem link
 *   de descadastro;
 * - fora quem se cadastrou nos ultimos 3 dias (esta nos automaticos) e quem
 *   recebeu um e-mail automatico nos ultimos 3 dias;
 * - uma vez por pessoa: AdminAudit `campaign:reactivation_2026_10` gravado
 *   ANTES de enviar (numa corrida, perder um e-mail e melhor que duplicar);
 * - o disparo e manual (rota do /admin) e para sozinho depois de 5 falhas
 *   seguidas do provedor.
 */
import type { PrismaClient } from '@prisma/client';
import { getFreeQuota, FREE_SIGNAL_LIMIT } from '../../common/free-quota';
import { cleanFirstName } from './welcome-email';
import { UNSUBSCRIBE_AUDIT_ACTION, letter, unsubscribeUrl } from './lifecycle-email';

export const CAMPAIGN_ID = 'reactivation_2026_10';
export const CAMPAIGN_AUDIT_ACTION = `campaign:${CAMPAIGN_ID}`;
export const CAMPAIGN_SEGMENTS = ['exhausted', 'one_left', 'two_left', 'three_left', 'never'] as const;
export type CampaignSegment = (typeof CAMPAIGN_SEGMENTS)[number];
/** O que sai quando o disparo nao diz quais grupos. */
export const DEFAULT_SEND_SEGMENTS: CampaignSegment[] = ['exhausted', 'one_left', 'two_left', 'three_left'];

const DAY = 24 * 60 * 60 * 1000;
const MIN_ACCOUNT_AGE_MS = 3 * DAY;
const MAX_CONSECUTIVE_FAILURES = 5;

export type CampaignEmail = { kind: string; subject: string; html: string; unsubscribeUrl: string };

export function renderCampaignEmail(
  segment: CampaignSegment,
  params: { appUrl: string; firstName?: string | null; unsubscribeUrl: string },
): CampaignEmail {
  const app = params.appUrl.replace(/\/+$/, '');
  const base = { firstName: cleanFirstName(params.firstName), unsubscribeUrl: params.unsubscribeUrl };
  const kind = `campaign_${segment}`;

  if (segment === 'exhausted') {
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: 'Keep using Tickrify for $7.99 a week',
      html: letter({
        ...base,
        preview: '25 analyses, renews every 7 days, cancel anytime.',
        paragraphs: [
          'You used all your free trade plans on Tickrify. Thank you for giving it a real try.',
          'If you want to keep going, there is a weekly plan: $7.99 for 25 analyses, renews every 7 days, and you can cancel anytime from your dashboard.',
          'Subscribers also get the trading journal: your stats for the month, notes on each trade, and how your results compare with what the market did in the 48 hours after each read.',
        ],
        cta: { label: 'See the weekly plan', url: `${app}/dashboard/plans?cycle=weekly` },
        afterCta: ['If something about Tickrify did not work for you, reply and tell me. I read every message.'],
      }),
    };
  }

  if (segment === 'never') {
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: `Your ${FREE_SIGNAL_LIMIT} free trade plans on Tickrify are still there`,
      html: letter({
        ...base,
        preview: 'One screenshot of your chart, about 20 seconds.',
        paragraphs: [
          `You created a Tickrify account but have not analyzed a chart yet. Your ${FREE_SIGNAL_LIMIT} free trade plans are still there, and WAIT results do not use them.`,
          'Take a screenshot of the chart you are watching (a phone photo of the screen works too) and upload it. In about 20 seconds you get BUY, SELL or WAIT, with entry, stop, targets and the reasoning.',
        ],
        cta: { label: 'Analyze a chart', url: `${app}/dashboard/new` },
        afterCta: ['If something got in the way, reply and tell me what happened.'],
      }),
    };
  }

  const left = segment === 'one_left' ? 1 : segment === 'two_left' ? 2 : 3;
  const plans = left === 1 ? '1 free trade plan' : `${left} free trade plans`;
  return {
    kind,
    unsubscribeUrl: params.unsubscribeUrl,
    subject: `You still have ${plans} on Tickrify`,
    html: letter({
      ...base,
      preview: 'Use it on the next trade you are actually considering.',
      paragraphs: [
        `You still have ${plans} on Tickrify, and WAIT results do not use them.`,
        // three_left = analisou e so recebeu WAIT. Ate 24/09 o motor dava WAIT
        // em 76% a 93% das leituras; o prompt v7.5 baixou para ~35% (medido).
        ...(segment === 'three_left'
          ? ['If your earlier reads came back as WAIT: we updated the AI in late September, and it now gives a full trade plan more often when the chart has a clean setup.']
          : []),
        'Since your last visit the dashboard got a trading journal: your stats for the month, notes on each trade, and how your results compare with what the market did in the 48 hours after each read.',
        `The best use of ${left === 1 ? 'it' : 'the next one'}: the chart of the next trade you are actually thinking about taking, before you enter.`,
      ],
      cta: { label: 'Analyze a chart', url: `${app}/dashboard/new` },
      afterCta: ['If something about your last read was unclear, reply and tell me. I read every message.'],
    }),
  };
}

export type CampaignDeps = {
  prisma: Pick<PrismaClient, 'user' | 'adminAudit' | 'subscription' | 'analysis'>;
  mail: { sendLifecycle(to: string, email: CampaignEmail): Promise<boolean> };
  appUrl: string;
  apiBaseUrl: string;
  now?: () => Date;
  /** Pausa entre envios (o Resend aceita poucas requisicoes por segundo). */
  sleep?: (ms: number) => Promise<void>;
  log(level: 'log' | 'warn', message: string): void;
};

type Candidate = { userId: string; email: string; name: string | null; segment: CampaignSegment };

/** Quem recebe e em que grupo. Nao grava nada. */
export async function campaignCandidates(deps: CampaignDeps): Promise<Candidate[]> {
  const now = deps.now ? deps.now() : new Date();
  const users = await deps.prisma.user.findMany({
    where: {
      email: { not: null },
      createdAt: { lte: new Date(now.getTime() - MIN_ACCOUNT_AGE_MS) },
      NOT: { role: 'admin' },
      subscriptions: { none: { OR: [{ status: { in: ['active', 'trialing'] } }, { stripeId: { startsWith: 'manual_' } }] } },
    },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const skip = new Set(
    (
      await deps.prisma.adminAudit.findMany({
        where: { action: { in: [UNSUBSCRIBE_AUDIT_ACTION, CAMPAIGN_AUDIT_ACTION] }, targetUserId: { not: null } },
        select: { targetUserId: true },
      })
    ).map((row) => row.targetUserId as string),
  );

  // Quem recebeu um e-mail automatico nos ultimos 3 dias fica de fora: dois
  // e-mails seguidos da mesma marca viram spam.
  const recentLifecycle = new Set(
    (
      await deps.prisma.adminAudit.findMany({
        where: {
          action: { startsWith: 'lifecycle:' },
          targetUserId: { not: null },
          createdAt: { gte: new Date(now.getTime() - MIN_ACCOUNT_AGE_MS) },
        },
        select: { targetUserId: true },
      })
    ).map((row) => row.targetUserId as string),
  );

  const out: Candidate[] = [];
  for (const user of users) {
    if (!user.email || skip.has(user.id) || recentLifecycle.has(user.id)) continue;
    const quota = await getFreeQuota(deps.prisma, user.id);
    const completed = await deps.prisma.analysis.count({ where: { userId: user.id, status: 'completed' } });
    let segment: CampaignSegment;
    if (quota.settledExhausted) segment = 'exhausted';
    else if (completed === 0) segment = 'never';
    else if (quota.remaining === 1) segment = 'one_left';
    else if (quota.remaining === 2) segment = 'two_left';
    else if (quota.remaining >= 3) segment = 'three_left';
    else continue; // analise em andamento segurando a cota: fica para outra hora
    out.push({ userId: user.id, email: user.email, name: user.name, segment });
  }
  return out;
}

export async function countCampaign(deps: CampaignDeps) {
  const candidates = await campaignCandidates(deps);
  const bySegment = Object.fromEntries(CAMPAIGN_SEGMENTS.map((s) => [s, 0])) as Record<CampaignSegment, number>;
  for (const c of candidates) bySegment[c.segment] += 1;
  const alreadySent = await deps.prisma.adminAudit.count({ where: { action: CAMPAIGN_AUDIT_ACTION } });
  return { campaign: CAMPAIGN_ID, bySegment, alreadySent };
}

/** O disparo. Devolve quantos sairam por grupo. */
export async function sendCampaign(deps: CampaignDeps, segments: CampaignSegment[]) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const sent = Object.fromEntries(CAMPAIGN_SEGMENTS.map((s) => [s, 0])) as Record<CampaignSegment, number>;
  let failed = 0;
  let consecutiveFailures = 0;

  for (const c of await campaignCandidates(deps)) {
    if (!segments.includes(c.segment)) continue;
    const url = unsubscribeUrl(deps.apiBaseUrl, c.userId);
    if (!url) {
      deps.log('warn', '[campaign] Sem segredo de descadastro: nada sai.');
      break;
    }
    await deps.prisma.adminAudit.create({
      data: { action: CAMPAIGN_AUDIT_ACTION, targetUserId: c.userId, targetEmail: c.email, details: { segment: c.segment } },
    });
    const email = renderCampaignEmail(c.segment, {
      appUrl: deps.appUrl,
      firstName: c.name ? c.name.trim().split(/\s+/)[0] : null,
      unsubscribeUrl: url,
    });
    const ok = await deps.mail.sendLifecycle(c.email, email);
    deps.log('log', `[campaign] ${CAMPAIGN_ID} segment=${c.segment} user=${c.userId} sent=${ok ? 1 : 0}`);
    if (ok) {
      sent[c.segment] += 1;
      consecutiveFailures = 0;
    } else {
      failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        deps.log('warn', `[campaign] ${MAX_CONSECUTIVE_FAILURES} falhas seguidas do provedor: disparo interrompido.`);
        break;
      }
    }
    await sleep(600);
  }
  deps.log('log', `[campaign] ${CAMPAIGN_ID} fim sent=${JSON.stringify(sent)} failed=${failed}`);
  return { sent, failed };
}
