/**
 * Eventos do trial de 3 dias, emitidos pelo BACKEND (13/10/2026).
 *
 * Arquivo proprio pelo mesmo motivo do free-funnel.ts: roda no worker (fim da
 * analise, varredura de 15 min) e na API (/usage, criacao, Stripe). O estado
 * vem de `computeTrialState` (common/trial.ts) e o retrato e gravado em
 * `UserTrial` a cada sincronizacao.
 *
 * Eventos (distinctId = id do Clerk; todos com utm_source e $referring_domain
 * do primeiro toque, para o funil por canal):
 *   trial_started         { source }
 *   trial_day_completed   { day_index, analyses_that_day }  (dia fechado, 1 vez)
 *   trial_daily_limit_hit { day_index }                     (1 vez por dia)
 *   trial_paywall_shown   { trigger }                       (1 vez por dia e gatilho)
 *   trial_ended           { reason: completed | expired, days_used }
 * A conversao nao tem evento novo: `subscription_created` e `checkout_completed`
 * ganham `trial_day_at_conversion` (stripe.service), e o `upgrade_clicked` do
 * navegador leva `trial_day` (super propriedade vinda do /usage).
 */
import { captureServer } from './posthog';
import {
  computeTrialState,
  readTrial,
  readTrialsByStatus,
  saveTrialSnapshot,
  type TrialWriteDb,
  type TrialPaywall,
  type TrialRow,
  type TrialState,
} from '../trial';

export type TrialFunnelDb = TrialWriteDb & {
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { clerkUserId: true; firstTouchAttribution: true };
    }) => Promise<{ clerkUserId: string; firstTouchAttribution: unknown } | null>;
  };
  analysis: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: { createdAt: true; status: true };
    }) => Promise<Array<{ createdAt: Date; status: string }>>;
  };
};

type Who = { clerkId: string; origin: Record<string, unknown> };

async function who(db: TrialFunnelDb, userId: string): Promise<Who | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { clerkUserId: true, firstTouchAttribution: true },
  });
  if (!user?.clerkUserId) return null;
  const touch = (user.firstTouchAttribution ?? {}) as Record<string, unknown>;
  return {
    clerkId: user.clerkUserId,
    origin: {
      utm_source: typeof touch.utmSource === 'string' && touch.utmSource ? touch.utmSource : null,
      $referring_domain: typeof touch.referrerDomain === 'string' && touch.referrerDomain ? touch.referrerDomain : null,
    },
  };
}

export async function trackTrialStarted(db: TrialFunnelDb, userId: string, source: TrialRow['source'], startedAt: Date) {
  try {
    const w = await who(db, userId);
    if (!w) return;
    captureServer(w.clerkId, 'trial_started', { source, ...w.origin }, { dedupeKey: `trial_started:${userId}`, timestamp: startedAt });
  } catch {
    /* analytics nunca derruba o fluxo */
  }
}

/** Trial negado. So o e-mail repetido emite (23/11/2026); o e-mail nunca vai ao evento. */
export async function trackTrialDenied(db: TrialFunnelDb, userId: string, reason: 'repeat_email') {
  try {
    const w = await who(db, userId);
    if (!w) return;
    captureServer(w.clerkId, 'trial_denied', { reason, ...w.origin }, { dedupeKey: `trial_denied:${userId}` });
  } catch {
    /* analytics nunca derruba o fluxo */
  }
}

/** Paywall do trial visto (pelo /usage ou por uma analise recusada). 1 vez por dia e gatilho. */
export async function trackTrialPaywallShown(db: TrialFunnelDb, userId: string, state: TrialState, trigger: TrialPaywall) {
  try {
    const w = await who(db, userId);
    if (!w) return;
    captureServer(
      w.clerkId,
      'trial_paywall_shown',
      { trigger, day_index: state.dayIndex, days_used: state.daysUsed, ...w.origin },
      { dedupeKey: `trial_paywall_shown:${userId}:${trigger}:${state.today}`, timestamp: dayStamp(state.today) },
    );
  } catch {
    /* analytics nunca derruba o fluxo */
  }
}

