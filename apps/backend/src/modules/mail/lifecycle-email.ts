/**
 * E-mails de ciclo de vida (29/09/2026), disparados pelo worker a cada 15 min.
 *
 *   activation_1       1h a 6h depois do cadastro, sem nenhuma analise concluida
 *   activation_2       20h a 48h depois do cadastro, ainda sem analise
 *   checkout_recovery  1h a 24h depois de abrir o checkout, sem assinatura
 *                      (texto muda se a Stripe registrou recusa do banco)
 *   second_analysis    24h a 72h depois da UNICA analise concluida, sem
 *                      voltar (05/10/2026; texto muda se ela foi WAIT). Medido
 *                      no PostHog em 14 dias: 38 de 96 que analisaram fizeram
 *                      so 1 analise e sumiram, e nenhum e-mail os chamava.
 *
 * Arquivo proprio pelo mesmo motivo do recovery-email.ts: roda no worker,
 * fora do Nest, e as regras precisam de teste sem subir o app.
 *
 * Regras:
 * - Chaves no painel /admin (EMAIL_ACTIVATION_NUDGE, EMAIL_CHECKOUT_RECOVERY),
 *   DESLIGADAS por padrao. Desligada, a varredura so loga quem receberia
 *   (`[lifecycle] dry-run ...`), sem gravar nada, para o dono ver o volume.
 * - Janelas fechadas: ligar a chave nao dispara para a base antiga inteira.
 * - Cada e-mail uma vez por pessoa (AdminAudit `lifecycle:<tipo>`), gravado
 *   ANTES de enviar: numa corrida, melhor perder um e-mail que duplicar.
 * - Nunca para assinante, nunca para quem se descadastrou
 *   (AdminAudit `email_unsubscribed`), nunca sem link de descadastro.
 * - Best-effort: nenhuma falha aqui derruba o worker.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { cleanFirstName } from './welcome-email';
import { FREE_SIGNAL_LIMIT } from '../../common/free-quota';

export type LifecycleKind = 'activation_1' | 'activation_2' | 'checkout_recovery' | 'second_analysis';

export const UNSUBSCRIBE_AUDIT_ACTION = 'email_unsubscribed';
export const lifecycleAuditAction = (kind: LifecycleKind) => `lifecycle:${kind}`;

const HOUR = 60 * 60 * 1000;
export const WINDOWS: Record<LifecycleKind, { minAgeMs: number; maxAgeMs: number }> = {
  activation_1: { minAgeMs: 1 * HOUR, maxAgeMs: 6 * HOUR },
  activation_2: { minAgeMs: 20 * HOUR, maxAgeMs: 48 * HOUR },
  checkout_recovery: { minAgeMs: 1 * HOUR, maxAgeMs: 24 * HOUR },
  // Idade da unica analise concluida.
  second_analysis: { minAgeMs: 24 * HOUR, maxAgeMs: 72 * HOUR },
};
const BATCH = 50;

// ── Descadastro ─────────────────────────────────────────────────────────────

function unsubscribeSecret(): string | null {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || process.env.CLERK_SECRET_KEY?.trim() || null;
}

export function unsubscribeToken(userId: string, secret = unsubscribeSecret()): string | null {
  if (!secret) return null;
  return createHmac('sha256', `tickrify-unsubscribe|${secret}`).update(userId).digest('hex').slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = unsubscribeToken(userId);
  if (!expected || typeof token !== 'string' || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

export function unsubscribeUrl(apiBaseUrl: string, userId: string): string | null {
  const token = unsubscribeToken(userId);
  if (!token) return null;
  const base = apiBaseUrl.replace(/\/+$/, '');
  return `${base}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
}

// ── Textos (ingles; traducao para o dono no CLAUDE.md/chat) ────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT = `-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

/**
 * Layout de carta pessoal (fundo branco, sem cartao escuro): e um e-mail do
 * fundador, nao um aviso do sistema. Um botao, assinatura e descadastro.
 */
