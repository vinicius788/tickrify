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
 * - Alerta automatico cujo WATCH ja venceu nunca vira e-mail.
 * - A Resend gratis e 100/dia para TODOS os e-mails do produto.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { captureServer } from '../../common/analytics/posthog';
import { candleSourceFor } from '../market/candles';
import { readPlan } from '../ai/setups.service';
import { conditionalPlanOf, storedAiLevel, storedWatchPlan, type ConditionalPlan } from '../ai/watch-pending';
import { UNSUBSCRIBE_AUDIT_ACTION, escapeHtml, letter, unsubscribeUrl } from './lifecycle-email';

export const SETUP_ALERT_EMAIL_FLAG = 'EMAIL_SETUP_ALERTS';

const HOUR = 60 * 60 * 1000;
export const SETUP_ALERT_EMAIL_RULES = {
  triggeredWithinMs: 6 * HOUR,
  perSetupGapMs: 12 * HOUR,
  perPersonPer24h: 3,
  /** Dry-run so loga disparos novos, nao o mesmo alerta a cada varredura. */
  dryRunRecentMs: 5 * 60 * 1000,
} as const;

/** Remetente da marca: alerta automatico nunca sai com o nome do dono. */
export const SETUP_ALERT_FROM = 'Tickrify <alerts@tickrify.com>';
export const SETUP_ALERT_REPLY_TO = 'support@tickrify.com';

export type AlertDirection = 'long' | 'short' | null;

/** Alerta do My assets: o nivel veio das velas, nao de uma analise. */
export const ASSET_LEVEL_DESCRIPTION = 'nearest level from recent candles';
export const ASSET_ALERT_CTA = 'Analyze chart';

/** O que o nivel e, em palavras: nunca soa como ordem executada. */
export function levelDescription(label: string, direction: AlertDirection): string {
  if (label === 'entry') {
    if (direction === 'long') return 'possible buy level from your analysis';
    if (direction === 'short') return 'possible sell level from your analysis';
    return 'entry level from your analysis';
  }
  if (label === 'stop') return 'stop from your analysis';
  if (label === 'tp1') return 'target 1 from your analysis';
  if (label === 'invalidation') return 'invalidation level from your analysis';
  return 'the level you chose';
}

export function formatLevel(level: number): string {
  return level.toLocaleString('en-US', { maximumFractionDigits: level >= 1000 ? 2 : level >= 1 ? 5 : 8 });
}

export type SetupAlertEmailItem = {
  alertId: string;
  /** null = alerta do My assets (sem setup nem analise). */
  setupId: string | null;
  symbol: string;
  timeframe: string | null;
  level: number;
  label: string;
  triggeredAt: Date;
  /** BTCUSDT, XAUUSD: decide o tamanho da vela citado no rodape. */
  priceSymbol: string;
  plan: AlertPlan;
};

/** O plano da analise do alerta, como foi gravado. Campo ausente some do e-mail. */
export type AlertPlan = {
  direction: AlertDirection;
  invalidation: number | null;
  target: number | null;
  /** WATCH com geometria valida no nivel. Nunca soa como ordem executada. */
  conditional: ConditionalPlan | null;
};

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

export function alertPlanOf(result: unknown, recommendation: string | null): AlertPlan {
  const watch = storedWatchPlan(result, recommendation);
  if (watch) return { direction: watch.direction, invalidation: watch.invalidation, target: null, conditional: conditionalPlanOf(result) };
  const ai = storedAiLevel(result, recommendation);
  if (ai) return { direction: ai.direction, invalidation: ai.invalidation, target: null, conditional: null };
  const plan = readPlan(result, recommendation);
  return {
    direction: plan.recommendation === 'BUY' ? 'long' : plan.recommendation === 'SELL' ? 'short' : null,
    invalidation: positive(record(record(result).analysis).invalidationLevel),
    target: plan.takeProfit1,
    conditional: null,
  };
}

