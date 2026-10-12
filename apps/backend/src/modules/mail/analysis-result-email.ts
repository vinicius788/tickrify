/**
 * "O que aconteceu com a sua analise" (12/10/2026, ideia A da retencao).
 *
 * 48h depois de cada analise BUY/SELL o sweeper grava o que o mercado fez
 * (WIN, LOSS, NO_FILL, TIMEOUT). Ate aqui ninguem contava isso ao trader: ele
 * recebia o plano e nunca sabia o desfecho, e nada o chamava de volta.
 *
 * Arquivo proprio (e nao mais um tipo do lifecycle-email.ts) porque a cadencia
 * e outra: aqueles saem uma vez na vida por pessoa; este sai por ANALISE, com
 * marca por analise, agrupado em no maximo um e-mail por pessoa por dia.
 *
 * Regras:
 * - Chave EMAIL_ANALYSIS_RESULT no /admin, DESLIGADA por padrao: so loga
 *   `[analysis-result] dry-run ...`, sem gravar nada.
 * - Acerto e erro saem do mesmo jeito. Esconder o erro mataria a confianca que
 *   este e-mail existe para criar, e a /accuracy publica os mesmos numeros.
 * - So analises fechadas nas ultimas 24h: ligar a chave nao varre o historico.
 * - No maximo 1 e-mail por pessoa a cada 20h, com ate 5 analises.
 * - Marca AdminAudit `analysis_result:<id>` ANTES de enviar; envio recusado
 *   tira as marcas (a proxima volta tenta de novo, dentro das 24h).
 * - Nunca para quem se descadastrou. Assinante recebe: e retencao, nao venda.
 */
import type { PrismaClient } from '@prisma/client';
import { UNSUBSCRIBE_AUDIT_ACTION, escapeHtml, letter, unsubscribeUrl } from './lifecycle-email';

export const ANALYSIS_RESULT_FLAG = 'EMAIL_ANALYSIS_RESULT';
export const analysisResultAuditAction = (analysisId: string) => `analysis_result:${analysisId}`;

const HOUR = 60 * 60 * 1000;
const CLOSED_WITHIN_MS = 24 * HOUR;
const MIN_GAP_MS = 20 * HOUR;
const MAX_PER_EMAIL = 5;
const BATCH = 200;
const REPORTED = ['WIN', 'LOSS', 'NO_FILL', 'TIMEOUT'] as const;
type Reported = (typeof REPORTED)[number];

export type ResultItem = {
  id: string;
  symbol: string;
  timeframe: string;
  side: 'BUY' | 'SELL';
  outcome: Reported;
  createdAt: Date;
  /** R do Target 1 (so WIN); null quando os niveis nao permitem a conta. */
  tp1R: number | null;
};

/** R do Target 1 a partir dos niveis que o sweeper usou (outcomeDetail). */
export function tp1RFromDetail(detail: unknown): number | null {
  const d = detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {};
  const entry = Number(d.entry);
  const stop = Number(d.stopLoss);
  const tp1 = Number(d.takeProfit1);
  const risk = Math.abs(entry - stop);
  if (![entry, stop, tp1].every(Number.isFinite) || risk <= 0) return null;
  return Math.round((Math.abs(tp1 - entry) / risk) * 10) / 10;
}

function outcomeLine(item: ResultItem): string {
  switch (item.outcome) {
    case 'WIN':
      return item.tp1R != null ? `Target 1 reached (+${item.tp1R.toFixed(1)}R)` : 'Target 1 reached';
    case 'LOSS':
      return 'Stop hit (-1R)';
    case 'NO_FILL':
      return 'Entry never reached, so the plan never started';
    case 'TIMEOUT':
      return 'Entry touched, then neither Target 1 nor the stop within 48 hours';
  }
}

const SUBJECT_ONE: Record<Reported, string> = {
  WIN: 'Target 1 reached',
  LOSS: 'stop hit',
  NO_FILL: 'entry not reached',
  TIMEOUT: 'no target, no stop in 48 hours',
};

function readLabel(item: ResultItem): string {
  const day = item.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const tf = item.timeframe ? ` ${item.timeframe}` : '';
  return `${item.symbol}${tf}, ${item.side} (${day})`;
}

export function renderAnalysisResultEmail(params: {
  appUrl: string;
  firstName: string | null;
  items: ResultItem[];
  unsubscribeUrl: string;
}): { kind: string; subject: string; html: string; unsubscribeUrl: string } {
  const { items } = params;
  const single = items.length === 1 ? items[0] : null;
  const subject = single
    ? `Your ${single.symbol} read: ${SUBJECT_ONE[single.outcome]}`
    : `What happened to your last ${items.length} reads`;
  const lines = items.map((i) => `<b>${escapeHtml(readLabel(i))}</b>: ${escapeHtml(outcomeLine(i))}.`);
  const html = letter({
    preview: single ? `${readLabel(single)}: ${outcomeLine(single)}.` : `${items.length} of your reads were measured.`,
    firstName: params.firstName,
    paragraphs: [
      '48 hours after every read, Tickrify checks what price actually did with your plan. Here is what happened:',
      ...lines,
      'Every read is measured the same way, wins and losses. That is how you can tell whether Tickrify is worth your time.',
    ],
    cta: single
      ? { label: 'See the full read', url: `${params.appUrl}/dashboard/analysis/${encodeURIComponent(single.id)}` }
      : { label: 'Analyze a new chart', url: `${params.appUrl}/dashboard/new` },
    afterCta: [
      '<span style="font-size:13px;color:#5b6773;">Measured on 30-minute candles over the 48 hours after each read. Price touching a level is not a guaranteed fill, and spreads and fees are not included.</span>',
    ],
    unsubscribeUrl: params.unsubscribeUrl,
  });
  return { kind: 'analysis_result', subject, html, unsubscribeUrl: params.unsubscribeUrl };
}