function letter(params: {
  preview: string;
  firstName: string | null;
  paragraphs: string[];
  cta: { label: string; url: string };
  afterCta?: string[];
  unsubscribeUrl: string;
}): string {
  const p = (html: string) =>
    `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:26px;color:#1f2a36;">${html}</p>`;
  const greeting = params.firstName ? p(`Hi ${escapeHtml(params.firstName)},`) : p('Hi,');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(params.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td>
        ${greeting}
        ${params.paragraphs.map(p).join('\n        ')}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
          <tr><td bgcolor="#2eb872" style="border-radius:10px;">
            <a href="${escapeHtml(params.cta.url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#04240f;text-decoration:none;border-radius:10px;">${escapeHtml(params.cta.label)}</a>
          </td></tr>
        </table>
        ${(params.afterCta ?? []).map(p).join('\n        ')}
        ${p('Vini<br>Founder, Tickrify')}
        <p style="margin:24px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:#7a8794;">
          Tickrify gives a second opinion on your chart, not financial advice. Trading involves risk and the decision is yours.<br>
          You get this email because you created a Tickrify account. <a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#7a8794;">Unsubscribe from these emails</a>.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export type RenderedEmail = { kind: LifecycleKind; subject: string; html: string; unsubscribeUrl: string };

export function renderLifecycleEmail(
  kind: LifecycleKind,
  params: {
    appUrl: string;
    firstName?: string | null;
    unsubscribeUrl: string;
    declined?: boolean;
    /** second_analysis: a unica analise foi WAIT? */
    firstWasWait?: boolean;
  },
): RenderedEmail {
  const app = params.appUrl.replace(/\/+$/, '');
  const firstName = cleanFirstName(params.firstName);
  const base = { firstName, unsubscribeUrl: params.unsubscribeUrl };

  if (kind === 'activation_1') {
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: "Send a screenshot of your chart. That's all.",
      html: letter({
        ...base,
        preview: 'One screenshot, about 20 seconds, and you get the read.',
        paragraphs: [
          'You created your Tickrify account but have not analyzed a chart yet.',
          'It takes one step: take a screenshot of the chart you are watching (a phone photo of the screen works too) and upload it. In about 20 seconds you get the read: BUY, SELL or WAIT, with entry, stop, targets and the reasoning behind it.',
        ],
        cta: { label: 'Analyze a chart', url: `${app}/dashboard` },
        afterCta: [
          `No chart at hand? Your dashboard has three real example analyses you can open, and they do not use your free analyses. You have ${FREE_SIGNAL_LIMIT} free BUY or SELL calls, and WAIT results do not use them.`,
        ],
      }),
    };
  }

  if (kind === 'activation_2') {
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: 'What an analysis looks like from your phone',
      html: letter({
        ...base,
        preview: 'A 19-second video, start to finish.',
        paragraphs: [
          'Quick one. Most people use Tickrify from their phone, so here is the whole thing from a phone, start to finish, in 19 seconds:',
          `<a href="${app}/blog/how-tickrify-works/#phone" style="color:#1a7f4b;font-weight:600;">Watch the 19-second video</a>`,
          'Then open tickrify.com on your phone, tap New analysis and pick a screenshot of your chart.',
        ],
        cta: { label: 'Analyze a chart', url: `${app}/dashboard` },
        afterCta: ['If something got in the way, reply to this email and tell me what happened. I read every message.'],
      }),
    };
  }

  if (kind === 'second_analysis') {
    const cta = { label: 'Analyze another chart', url: `${app}/dashboard/new` };
    if (params.firstWasWait) {
      return {
        kind,
        unsubscribeUrl: params.unsubscribeUrl,
        subject: 'Your first Tickrify read said WAIT',
        html: letter({
          ...base,
          preview: 'It did not use one of your free trade plans.',
          paragraphs: [
            'Your first analysis came back as WAIT: the AI found no clean entry on that chart at that moment.',
            `That is a real answer, not an error. Staying out was the better call, and it did not use one of your ${FREE_SIGNAL_LIMIT} free trade plans.`,
            'To see a full trade plan, try another chart: a different pair, or a higher timeframe such as 1H or 4H.',
          ],
          cta,
          afterCta: [
            `Why WAIT happens, in 22 seconds: <a href="${app}/blog/how-tickrify-works/#wait" style="color:#1a7f4b;font-weight:600;">watch the video</a>.`,
          ],
        }),
      };
    }
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: `You still have ${FREE_SIGNAL_LIMIT - 1} free trade plans on Tickrify`,
      html: letter({
        ...base,
        preview: 'Use the next one on a trade you are actually considering.',
        paragraphs: [
          `Your first Tickrify read gave you a trade plan. You still have ${FREE_SIGNAL_LIMIT - 1} free trade plans, and WAIT results do not use them.`,
          'The best use of the next one: the chart of the next trade you are actually thinking about taking, before you enter.',
        ],
        cta,
        afterCta: ['If something about the first read was unclear, tell us in the feedback box on your dashboard.'],
      }),
    };
  }

  // checkout_recovery
  const weekly = `${app}/pricing?cycle=weekly`;
  if (params.declined) {
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: 'Your payment did not go through',
      html: letter({
        ...base,
        preview: 'Usually a bank setting, and it takes a minute to fix.',
        paragraphs: [
          'Your bank declined the payment for your Tickrify subscription. No money was taken.',
          'This is common with cards that have international online purchases turned off, because the charge is in US dollars. Two things usually fix it: turn on international or online purchases in your bank app, or try a different card.',
          'You can also start smaller with the weekly plan: $7.99 for 25 analyses, renews every 7 days, cancel anytime.',
        ],
        cta: { label: 'Try again', url: weekly },
        afterCta: ['If it still fails, reply with the country of your card and I will look into it.'],
      }),
    };
  }
  return {
    kind,
    unsubscribeUrl: params.unsubscribeUrl,
    subject: 'You left your Tickrify checkout',
    html: letter({
      ...base,
      preview: 'There is a smaller way to start: one week for $7.99.',
      paragraphs: [
        'You started a Tickrify subscription but did not finish it.',
        'If a monthly plan is more than you want to commit to right now, there is a weekly plan: $7.99 for 25 analyses, renews every 7 days, cancel anytime.',
        'If the payment was the problem: some banks block international payments in US dollars by default. Turning on international online purchases in your bank app, or trying a different card, usually solves it.',
      ],
      cta: { label: 'See the weekly plan', url: weekly },
      afterCta: ['If something else stopped you, reply and tell me. I read every message.'],
    }),
  };
}