/**
 * Link do botao: o fluxo de atualizar o setup (custo na tela antes de enviar).
 * Alerta do My assets: nova analise com o ativo ja escolhido.
 */
export function setupAlertLink(appUrl: string, item: Pick<SetupAlertEmailItem, 'setupId' | 'alertId' | 'symbol'>, source: 'email' | 'telegram' = 'email'): string {
  const params = new URLSearchParams({
    ...(item.setupId ? { setup: item.setupId } : { asset: item.symbol }),
    alert: item.alertId,
    utm_source: source,
    utm_campaign: 'setup_alert',
  });
  return `${appUrl.replace(/\/+$/, '')}/dashboard/new?${params}`;
}

export function renderSetupAlertEmail(params: {
  appUrl: string;
  firstName: string | null;
  item: SetupAlertEmailItem;
  unsubscribeUrl: string;
}): { kind: string; subject: string; html: string; unsubscribeUrl: string; from: string; replyTo: string } {
  const { item } = params;
  const level = formatLevel(item.level);
  const fromAssets = !item.setupId;
  const label = fromAssets ? ASSET_LEVEL_DESCRIPTION : levelDescription(item.label, item.plan.direction);
  const time = `${item.triggeredAt.toISOString().slice(11, 16)} UTC on ${item.triggeredAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })}`;
  const side = item.plan.direction === 'long' ? 'Buy' : item.plan.direction === 'short' ? 'Sell' : null;
  const rows = [
    side ? `<b>Direction:</b> ${side}` : null,
    `<b>Level:</b> ${escapeHtml(level)} (${escapeHtml(label)})`,
    item.plan.invalidation !== null ? `<b>Invalidation:</b> ${escapeHtml(formatLevel(item.plan.invalidation))}` : null,
    item.plan.target !== null ? `<b>Target:</b> ${escapeHtml(formatLevel(item.plan.target))}` : null,
    `<b>Reached:</b> ${escapeHtml(time)}`,
  ];
  const c = item.plan.conditional;
  const conditional = c && side
    ? `<b>Plan if price reaches ${escapeHtml(formatLevel(c.entry))}:</b> ${side.toLowerCase()} at ${escapeHtml(formatLevel(c.entry))}, stop ${escapeHtml(formatLevel(c.stopLoss))}, target ${escapeHtml(formatLevel(c.takeProfit1))} (${c.tp1R.toFixed(1)}R).`
    : null;
  const asset = `${item.symbol}${item.timeframe ? ` ${item.timeframe}` : ''}`;
  const subject = fromAssets ? `${item.symbol} reached ${level}` : `Your ${item.symbol} setup reached ${level}`;
  const html = letter({
    preview: `${item.symbol} touched ${level} (${label}) at ${time}.`,
    firstName: params.firstName,
    paragraphs: [
      fromAssets
        ? `Price reached a level you are watching on <b>${escapeHtml(asset)}</b> in My assets.`
        : `Price reached a level from your <b>${escapeHtml(asset)}</b> analysis.`,
      rows.filter(Boolean).join('<br>'),
      ...(conditional ? [conditional] : []),
      fromAssets
        ? 'Send the chart to see what the AI reads there. This is not a signal to enter.'
        : 'Update the chart to review it. This is not a signal to enter.',
    ],
    cta: { label: fromAssets ? ASSET_ALERT_CTA : 'Update chart', url: setupAlertLink(params.appUrl, item) },
    afterCta: [
      `<span style="font-size:13px;color:#5b6773;">Checked on ${candleSourceFor(item.priceSymbol) === 'crypto' ? 1 : 5}-minute candles from public price feeds. Your broker's price can differ by the spread.</span>`,
    ],
    unsubscribeUrl: params.unsubscribeUrl,
    signed: false,
  });
  return { kind: 'setup_alert', subject, html, unsubscribeUrl: params.unsubscribeUrl, from: SETUP_ALERT_FROM, replyTo: SETUP_ALERT_REPLY_TO };
}

