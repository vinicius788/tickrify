/**
 * "Your XAUUSD setup reached 4,180" (27/10/2026): o gatilho de volta dos
 * alertas de nivel (setup-alerts.service.ts).
 *
 * Arquivo proprio pelo mesmo motivo do analysis-result-email.ts: a cadencia e
 * por ALERTA disparado, nao uma vez na vida por pessoa.
 *
 * Regras:
 * - Chave EMAIL_SETUP_ALERTS no /admin, DESLIGADA por padrao: so loga
 *   `[setup-alert] dry-run ...` (dos disparos recentes), sem gravar nada.
 * - So alertas disparados nas ultimas 6h: ligar a chave nao varre o passado.
 * - No maximo 1 e-mail por setup a cada 12h e 3 por pessoa em 24h.
 * - Marca `emailedAt` por UPDATE condicional ANTES de enviar (duas instancias
 *   nunca mandam dois); envio recusado pela Resend tira a marca e a proxima
 *   volta tenta de novo, dentro das 6h.
 * - Nunca para quem se descadastrou. O texto diz que nao e sinal de entrada.
 * - A Resend gratis e 100/dia para TODOS os e-mails do produto.
 */
import type { PrismaClient } from '@prisma/client';
import { captureServer } from '../../common/analytics/posthog';
import { UNSUBSCRIBE_AUDIT_ACTION, escapeHtml, letter, unsubscribeUrl } from './lifecycle-email';

export const SETUP_ALERT_EMAIL_FLAG = 'EMAIL_SETUP_ALERTS';

const HOUR = 60 * 60 * 1000;
export const SETUP_ALERT_EMAIL_RULES = {
  triggeredWithinMs: 6 * HOUR,
  perSetupGapMs: 12 * HOUR,
  perPersonPer24h: 3,
  /** Dry-run so loga disparos novos (a volta e de 10 min), nao o mesmo alerta 36 vezes. */
  dryRunRecentMs: 20 * 60 * 1000,
} as const;

const LABEL_TEXT: Record<string, string> = {
  entry: 'entry',
  stop: 'stop',
  tp1: 'Target 1',
  invalidation: 'invalidation level',
  custom: 'your level',
};

export function formatLevel(level: number): string {
  return level.toLocaleString('en-US', { maximumFractionDigits: level >= 1000 ? 2 : level >= 1 ? 5 : 8 });
}

export type SetupAlertEmailItem = {
  alertId: string;
  setupId: string;
  symbol: string;
  timeframe: string | null;
  level: number;
  label: string;
  triggeredAt: Date;
};

/** Link do botao: o fluxo de atualizar o setup (custo na tela antes de enviar). */
export function setupAlertLink(appUrl: string, item: Pick<SetupAlertEmailItem, 'setupId' | 'alertId'>): string {
  const params = new URLSearchParams({
    setup: item.setupId,
    alert: item.alertId,
    utm_source: 'email',
    utm_campaign: 'setup_alert',
  });
  return `${appUrl.replace(/\/+$/, '')}/dashboard/new?${params}`;
}

export function renderSetupAlertEmail(params: {
  appUrl: string;
  firstName: string | null;
  item: SetupAlertEmailItem;
  unsubscribeUrl: string;
}): { kind: string; subject: string; html: string; unsubscribeUrl: string } {
  const { item } = params;
  const level = formatLevel(item.level);
  const label = LABEL_TEXT[item.label] ?? LABEL_TEXT.custom;
  const time = `${item.triggeredAt.toISOString().slice(11, 16)} UTC on ${item.triggeredAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })}`;
  const asset = `${item.symbol}${item.timeframe ? ` ${item.timeframe}` : ''}`;
  const subject = `Your ${item.symbol} setup reached ${level}`;
  const html = letter({
    preview: `${item.symbol} touched ${level} (${label}) at ${time}.`,
    firstName: params.firstName,
    paragraphs: [
      `Price reached the level you asked Tickrify to watch on your <b>${escapeHtml(asset)}</b> setup.`,
      `<b>Level:</b> ${escapeHtml(level)} (${escapeHtml(label)})<br><b>Reached:</b> ${escapeHtml(time)}`,
      'Update the chart to review it. This is not a signal to enter.',
    ],
    cta: { label: 'Update the chart', url: setupAlertLink(params.appUrl, item) },
    afterCta: [
      '<span style="font-size:13px;color:#5b6773;">Checked on 5-minute candles from public price feeds. Your broker\'s price can differ by the spread.</span>',
    ],
    unsubscribeUrl: params.unsubscribeUrl,
  });
  return { kind: 'setup_alert', subject, html, unsubscribeUrl: params.unsubscribeUrl };
}

type PendingRow = SetupAlertEmailItem & { userId: string; email: string | null; name: string | null; clerkUserId: string | null };

