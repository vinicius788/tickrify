/**
 * E-mails de ciclo de vida (29/09/2026), disparados pelo worker a cada 15 min.
 *
 *   activation_1       1h a 6h depois do cadastro, sem nenhuma analise concluida
 *   activation_2       20h a 48h depois do cadastro, ainda sem analise
 *   checkout_recovery  1h a 24h depois de abrir o checkout, sem assinatura
 *                      (texto muda se a Stripe registrou recusa do banco)
 *   checkout_winback   3 a 30 dias depois de abrir o checkout, sem assinatura
 *                      (05/10/2026): segundo e ultimo toque, com o semanal.
 *                      Honesto de proposito: nao inventa erro do nosso lado
 *                      (a Stripe registrou saldo insuficiente e recusa do banco).
 *   second_analysis    24h a 72h depois da UNICA analise concluida, sem
 *                      voltar (05/10/2026; texto muda se ela foi WAIT). Medido
 *                      no PostHog em 14 dias: 38 de 96 que analisaram fizeram
 *                      so 1 analise e sumiram, e nenhum e-mail os chamava.
 *
 * Trial de 3 dias (13/10/2026, chave EMAIL_TRIAL_SEQUENCE, desligada), para
 * quem tem linha em UserTrial (essas pessoas NAO recebem activation_* nem
 * second_analysis, que falam dos 3 planos gratis):
 *   trial_first_analysis   3h a 24h depois do inicio, sem nenhuma analise
 *   trial_day2             fez so o dia 1, ao menos 20h depois, de manha no fuso
 *   trial_last_day         fez os dias 1 e 2, ao menos 20h depois, de manha no fuso
 *   trial_ended            ate 24h depois do fim sem assinar
 *   trial_ended_followup   2 dias depois do fim, de manha no fuso
 *   trial_winback_5/_10    5 e 10 dias depois do fim, de manha no fuso; depois para
 * Regra geral (todos os tipos): no maximo 1 e-mail de ciclo de vida por
 * pessoa em 20h.
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
 *   ANTES de enviar: numa corrida, melhor perder um e-mail que duplicar. Envio
 *   recusado pelo provedor tira a marca (a proxima volta tenta de novo).
 * - Nunca para assinante, nunca para quem se descadastrou
 *   (AdminAudit `email_unsubscribed`), nunca sem link de descadastro.
 * - Best-effort: nenhuma falha aqui derruba o worker.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { WELCOME_ICON_URL, cleanFirstName } from './welcome-email';
import { FREE_SIGNAL_LIMIT } from '../../common/free-quota';
import { TRIAL_RULES, localHour, type TrialRow, type TrialState } from '../../common/trial';

export type TrialEmailKind =
  | 'trial_first_analysis'
  | 'trial_day2'
  | 'trial_last_day'
  | 'trial_ended'
  | 'trial_ended_followup'
  | 'trial_winback_5'
  | 'trial_winback_10';

export type LifecycleKind =
  | 'activation_1'
  | 'activation_2'
  | 'checkout_recovery'
  | 'second_analysis'
  | 'checkout_winback'
  | TrialEmailKind;

export const TRIAL_EMAIL_KINDS: readonly TrialEmailKind[] = [
  'trial_first_analysis',
  'trial_day2',
  'trial_last_day',
  'trial_ended',
  'trial_ended_followup',
  'trial_winback_5',
  'trial_winback_10',
];

export const UNSUBSCRIBE_AUDIT_ACTION = 'email_unsubscribed';
export const lifecycleAuditAction = (kind: LifecycleKind) => `lifecycle:${kind}`;

const HOUR = 60 * 60 * 1000;
export const WINDOWS: Record<LifecycleKind, { minAgeMs: number; maxAgeMs: number }> = {
  activation_1: { minAgeMs: 1 * HOUR, maxAgeMs: 6 * HOUR },
  activation_2: { minAgeMs: 20 * HOUR, maxAgeMs: 48 * HOUR },
  checkout_recovery: { minAgeMs: 1 * HOUR, maxAgeMs: 24 * HOUR },
  // Idade da unica analise concluida.
  second_analysis: { minAgeMs: 24 * HOUR, maxAgeMs: 72 * HOUR },
  // Idade da ultima sessao de checkout aberta.
  checkout_winback: { minAgeMs: 3 * 24 * HOUR, maxAgeMs: 30 * 24 * HOUR },
  // Trial: idade do inicio (first), da ultima analise (day2, last_day) ou do fim.
  trial_first_analysis: { minAgeMs: 3 * HOUR, maxAgeMs: 24 * HOUR },
  trial_day2: { minAgeMs: 20 * HOUR, maxAgeMs: 48 * HOUR },
  trial_last_day: { minAgeMs: 20 * HOUR, maxAgeMs: 48 * HOUR },
  trial_ended: { minAgeMs: 0, maxAgeMs: 24 * HOUR },
  trial_ended_followup: { minAgeMs: 48 * HOUR, maxAgeMs: 72 * HOUR },
  trial_winback_5: { minAgeMs: 5 * 24 * HOUR, maxAgeMs: 6 * 24 * HOUR },
  trial_winback_10: { minAgeMs: 10 * 24 * HOUR, maxAgeMs: 11 * 24 * HOUR },
};
/** Nunca dois e-mails de ciclo de vida para a mesma pessoa nesta janela. */
export const ONE_EMAIL_PER_MS = 20 * HOUR;
/** "De manha" no fuso da pessoa: 8h ate antes do meio-dia. */
const MORNING = { from: 8, to: 12 };
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