type PendingRow = Omit<SetupAlertEmailItem, 'plan'> & {
  userId: string;
  email: string | null;
  name: string | null;
  clerkUserId: string | null;
  analysisResult: unknown;
  analysisRecommendation: string | null;
};

export type SetupAlertEmailDeps = {
  prisma: Pick<PrismaClient, '$queryRaw' | '$executeRaw' | 'adminAudit'>;
  mail: { sendLifecycle(to: string, email: { kind: string; subject: string; html: string; unsubscribeUrl: string; from: string; replyTo: string }): Promise<boolean> };
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
  // Ligado: disparos das ultimas 6h. Dry-run: so os recem-gravados, pela hora da
  // gravacao (a vela do forex pode ter aberto bem antes).
  const recent = enabled
    ? Prisma.sql`a."triggeredAt" > ${new Date(now.getTime() - SETUP_ALERT_EMAIL_RULES.triggeredWithinMs)}`
    : Prisma.sql`a."updatedAt" > ${new Date(now.getTime() - SETUP_ALERT_EMAIL_RULES.dryRunRecentMs)}`;
  const rows = await deps.prisma.$queryRaw<PendingRow[]>`
    SELECT a."id" AS "alertId", a."setupId", a."userId", a."symbol", a."priceSymbol", s."timeframe", a."level", a."label", a."triggeredAt",
      u."email", u."name", u."clerkUserId", an."result" AS "analysisResult", an."recommendation" AS "analysisRecommendation"
    FROM "tickrify"."SetupAlert" a
    LEFT JOIN "tickrify"."TrackedSetup" s ON s."id" = a."setupId" AND s."userId" = a."userId" AND s."status" = 'tracking'
    JOIN "tickrify"."User" u ON u."id" = a."userId"
    LEFT JOIN "tickrify"."Analysis" an ON an."id" = a."analysisId"
    WHERE a."status" = 'triggered' AND a."emailedAt" IS NULL AND a."seenAt" IS NULL AND ${recent}
      AND (a."setupId" IS NULL OR s."id" IS NOT NULL)
      AND (a."expiresAt" IS NULL OR a."expiresAt" > ${now})
      AND u."email" IS NOT NULL
    ORDER BY a."triggeredAt" ASC, a."id" ASC
    LIMIT 200
  `;
  let due = 0;
  let sent = 0;
  const unsubscribed = new Map<string, boolean>();
  // Do cruzamento ao envio; o cruzamento e a abertura da vela que tocou o nivel.
  const logLatency = (row: PendingRow, result: string) => {
    const at = (deps.now ? deps.now() : new Date()).getTime();
    deps.log('log', `[alerts] latency_ms=${Math.max(0, at - row.triggeredAt.getTime())} alert=${row.alertId} symbol=${row.priceSymbol} ${result}`);
  };
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
      // Mesmo intervalo por setup; no My assets, por ativo.
      const sameTarget = row.setupId
        ? Prisma.sql`"setupId" = ${row.setupId}`
        : Prisma.sql`"setupId" IS NULL AND "priceSymbol" = ${row.priceSymbol}`;
      const [limits] = await deps.prisma.$queryRaw<Array<{ setupRecent: number; personRecent: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE ${sameTarget} AND "emailedAt" > ${new Date(now.getTime() - SETUP_ALERT_EMAIL_RULES.perSetupGapMs)})::int AS "setupRecent",
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
        logLatency(row, 'dry_run=1');
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
        item: { ...row, level: Number(row.level), plan: alertPlanOf(row.analysisResult, row.analysisRecommendation) },
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
      logLatency(row, `sent=${ok ? 1 : 0}`);
    } catch (err) {
      deps.log('warn', `[setup-alert] Falha best-effort alert=${row.alertId}: ${(err as Error)?.message ?? err}`);
    }
  }
  return { due, sent };
}