// ── Varredura ──────────────────────────────────────────────────────────────

/** Qual chave do painel libera cada e-mail. */
export const LIFECYCLE_FLAG: Record<LifecycleKind, string> = {
  activation_1: 'EMAIL_ACTIVATION_NUDGE',
  activation_2: 'EMAIL_ACTIVATION_NUDGE',
  checkout_recovery: 'EMAIL_CHECKOUT_RECOVERY',
  second_analysis: 'EMAIL_SECOND_ANALYSIS_NUDGE',
};

/** Links do e-mail: nunca localhost nem URL sem protocolo. */
export function publicUrl(value: string | undefined, fallback: string): string {
  const v = (value || '').trim();
  return /^https:\/\/\S+$/.test(v) ? v.replace(/\/+$/, '') : fallback;
}

type Candidate = { userId: string; email: string; name: string | null; declined?: boolean; firstWasWait?: boolean };

export type LifecycleDeps = {
  prisma: Pick<PrismaClient, 'user' | 'adminAudit' | 'subscription'>;
  mail: { sendLifecycle(to: string, email: RenderedEmail): Promise<boolean> };
  isEnabled(kind: LifecycleKind): boolean;
  appUrl: string;
  apiBaseUrl: string;
  now?: () => Date;
  log(level: 'log' | 'warn', message: string): void;
};

async function hasAudit(deps: LifecycleDeps, userId: string, action: string): Promise<boolean> {
  return Boolean(
    await deps.prisma.adminAudit.findFirst({ where: { action, targetUserId: userId }, select: { id: true } }),
  );
}

async function isPaying(deps: LifecycleDeps, userId: string): Promise<boolean> {
  return Boolean(
    await deps.prisma.subscription.findFirst({
      where: { userId, status: { in: ['active', 'trialing'] } },
      select: { id: true },
    }),
  );
}

async function activationCandidates(deps: LifecycleDeps, kind: 'activation_1' | 'activation_2', now: Date) {
  const w = WINDOWS[kind];
  const users = await deps.prisma.user.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - w.maxAgeMs), lte: new Date(now.getTime() - w.minAgeMs) },
      email: { not: null },
      analyses: { none: { status: 'completed' } },
    },
    select: { id: true, email: true, name: true },
    take: BATCH,
  });
  return users
    .filter((u) => Boolean(u.email))
    .map((u): Candidate => ({ userId: u.id, email: u.email as string, name: u.name }));
}

/**
 * Fez UMA analise concluida (entre 24h e 72h atras) e nunca mais voltou: nenhuma
 * outra concluida nem em andamento. Gratis ainda disponivel por construcao (uma
 * analise nunca esgota os 3 planos), e assinante cai fora na varredura.
 */