/** Meio-dia UTC da data local: timestamp estavel para a deduplicacao do PostHog. */
function dayStamp(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

/**
 * Le as analises, recalcula o estado, grava o retrato e emite o que mudou.
 * Chamar no fim de cada analise de trial, no /usage e na varredura. Nunca lanca.
 */
export async function syncTrial(db: TrialFunnelDb, userId: string, now = new Date()): Promise<TrialState | null> {
  try {
    const row = await readTrial(db, userId);
    if (!row || row.status === 'denied') return null;
    const analyses = await db.analysis.findMany({
      where: { userId, isDemo: true, createdAt: { gte: row.startedAt } },
      select: { createdAt: true, status: true },
    });
    const state = computeTrialState(row, analyses, now);
    const w = await who(db, userId);

    // Dias fechados (anteriores a hoje) ou o ultimo dia de um trial encerrado.
    const usageDays = state.usageDays.map((day, index) => {
      const closed = day.date < state.today || state.endedSettled;
      if (closed && !day.reported && w) {
        captureServer(
          w.clerkId,
          'trial_day_completed',
          { day_index: index + 1, analyses_that_day: day.count, ...w.origin },
          { dedupeKey: `trial_day_completed:${userId}:${day.date}`, timestamp: dayStamp(day.date) },
        );
        return { ...day, reported: true };
      }
      return day;
    });

    if (w && state.paywall === 'daily_limit') {
      captureServer(
        w.clerkId,
        'trial_daily_limit_hit',
        { day_index: state.dayIndex, analyses_that_day: state.usedToday, ...w.origin },
        { dedupeKey: `trial_daily_limit_hit:${userId}:${state.today}`, timestamp: dayStamp(state.today) },
      );
    }

    const endsNow = row.status === 'active' && state.endedSettled && state.endReason !== null;
    if (endsNow && w) {
      captureServer(
        w.clerkId,
        'trial_ended',
        { reason: state.endReason, days_used: state.daysUsed, analyses_used: state.totalUsed, ...w.origin },
        { dedupeKey: `trial_ended:${userId}`, timestamp: now },
      );
    }

    await saveTrialSnapshot(db, userId, {
      usageDays,
      analysesToday: state.usedToday,
      todayDate: state.today,
      ...(endsNow ? { status: 'ended_unconverted' as const, endedAt: now, endReason: state.endReason } : {}),
    });
    return { ...state, usageDays };
  } catch {
    return null;
  }
}

/**
 * Varredura do worker (a cada 15 min): sincroniza os trials ativos (encerra
 * quem passou dos 7 dias, fecha os dias de ontem) e devolve os trials para os
 * e-mails, com o estado calculado agora.
 */
export async function loadTrialsForSweep(
  db: TrialFunnelDb & {
    user: TrialFunnelDb['user'] & {
      findMany: (args: {
        where: { id: { in: string[] } };
        select: { id: true; email: true; name: true };
      }) => Promise<Array<{ id: string; email: string | null; name: string | null }>>;
    };
  },
  now = new Date(),
): Promise<
  Array<{ row: TrialRow; state: TrialState; email: string; name: string | null; lastAnalysisAt: Date | null; openTradeSymbol: string | null }>
> {
  const active = await readTrialsByStatus(db, ['active'], 500);
  for (const row of active) await syncTrial(db, row.userId, now);
  const rows = await readTrialsByStatus(db, ['active', 'ended_unconverted'], 500);
  if (rows.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, email: true, name: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  const out = [];
  for (const row of rows) {
    const user = byId.get(row.userId);
    if (!user?.email) continue;
    const analyses = await db.analysis.findMany({
      where: { userId: row.userId, isDemo: true, createdAt: { gte: row.startedAt } },
      select: { createdAt: true, status: true },
    });
    const live = analyses.filter((a) => a.status !== 'failed').map((a) => a.createdAt.getTime());
    // Operacao marcada como aberta/pendente (estado da operacao): muda o gancho do dia 2.
    const openTrade = await db
      .$queryRawUnsafe<Array<{ symbol: string | null }>>(
        `SELECT "symbol" FROM "tickrify"."TradeState" WHERE "userId" = $1 AND "status" IN ('pending_order', 'in_trade') ORDER BY "updatedAt" DESC LIMIT 1`,
        row.userId,
      )
      .catch(() => []);
    out.push({
      row,
      state: computeTrialState(row, analyses, now),
      email: user.email,
      name: user.name,
      lastAnalysisAt: live.length ? new Date(Math.max(...live)) : null,
      openTradeSymbol: openTrade[0]?.symbol ?? null,
    });
  }
  return out;
}