export type SetupAlertEmailDeps = {
  prisma: Pick<PrismaClient, '$queryRaw' | '$executeRaw' | 'adminAudit'>;
  mail: { sendLifecycle(to: string, email: { kind: string; subject: string; html: string; unsubscribeUrl: string }): Promise<boolean> };
  isEnabled(): boolean;
  appUrl: string;
  apiBaseUrl: string;
  now?: () => Date;
  capture?: typeof captureServer;
  log(level: 'log' | 'warn', message: string): void;
};

/** Uma volta. Devolve quantos receberiam/receberam (para log e teste). */
export async function runSetupAlertEmailSweep(deps: SetupAlertEmailDeps): Promise<{ due: number; sent: number }> {
  const now = deps.now ? deps.now() : new Date();
  const enabled = deps.isEnabled();
  const capture = deps.capture ?? captureServer;
  const since = new Date(now.getTime() - (enabled ? SETUP_ALERT_EMAIL_RULES.triggeredWithinMs : SETUP_ALERT_EMAIL_RULES.dryRunRecentMs));
  const rows = await deps.prisma.$queryRaw<PendingRow[]>`
    SELECT a."id" AS "alertId", a."setupId", a."userId", a."symbol", s."timeframe", a."level", a."label", a."triggeredAt",
      u."email", u."name", u."clerkUserId"
    FROM "tickrify"."SetupAlert" a
    JOIN "tickrify"."TrackedSetup" s ON s."id" = a."setupId" AND s."userId" = a."userId" AND s."status" = 'tracking'
    JOIN "tickrify"."User" u ON u."id" = a."userId"
    WHERE a."status" = 'triggered' AND a."emailedAt" IS NULL AND a."seenAt" IS NULL AND a."triggeredAt" > ${since}
      AND u."email" IS NOT NULL
    ORDER BY a."triggeredAt" ASC, a."id" ASC
    LIMIT 200
  `;
  let due = 0;
  let sent = 0;
  const unsubscribed = new Map<string, boolean>();
  for (const row of rows) {
    try {
      if (!row.email) continue;
      if (!unsubscribed.has(row.userId)) {
        const hit = await deps.prisma.adminAudit.findFirst({
          where: { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: row.userId },
          select: { id: true },
        });
        unsubscribed.set(row.userId, Boolean(hit));
      }
      if (unsubscribed.get(row.userId)) continue;
      const [limits] = await deps.prisma.$queryRaw<Array<{ setupRecent: number; personRecent: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE "setupId" = ${row.setupId} AND "emailedAt" > ${new Date(now.getTime() - SETUP_ALERT_EMAIL_RULES.perSetupGapMs)})::int AS "setupRecent",
          COUNT(*) FILTER (WHERE "emailedAt" > ${new Date(now.getTime() - 24 * HOUR)})::int AS "personRecent"
        FROM "tickrify"."SetupAlert"
        WHERE "userId" = ${row.userId} AND "emailedAt" IS NOT NULL
      `;
      if (Number(limits?.setupRecent) > 0 || Number(limits?.personRecent) >= SETUP_ALERT_EMAIL_RULES.perPersonPer24h) continue;

      const url = unsubscribeUrl(deps.apiBaseUrl, row.userId);
      if (!url) {
        deps.log('warn', '[setup-alert] Sem segredo de descadastro (EMAIL_UNSUBSCRIBE_SECRET/CLERK_SECRET_KEY): nada sai.');
        break;
      }
      due++;
      if (!enabled) {
        deps.log('log', `[setup-alert] dry-run user=${row.userId} alert=${row.alertId}`);
        continue;
      }
      const claimed = await deps.prisma.$executeRaw`
        UPDATE "tickrify"."SetupAlert" SET "emailedAt" = ${now}, "updatedAt" = NOW()
        WHERE "id" = ${row.alertId} AND "emailedAt" IS NULL
      `;
      if (Number(claimed) !== 1) continue;
      const rendered = renderSetupAlertEmail({
        appUrl: deps.appUrl,
        firstName: row.name ? row.name.trim().split(/\s+/)[0] : null,
        item: { ...row, level: Number(row.level) },
        unsubscribeUrl: url,
      });
      const ok = await deps.mail.sendLifecycle(row.email, rendered);
      if (!ok) {
        await deps.prisma.$executeRaw`
          UPDATE "tickrify"."SetupAlert" SET "emailedAt" = NULL WHERE "id" = ${row.alertId} AND "emailedAt" = ${now}
        `.catch(() => undefined);
      } else {
        sent++;
        if (row.clerkUserId) {
          capture(row.clerkUserId, 'setup_alert_email_sent', { alertId: row.alertId, setupId: row.setupId, label: row.label }, {
            dedupeKey: `setup_alert_email_sent:${row.alertId}`,
          });
        }
      }
      deps.log('log', `[setup-alert] user=${row.userId} alert=${row.alertId} sent=${ok ? 1 : 0}`);
    } catch (err) {
      deps.log('warn', `[setup-alert] Falha best-effort alert=${row.alertId}: ${(err as Error)?.message ?? err}`);
    }
  }
  return { due, sent };
}