export type AnalysisResultDeps = {
  prisma: Pick<PrismaClient, 'analysis' | 'adminAudit'>;
  mail: { sendLifecycle(to: string, email: { kind: string; subject: string; html: string; unsubscribeUrl: string }): Promise<boolean> };
  isEnabled(): boolean;
  appUrl: string;
  apiBaseUrl: string;
  now?: () => Date;
  log(level: 'log' | 'warn', message: string): void;
};

function toItem(row: {
  id: string;
  recommendation: string | null;
  outcome: string | null;
  outcomeDetail: unknown;
  result: unknown;
  createdAt: Date;
}): ResultItem | null {
  const outcome = String(row.outcome || '').toUpperCase() as Reported;
  const side = String(row.recommendation || '').toUpperCase();
  if (!REPORTED.includes(outcome) || (side !== 'BUY' && side !== 'SELL')) return null;
  const root = row.result && typeof row.result === 'object' ? (row.result as Record<string, any>) : {};
  const a = root.analysis && typeof root.analysis === 'object' ? root.analysis : root;
  const detail = row.outcomeDetail && typeof row.outcomeDetail === 'object' ? (row.outcomeDetail as Record<string, unknown>) : {};
  const symbol = String(a.symbol || detail.symbol || '').trim().slice(0, 24) || 'Chart';
  return {
    id: row.id,
    symbol,
    timeframe: String(a.timeframe || '').trim().slice(0, 12),
    side,
    outcome,
    createdAt: row.createdAt,
    tp1R: outcome === 'WIN' ? tp1RFromDetail(row.outcomeDetail) : null,
  };
}

/** Uma volta. Devolve quantas pessoas receberiam/receberam (para log e teste). */
export async function runAnalysisResultSweep(deps: AnalysisResultDeps): Promise<{ users: number; sent: number }> {
  const now = deps.now ? deps.now() : new Date();
  const enabled = deps.isEnabled();
  const rows = await deps.prisma.analysis.findMany({
    where: {
      status: 'completed',
      recommendation: { in: ['BUY', 'SELL'] },
      outcome: { in: [...REPORTED] },
      outcomeAt: { gte: new Date(now.getTime() - CLOSED_WITHIN_MS) },
      user: { email: { not: null } },
    },
    select: {
      id: true,
      userId: true,
      recommendation: true,
      outcome: true,
      outcomeDetail: true,
      result: true,
      createdAt: true,
      user: { select: { email: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  const byUser = new Map<string, typeof rows>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

  let users = 0;
  let sent = 0;
  for (const [userId, list] of byUser) {
    try {
      const email = list[0].user?.email;
      if (!email) continue;
      const unsubscribed = await deps.prisma.adminAudit.findFirst({
        where: { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: userId },
        select: { id: true },
      });
      if (unsubscribed) continue;
      const recent = await deps.prisma.adminAudit.findFirst({
        where: {
          targetUserId: userId,
          action: { startsWith: 'analysis_result:' },
          createdAt: { gt: new Date(now.getTime() - MIN_GAP_MS) },
        },
        select: { id: true },
      });
      if (recent) continue;
      const already = await deps.prisma.adminAudit.findMany({
        where: { targetUserId: userId, action: { in: list.map((r) => analysisResultAuditAction(r.id)) } },
        select: { action: true },
      });
      const done = new Set(already.map((a) => a.action));
      const items = list
        .filter((r) => !done.has(analysisResultAuditAction(r.id)))
        .map(toItem)
        .filter((i): i is ResultItem => i !== null)
        .slice(-MAX_PER_EMAIL);
      if (items.length === 0) continue;

      const url = unsubscribeUrl(deps.apiBaseUrl, userId);
      if (!url) {
        deps.log('warn', '[analysis-result] Sem segredo de descadastro (EMAIL_UNSUBSCRIBE_SECRET/CLERK_SECRET_KEY): nada sai.');
        break;
      }
      users++;
      if (!enabled) {
        deps.log('log', `[analysis-result] dry-run user=${userId} analyses=${items.length}`);
        continue;
      }
      const marks: string[] = [];
      for (const item of items) {
        const audit = await deps.prisma.adminAudit.create({
          select: { id: true },
          data: { action: analysisResultAuditAction(item.id), targetUserId: userId, targetEmail: email, details: { outcome: item.outcome } },
        });
        if (audit?.id) marks.push(audit.id);
      }
      const rendered = renderAnalysisResultEmail({
        appUrl: deps.appUrl,
        firstName: list[0].user?.name ? list[0].user.name.trim().split(/\s+/)[0] : null,
        items,
        unsubscribeUrl: url,
      });
      const ok = await deps.mail.sendLifecycle(email, rendered);
      if (!ok && marks.length) {
        await deps.prisma.adminAudit.deleteMany({ where: { id: { in: marks } } }).catch(() => undefined);
      }
      if (ok) sent++;
      deps.log('log', `[analysis-result] user=${userId} analyses=${items.length} sent=${ok ? 1 : 0}`);
    } catch (err) {
      deps.log('warn', `[analysis-result] Falha best-effort user=${userId}: ${(err as Error)?.message ?? err}`);
    }
  }
  return { users, sent };
}