async function secondAnalysisCandidates(deps: LifecycleDeps, now: Date) {
  const w = WINDOWS.second_analysis;
  const start = new Date(now.getTime() - w.maxAgeMs);
  const end = new Date(now.getTime() - w.minAgeMs);
  const users = await deps.prisma.user.findMany({
    where: {
      email: { not: null },
      AND: [
        { analyses: { some: { status: 'completed', createdAt: { gte: start, lte: end } } } },
        { analyses: { none: { status: 'completed', createdAt: { lt: start } } } },
        { analyses: { none: { status: { not: 'failed' }, createdAt: { gt: end } } } },
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
      analyses: { where: { status: 'completed' }, select: { recommendation: true }, take: 2 },
    },
    take: BATCH,
  });
  return users
    .filter((u) => Boolean(u.email) && Array.isArray(u.analyses) && u.analyses.length === 1)
    .map(
      (u): Candidate => ({
        userId: u.id,
        email: u.email as string,
        name: u.name,
        firstWasWait: !['BUY', 'SELL'].includes(String(u.analyses[0]?.recommendation || '').toUpperCase()),
      }),
    );
}

async function checkoutCandidates(deps: LifecycleDeps, now: Date) {
  const w = WINDOWS.checkout_recovery;
  const sessions = await deps.prisma.adminAudit.findMany({
    where: {
      action: 'funnel:checkout_session_created',
      targetUserId: { not: null },
      createdAt: { gte: new Date(now.getTime() - w.maxAgeMs), lte: new Date(now.getTime() - w.minAgeMs) },
    },
    select: { targetUserId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH * 2,
  });
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of sessions) {
    const userId = row.targetUserId as string;
    if (seen.has(userId)) continue;
    seen.add(userId);
    // Ainda dentro de um checkout aberto na ultima hora: espera a proxima volta.
    const recent = await deps.prisma.adminAudit.findFirst({
      where: {
        action: 'funnel:checkout_session_created',
        targetUserId: userId,
        createdAt: { gt: new Date(now.getTime() - w.minAgeMs) },
      },
      select: { id: true },
    });
    if (recent) continue;
    const user = await deps.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user?.email) continue;
    const declined = await deps.prisma.adminAudit.findFirst({
      where: { action: 'funnel:payment_failed', targetUserId: userId, createdAt: { gte: row.createdAt } },
      select: { id: true },
    });
    out.push({ userId, email: user.email, name: user.name, declined: Boolean(declined) });
  }
  return out;
}

/** Uma volta da varredura. Devolve quantos sairiam/sairam por tipo (para log e teste). */
export async function runLifecycleSweep(deps: LifecycleDeps): Promise<Record<LifecycleKind, number>> {
  const now = deps.now ? deps.now() : new Date();
  const counts: Record<LifecycleKind, number> = { activation_1: 0, activation_2: 0, checkout_recovery: 0, second_analysis: 0 };

  const jobs: Array<[LifecycleKind, () => Promise<Candidate[]>]> = [
    ['activation_1', () => activationCandidates(deps, 'activation_1', now)],
    ['activation_2', () => activationCandidates(deps, 'activation_2', now)],
    ['checkout_recovery', () => checkoutCandidates(deps, now)],
    ['second_analysis', () => secondAnalysisCandidates(deps, now)],
  ];

  for (const [kind, load] of jobs) {
    try {
      const enabled = deps.isEnabled(kind);
      const candidates = await load();
      for (const c of candidates) {
        if (await hasAudit(deps, c.userId, lifecycleAuditAction(kind))) continue;
        if (await hasAudit(deps, c.userId, UNSUBSCRIBE_AUDIT_ACTION)) continue;
        if (await isPaying(deps, c.userId)) continue;
        const url = unsubscribeUrl(deps.apiBaseUrl, c.userId);
        if (!url) {
          deps.log('warn', '[lifecycle] Sem segredo de descadastro (EMAIL_UNSUBSCRIBE_SECRET/CLERK_SECRET_KEY): nada sai.');
          return counts;
        }
        counts[kind]++;
        if (!enabled) {
          deps.log(
            'log',
            `[lifecycle] dry-run kind=${kind} user=${c.userId}${c.declined ? ' declined=1' : ''}${c.firstWasWait ? ' wait=1' : ''}`,
          );
          continue;
        }
        await deps.prisma.adminAudit.create({
          data: {
            action: lifecycleAuditAction(kind),
            targetUserId: c.userId,
            targetEmail: c.email,
            details: c.declined ? { declined: true } : {},
          },
        });
        const email = renderLifecycleEmail(kind, {
          appUrl: deps.appUrl,
          firstName: c.name ? c.name.trim().split(/\s+/)[0] : null,
          unsubscribeUrl: url,
          declined: c.declined,
          firstWasWait: c.firstWasWait,
        });
        const ok = await deps.mail.sendLifecycle(c.email, email);
        deps.log('log', `[lifecycle] kind=${kind} user=${c.userId} sent=${ok ? 1 : 0}`);
      }
    } catch (err) {
      deps.log('warn', `[lifecycle] Falha best-effort em ${kind}: ${(err as Error)?.message ?? err}`);
    }
  }
  return counts;
}