export function escapeHtml(value: string): string {
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
 * fundador, nao um aviso do sistema. Marca no topo (icone + "Tickrify" em
 * texto, porque o Gmail esconde imagem de remetente novo), um botao,
 * assinatura com o icone ("Vinícius, CEO", nunca "Vini") e descadastro.
 */
export function letter(params: {
  preview: string;
  firstName: string | null;
  paragraphs: string[];
  cta: { label: string; url: string };
  afterCta?: string[];
  unsubscribeUrl: string;
  /** false: sai sem a assinatura pessoal (e-mail automatico da marca). */
  signed?: boolean;
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
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
          <tr>
            <td valign="middle" style="padding-right:8px;"><img src="${WELCOME_ICON_URL}" alt="" width="20" height="24" style="display:block;width:20px;height:24px;border:0;"></td>
            <td valign="middle" style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:#0b0f14;">Tickrify</td>
          </tr>
        </table>
        ${greeting}
        ${params.paragraphs.map(p).join('\n        ')}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
          <tr><td bgcolor="#2eb872" style="border-radius:10px;">
            <a href="${escapeHtml(params.cta.url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#04240f;text-decoration:none;border-radius:10px;">${escapeHtml(params.cta.label)}</a>
          </td></tr>
        </table>
        ${(params.afterCta ?? []).map(p).join('\n        ')}
        ${params.signed === false ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
          <tr>
            <td valign="middle" style="padding-right:12px;"><img src="${WELCOME_ICON_URL}" alt="Tickrify" width="30" height="36" style="display:block;width:30px;height:36px;border:0;"></td>
            <td valign="middle" style="font-family:${FONT};font-size:15px;line-height:21px;color:#1f2a36;"><b>Vinícius</b><br>CEO, Tickrify</td>
          </tr>
        </table>`}
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

const WEEKLY_LINE = 'The weekly plan is $7.99 for 25 analyses, renews every 7 days, and you can cancel anytime from your dashboard.';

/** Textos do trial (ingles, sem emoji, sem travessao; traducao para o dono no chat). */
export function trialCopy(
  kind: TrialEmailKind,
  app: string,
  extra: { openTradeSymbol?: string | null } = {},
): { subject: string; body: { preview: string; paragraphs: string[]; cta: { label: string; url: string }; afterCta?: string[] } } {
  const [d1, d2, d3] = TRIAL_RULES.dailyQuota;
  const analyze = { label: 'Analyze a chart', url: `${app}/dashboard/new` };
  const plans = { label: 'See the weekly plan', url: `${app}/dashboard/plans` };
  switch (kind) {
    case 'trial_first_analysis':
      return {
        subject: 'Your 3-day Tickrify trial is ready',
        body: {
          preview: 'No card needed. Your first read takes about 20 seconds.',
          paragraphs: [
            `Your free trial is ready: 3 days of use, with up to ${d1} chart analyses on the first day and ${d2} on each of the next two. No card needed.`,
            'Take a screenshot of the chart you are watching and upload it. In about 20 seconds you get the read: a buy or sell plan with entry, stop and target, an entry to wait for at a price level, or Wait with the reason.',
          ],
          cta: analyze,
          afterCta: [`The trial ends after 3 days of use or ${TRIAL_RULES.windowDays} days after it started, whichever comes first.`],
        },
      };
    case 'trial_day2':
      // Operacao marcada como aberta/pendente (estado da operacao, 13/10/2026):
      // o gancho vira acompanhar o trade, nunca "analise de novo do zero".
      if (extra.openTradeSymbol) {
        return {
          subject: `Your ${extra.openTradeSymbol} trade is still open`,
          body: {
            preview: 'Check how it is doing with a fresh screenshot.',
            paragraphs: [
              `Your ${extra.openTradeSymbol} trade is still open on Tickrify. Check how it is doing.`,
              `Open the trade and send a fresh screenshot of the same chart: you get where it stands against your stop and target, and what to watch next. Today is day 2 of your trial, with ${d2} analyses.`,
            ],
            cta: { label: 'Check my trade', url: `${app}/dashboard/trades` },
          },
        };
      }
      return {
        subject: "Yesterday's chart has moved since",
        body: {
          preview: `Day 2 of your trial: ${d2} analyses today.`,
          paragraphs: [
            'Yesterday you analyzed a chart on Tickrify. The market has moved since then.',
            `Upload a fresh screenshot of the same chart to see where it stands now. Today is day 2 of your trial, with ${d2} analyses.`,
          ],
          cta: { label: "Analyze today's chart", url: `${app}/dashboard/new` },
        },
      };
    case 'trial_last_day':
      return {
        subject: 'Last day of your Tickrify trial',
        body: {
          preview: `${d3} analyses left, today only.`,
          paragraphs: [
            `Today is the last day of your free trial, with ${d3} analyses.`,
            'Use them on the trades you are actually considering this week, before you enter.',
          ],
          cta: analyze,
        },
      };
    case 'trial_ended':
      return {
        subject: 'Your Tickrify trial has ended',
        body: {
          preview: 'Your analyses stay in your account.',
          paragraphs: [
            'Your free trial is over. Your past analyses stay in your account, and you can read them anytime.',
            `To keep analyzing: ${WEEKLY_LINE}`,
          ],
          cta: plans,
        },
      };
    case 'trial_ended_followup':
      return {
        subject: 'Still trading this week?',
        body: {
          preview: 'The smallest way to keep using Tickrify.',
          paragraphs: ['A quick reminder: the weekly plan is the smallest way to keep using Tickrify.', WEEKLY_LINE],
          cta: plans,
        },
      };
    case 'trial_winback_5':
      return {
        subject: 'Your Tickrify analyses are still here',
        body: {
          preview: 'A second opinion on your next trade, when you want it.',
          paragraphs: [
            'Your trial ended a few days ago. Your analyses are still in your account.',
            `If you want a second opinion on your next trade: ${WEEKLY_LINE}`,
          ],
          cta: plans,
        },
      };
    case 'trial_winback_10':
      return {
        subject: 'One last note from Tickrify',
        body: {
          preview: 'This is the last email about your trial.',
          paragraphs: [
            'This is the last email about your trial. If Tickrify is not for you right now, no problem.',
            `If you want it back later: ${WEEKLY_LINE}`,
          ],
          cta: plans,
          afterCta: ['If something did not work for you, reply and tell me. I read every message.'],
        },
      };
  }
}

export function renderLifecycleEmail(
  kind: LifecycleKind,
  params: {
    appUrl: string;
    firstName?: string | null;
    unsubscribeUrl: string;
    declined?: boolean;
    /** second_analysis: a unica analise foi WAIT? */
    firstWasWait?: boolean;
    /** trial_day2: ativo da operacao marcada como aberta, se houver. */
    openTradeSymbol?: string | null;
  },
): RenderedEmail {
  const app = params.appUrl.replace(/\/+$/, '');
  const firstName = cleanFirstName(params.firstName);
  const base = { firstName, unsubscribeUrl: params.unsubscribeUrl };

  if ((TRIAL_EMAIL_KINDS as readonly string[]).includes(kind)) {
    const copy = trialCopy(kind as TrialEmailKind, app, { openTradeSymbol: params.openTradeSymbol });
    return { kind, unsubscribeUrl: params.unsubscribeUrl, subject: copy.subject, html: letter({ ...base, ...copy.body }) };
  }

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
          'It takes one step: take a screenshot of the chart you are watching (a phone photo of the screen works too) and upload it. In about 20 seconds you get the read: a buy or sell plan with entry, stop and target, an entry to wait for, or Wait, with the reasoning behind it.',
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

  // checkout_recovery e checkout_winback
  const weekly = `${app}/pricing?cycle=weekly`;
  if (kind === 'checkout_winback') {
    return {
      kind,
      unsubscribeUrl: params.unsubscribeUrl,
      subject: 'Tickrify starts at $7.99 a week',
      html: letter({
        ...base,
        preview: '25 analyses, renews every 7 days, cancel anytime.',
        paragraphs: [
          'You started a Tickrify subscription recently, but it was not completed.',
          'There is a weekly plan: $7.99 for 25 analyses, renews every 7 days, and you can cancel anytime from your dashboard.',
          'If your bank blocked the payment, turning on international online purchases in your bank app usually fixes it.',
        ],
        cta: { label: 'See the weekly plan', url: weekly },
      }),
    };
  }
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
  checkout_winback: 'EMAIL_CHECKOUT_WINBACK',
  trial_first_analysis: 'EMAIL_TRIAL_SEQUENCE',
  trial_day2: 'EMAIL_TRIAL_SEQUENCE',
  trial_last_day: 'EMAIL_TRIAL_SEQUENCE',
  trial_ended: 'EMAIL_TRIAL_SEQUENCE',
  trial_ended_followup: 'EMAIL_TRIAL_SEQUENCE',
  trial_winback_5: 'EMAIL_TRIAL_SEQUENCE',
  trial_winback_10: 'EMAIL_TRIAL_SEQUENCE',
};

/** Links do e-mail: nunca localhost nem URL sem protocolo. */
export function publicUrl(value: string | undefined, fallback: string): string {
  const v = (value || '').trim();
  return /^https:\/\/\S+$/.test(v) ? v.replace(/\/+$/, '') : fallback;
}

type Candidate = {
  userId: string;
  email: string;
  name: string | null;
  declined?: boolean;
  firstWasWait?: boolean;
  openTradeSymbol?: string | null;
};

/** Trial pronto para a varredura de e-mail (estado calculado na hora da volta). */
export type TrialEmailInput = {
  row: TrialRow;
  state: TrialState;
  email: string;
  name: string | null;
  /** Ultima analise nao falhada do trial (null = nenhuma). */
  lastAnalysisAt: Date | null;
  /** Ativo de uma operacao marcada como aberta/pendente, se houver. */
  openTradeSymbol?: string | null;
};

export type LifecycleDeps = {
  prisma: Pick<PrismaClient, 'user' | 'adminAudit' | 'subscription'>;
  /** Trials ativos e encerrados sem assinar (worker). Ausente = sem e-mails de trial. */
  loadTrials?: () => Promise<TrialEmailInput[]>;
  /** Pessoa com trial (fica fora dos e-mails da regra antiga). */
  hasTrial?: (userId: string) => Promise<boolean>;
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

/**
 * Abriu o checkout entre 3 e 30 dias atras e nao assinou. Quem abriu outro
 * checkout nos ultimos 3 dias fica para a recuperacao normal (1h a 24h).
 */
async function winbackCandidates(deps: LifecycleDeps, now: Date) {
  const w = WINDOWS.checkout_winback;
  const sessions = await deps.prisma.adminAudit.findMany({
    where: {
      action: 'funnel:checkout_session_created',
      targetUserId: { not: null },
      createdAt: { gte: new Date(now.getTime() - w.maxAgeMs), lte: new Date(now.getTime() - w.minAgeMs) },
    },
    select: { targetUserId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: BATCH * 2,
  });
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of sessions) {
    const userId = row.targetUserId as string;
    if (seen.has(userId)) continue;
    seen.add(userId);
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
    out.push({ userId, email: user.email, name: user.name });
  }
  return out;
}

function trialKindFor(t: TrialEmailInput, now: Date): TrialEmailKind | null {
  const age = (from: Date | null) => (from ? now.getTime() - from.getTime() : -1);
  const inWindow = (kind: TrialEmailKind, from: Date | null) => {
    const a = age(from);
    return a >= WINDOWS[kind].minAgeMs && a <= WINDOWS[kind].maxAgeMs;
  };
  const morning = (() => {
    const h = localHour(now, t.state.timezone);
    return h >= MORNING.from && h < MORNING.to;
  })();
  if (t.row.status === 'active' && t.state.status === 'active') {
    if (t.state.totalUsed === 0 && inWindow('trial_first_analysis', t.row.startedAt)) return 'trial_first_analysis';
    if (t.state.usedToday === 0 && morning) {
      if (t.state.daysUsed === 1 && inWindow('trial_day2', t.lastAnalysisAt)) return 'trial_day2';
      if (t.state.daysUsed === 2 && inWindow('trial_last_day', t.lastAnalysisAt)) return 'trial_last_day';
    }
    return null;
  }
  if (t.row.status === 'ended_unconverted') {
    if (inWindow('trial_ended', t.row.endedAt)) return 'trial_ended';
    if (!morning) return null;
    if (inWindow('trial_ended_followup', t.row.endedAt)) return 'trial_ended_followup';
    if (inWindow('trial_winback_5', t.row.endedAt)) return 'trial_winback_5';
    if (inWindow('trial_winback_10', t.row.endedAt)) return 'trial_winback_10';
  }
  return null;
}

async function trialCandidates(deps: LifecycleDeps, kind: TrialEmailKind, now: Date): Promise<Candidate[]> {
  if (!deps.loadTrials) return [];
  const trials = await deps.loadTrials();
  return trials
    .filter((t) => trialKindFor(t, now) === kind)
    .map((t) => ({ userId: t.row.userId, email: t.email, name: t.name, openTradeSymbol: t.openTradeSymbol ?? null }));
}

/** Uma volta da varredura. Devolve quantos sairiam/sairam por tipo (para log e teste). */
export async function runLifecycleSweep(deps: LifecycleDeps): Promise<Record<LifecycleKind, number>> {
  const now = deps.now ? deps.now() : new Date();
  const counts = Object.fromEntries(Object.keys(WINDOWS).map((kind) => [kind, 0])) as Record<LifecycleKind, number>;
  // Carrega os trials uma vez por volta (os 7 tipos usam a mesma lista).
  let trialList: TrialEmailInput[] | null = null;
  const trialDeps: LifecycleDeps = {
    ...deps,
    loadTrials: deps.loadTrials
      ? async () => (trialList ??= await deps.loadTrials!())
      : undefined,
  };
  const LEGACY_FREE_KINDS: LifecycleKind[] = ['activation_1', 'activation_2', 'second_analysis'];

  const jobs: Array<[LifecycleKind, () => Promise<Candidate[]>]> = [
    ['activation_1', () => activationCandidates(deps, 'activation_1', now)],
    ['activation_2', () => activationCandidates(deps, 'activation_2', now)],
    ['checkout_recovery', () => checkoutCandidates(deps, now)],
    ['second_analysis', () => secondAnalysisCandidates(deps, now)],
    ['checkout_winback', () => winbackCandidates(deps, now)],
    ...TRIAL_EMAIL_KINDS.map(
      (kind): [LifecycleKind, () => Promise<Candidate[]>] => [kind, () => trialCandidates(trialDeps, kind, now)],
    ),
  ];

  for (const [kind, load] of jobs) {
    try {
      const enabled = deps.isEnabled(kind);
      const candidates = await load();
      for (const c of candidates) {
        if (await hasAudit(deps, c.userId, lifecycleAuditAction(kind))) continue;
        if (await hasAudit(deps, c.userId, UNSUBSCRIBE_AUDIT_ACTION)) continue;
        if (await isPaying(deps, c.userId)) continue;
        // Quem esta no trial nao recebe os e-mails que falam dos 3 planos gratis.
        if (LEGACY_FREE_KINDS.includes(kind) && deps.hasTrial && (await deps.hasTrial(c.userId))) continue;
        // No maximo 1 e-mail de ciclo de vida por pessoa em 20h.
        const recent = await deps.prisma.adminAudit.findFirst({
          where: {
            action: { startsWith: 'lifecycle:' },
            targetUserId: c.userId,
            createdAt: { gt: new Date(now.getTime() - ONE_EMAIL_PER_MS) },
          },
          select: { id: true },
        });
        if (recent) continue;
        const url = unsubscribeUrl(deps.apiBaseUrl, c.userId);
        if (!url) {
          deps.log('warn', '[lifecycle] Sem segredo de descadastro (EMAIL_UNSUBSCRIBE_SECRET/CLERK_SECRET_KEY): nada sai.');
          return counts;
        }
        counts[kind]++;
        if (!enabled) {
          deps.log(
            'log',
            `[lifecycle] dry-run kind=${kind} user=${c.userId}${c.declined ? ' declined=1' : ''}${c.firstWasWait ? ' wait=1' : ''}${c.openTradeSymbol ? ' trade=1' : ''}`,
          );
          continue;
        }
        const audit = await deps.prisma.adminAudit.create({
          select: { id: true },
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
          openTradeSymbol: c.openTradeSymbol,
        });
        const ok = await deps.mail.sendLifecycle(c.email, email);
        // Recusado (ex.: cota diaria da Resend, 06/10/2026): tira a marca e a
        // proxima volta tenta de novo, enquanto a pessoa estiver na janela.
        if (!ok && audit?.id) {
          await deps.prisma.adminAudit.delete({ where: { id: audit.id } }).catch(() => undefined);
        }
        deps.log('log', `[lifecycle] kind=${kind} user=${c.userId} sent=${ok ? 1 : 0}`);
      }
    } catch (err) {
      deps.log('warn', `[lifecycle] Falha best-effort em ${kind}: ${(err as Error)?.message ?? err}`);
    }
  }
  return counts;
}
