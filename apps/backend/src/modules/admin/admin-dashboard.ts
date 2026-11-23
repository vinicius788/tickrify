/**
 * Relatorios de leitura do /admin: aba Inicio, Inspetor de analise e Usuario.
 * Tudo SQL somente leitura (`$queryRaw` parametrizado, schema `tickrify`); as
 * contas (percentil, custo, distribuicoes) moram em funcoes puras, testadas sem banco.
 */
import { Prisma } from '@prisma/client';

type RawQuerier = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Funcoes puras ───────────────────────────────────────────────────────────

/** Percentil por posicao mais proxima (p em 0..1). Lista vazia = null. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export type ReaderLite = { status?: unknown; costUsd?: unknown };

export type HomeAnalysisRow = {
  createdAt: Date;
  status: string;
  signalState: string | null;
  action: string | null;
  agreement: string | null;
  strongRead: boolean | null;
  readers: unknown;
  totalMs: number | null;
};

export type AnalysisWindow = {
  analyses: number;
  failed: number;
  byState: Record<string, number>;
  byAction: Record<string, number>;
  agreement: Record<string, number>;
  strongRead: number;
  readerFailures: number;
  readersSeen: number;
  totalMsP50: number | null;
  totalMsP90: number | null;
  costUsd: number;
  costPerAnalysisUsd: number | null;
};

const bump = (map: Record<string, number>, key: string) => {
  map[key] = (map[key] ?? 0) + 1;
};

/** Leitores gravados em `result.engine.readers`; formato fora do esperado vira lista vazia. */
export function readersOf(value: unknown): ReaderLite[] {
  return Array.isArray(value) ? value.filter((r): r is ReaderLite => !!r && typeof r === 'object') : [];
}

/** Resume um conjunto de analises (uma janela do Inicio). So analise concluida entra nas contagens de estado. */
export function summarizeAnalyses(rows: readonly HomeAnalysisRow[]): AnalysisWindow {
  const done = rows.filter((r) => r.status === 'completed');
  const out: AnalysisWindow = {
    analyses: done.length,
    failed: rows.length - done.length,
    byState: {}, byAction: {}, agreement: {},
    strongRead: 0, readerFailures: 0, readersSeen: 0,
    totalMsP50: null, totalMsP90: null, costUsd: 0, costPerAnalysisUsd: null,
  };
  const times: number[] = [];
  for (const row of done) {
    bump(out.byState, row.signalState ?? 'sem estado');
    if (row.action) bump(out.byAction, row.action);
    if (row.agreement) bump(out.agreement, row.agreement);
    if (row.strongRead === true) out.strongRead += 1;
    for (const reader of readersOf(row.readers)) {
      out.readersSeen += 1;
      if (reader.status === 'failed') out.readerFailures += 1;
      if (typeof reader.costUsd === 'number' && Number.isFinite(reader.costUsd)) out.costUsd += reader.costUsd;
    }
    if (typeof row.totalMs === 'number' && Number.isFinite(row.totalMs) && row.totalMs > 0) times.push(row.totalMs);
  }
  out.totalMsP50 = percentile(times, 0.5);
  out.totalMsP90 = percentile(times, 0.9);
  out.costPerAnalysisUsd = done.length ? out.costUsd / done.length : null;
  return out;
}

/** Percentuais de LIKE: `%` e `_` digitados pelo admin valem como letra. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 00:00 UTC do dia de `now`. */
export const startOfUtcDay = (now: Date): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// ── Inicio ──────────────────────────────────────────────────────────────────

export type HomeWindow = {
  signups: number;
  analysis: AnalysisWindow;
  alerts: { triggered: number; armed: number; invalidated: number; notified: number; notifyDelayP50Ms: number | null; notifyDelayP90Ms: number | null };
};

export type HomeReport = {
  generatedAt: string;
  today: HomeWindow;
  week: HomeWindow;
  activeTrials: number;
  subscribers: number;
  activeAlerts: number;
};

type AlertRow = { triggeredAt: Date; emailedAt: Date | null; armStatus: string | null };

function alertsWindow(rows: readonly AlertRow[]): HomeWindow['alerts'] {
  const delays = rows.flatMap((r) => (r.emailedAt ? [Math.max(0, r.emailedAt.getTime() - r.triggeredAt.getTime())] : []));
  return {
    triggered: rows.length,
    armed: rows.filter((r) => r.armStatus === 'armed').length,
    invalidated: rows.filter((r) => r.armStatus === 'invalidated').length,
    notified: delays.length,
    notifyDelayP50Ms: percentile(delays, 0.5),
    notifyDelayP90Ms: percentile(delays, 0.9),
  };
}

export async function loadHomeReport(db: RawQuerier, now: Date = new Date()): Promise<HomeReport> {
  const dayStart = startOfUtcDay(now);
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);

  const [analyses, signups, alerts, [trials], [subs], [active]] = await Promise.all([
    db.$queryRaw<HomeAnalysisRow[]>(Prisma.sql`
      SELECT a."createdAt" AS "createdAt", a."status" AS "status",
             a."result"->>'signalState' AS "signalState",
             a."result"->'codeSummary'->>'action' AS "action",
             a."result"->'engine'->'vote'->>'agreement' AS "agreement",
             (a."result"->'engine'->'vote'->>'strongRead') = 'true' AS "strongRead",
             a."result"->'engine'->'readers' AS "readers",
             NULLIF((a."result"->'engine'->'timings'->>'server_total_ms'), '')::double precision AS "totalMs"
        FROM "tickrify"."Analysis" a
       WHERE a."createdAt" >= ${weekStart}
         AND a."status" IN ('completed', 'failed')`),
    db.$queryRaw<Array<{ createdAt: Date }>>(Prisma.sql`SELECT "createdAt" FROM "tickrify"."User" WHERE "createdAt" >= ${weekStart}`),
    db.$queryRaw<Array<AlertRow>>(Prisma.sql`
      SELECT "triggeredAt", "emailedAt", "armCheck"->>'status' AS "armStatus"
        FROM "tickrify"."SetupAlert"
       WHERE "triggeredAt" >= ${weekStart}`).catch(() => [] as AlertRow[]),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n FROM "tickrify"."UserTrial" WHERE "status" = 'active'`).catch(() => [{ n: 0 }]),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT s."userId")::int AS n
        FROM "tickrify"."Subscription" s JOIN "tickrify"."User" u ON u."id" = s."userId"
       WHERE s."status" = 'active' AND s."stripeId" NOT LIKE 'manual\\_%' AND u."role" <> 'admin'`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n FROM "tickrify"."SetupAlert" WHERE "status" = 'active'`).catch(() => [{ n: 0 }]),
  ]);

  const windowOf = (from: Date): HomeWindow => ({
    signups: signups.filter((s) => s.createdAt >= from).length,
    analysis: summarizeAnalyses(analyses.filter((a) => a.createdAt >= from)),
    alerts: alertsWindow(alerts.filter((a) => a.triggeredAt >= from)),
  });

  return {
    generatedAt: now.toISOString(),
    today: windowOf(dayStart),
    week: windowOf(weekStart),
    activeTrials: trials?.n ?? 0,
    subscribers: subs?.n ?? 0,
    activeAlerts: active?.n ?? 0,
  };
}

// ── Inspetor ────────────────────────────────────────────────────────────────

export type InspectorHit = {
  id: string;
  createdAt: Date;
  email: string | null;
  symbol: string | null;
  timeframe: string | null;
  status: string;
  signalState: string | null;
  action: string | null;
  agreement: string | null;
};

/** Busca por id da analise, e-mail da pessoa ou ativo (contem, sem diferenciar caixa). Ate 50, mais novas primeiro. */
export async function searchAnalyses(db: RawQuerier, query: string): Promise<InspectorHit[]> {
  const q = query.trim();
  const like = `%${escapeLike(q)}%`;
  return db.$queryRaw<InspectorHit[]>(Prisma.sql`
    SELECT a."id" AS "id", a."createdAt" AS "createdAt", u."email" AS "email",
           a."result"->'analysis'->>'symbol' AS "symbol",
           a."result"->'analysis'->>'timeframe' AS "timeframe",
           a."status" AS "status",
           a."result"->>'signalState' AS "signalState",
           a."result"->'codeSummary'->>'action' AS "action",
           a."result"->'engine'->'vote'->>'agreement' AS "agreement"
      FROM "tickrify"."Analysis" a
      JOIN "tickrify"."User" u ON u."id" = a."userId"
     WHERE a."id" = ${q}
        OR u."email" ILIKE ${like}
        OR a."result"->'analysis'->>'symbol' ILIKE ${like}
     ORDER BY a."createdAt" DESC
     LIMIT 50`);
}

export type InspectorDetail = {
  id: string;
  createdAt: Date;
  status: string;
  errorCode: string | null;
  recommendation: string | null;
  promptVer: number | null;
  model: string | null;
  /** Caminho cru da imagem no bucket (a rota assina). */
  imageRef: string | null;
  user: { id: string; email: string | null };
  result: unknown;
  groundingStats: unknown;
  track: { status: string; outcome: string | null; touched: boolean; filled: boolean; reason: string | null; mfeR: number | null; maeR: number | null } | null;
};

export async function loadAnalysisDetail(db: RawQuerier, id: string): Promise<InspectorDetail | null> {
  const [row] = await db.$queryRaw<Array<Omit<InspectorDetail, 'user' | 'track' | 'imageRef'> & { imageUrl: string | null; userId: string; email: string | null }>>(Prisma.sql`
    SELECT a."id" AS "id", a."createdAt" AS "createdAt", a."status" AS "status", a."errorCode" AS "errorCode",
           a."recommendation" AS "recommendation", a."promptVer" AS "promptVer", a."model" AS "model",
           a."imageUrl" AS "imageUrl", a."result" AS "result", a."groundingStats" AS "groundingStats",
           a."userId" AS "userId", u."email" AS "email"
      FROM "tickrify"."Analysis" a JOIN "tickrify"."User" u ON u."id" = a."userId"
     WHERE a."id" = ${id}`);
  if (!row) return null;
  const [track] = await db.$queryRaw<NonNullable<InspectorDetail['track']>[]>(Prisma.sql`
    SELECT "status", "outcome", "touched", "filled", "reason", "mfeR", "maeR"
      FROM "tickrify"."AnalysisTrack" WHERE "analysisId" = ${id}`).catch(() => []);
  const { imageUrl, userId, email, ...rest } = row;
  return { ...rest, imageRef: imageUrl, user: { id: userId, email }, track: track ?? null };
}

// ── Usuario ─────────────────────────────────────────────────────────────────

export type UserHit = { id: string; email: string | null; name: string | null; role: string; createdAt: Date };

export async function searchUsers(db: RawQuerier, query: string): Promise<UserHit[]> {
  const like = `%${escapeLike(query.trim())}%`;
  return db.$queryRaw<UserHit[]>(Prisma.sql`
    SELECT "id", "email", "name", "role", "createdAt" FROM "tickrify"."User"
     WHERE "email" ILIKE ${like} OR "id" = ${query.trim()}
     ORDER BY "createdAt" DESC LIMIT 20`);
}

export type UserDetail = {
  user: UserHit & { plan: string; subscriptionStatus: string | null };
  subscriptions: Array<{ stripeId: string; status: string; priceId: string | null; currentPeriodEnd: Date | null; createdAt: Date }>;
  trial: { status: string; startedAt: Date; endedAt: Date | null; endReason: string | null; source: string } | null;
  analyses: { total: number; last7d: number; recent: Array<{ id: string; createdAt: Date; status: string; symbol: string | null; signalState: string | null; action: string | null }> };
  setups: Array<{ id: string; symbol: string | null; timeframe: string | null; status: string; lastAnalysisAt: Date }>;
  alerts: { byStatus: Record<string, number>; recent: Array<{ id: string; symbol: string; level: number; label: string; status: string; createdAt: Date; triggeredAt: Date | null }> };
  chat: { threadId: string; status: string; lastMessageAt: Date | null; messages: number } | null;
};

export async function loadUserDetail(db: RawQuerier, userId: string, now: Date = new Date()): Promise<UserDetail | null> {
  const [user] = await db.$queryRaw<Array<UserDetail['user']>>(Prisma.sql`
    SELECT "id", "email", "name", "role", "plan", "subscriptionStatus", "createdAt" FROM "tickrify"."User" WHERE "id" = ${userId}`);
  if (!user) return null;
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  // Tabelas criadas no boot (trial, setups, alertas, chat) podem nao existir ainda: bloco vazio, nunca erro.
  const safe = <T>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);

  const [subscriptions, trials, counts, recent, setups, alertCounts, alertsRecent, threads] = await Promise.all([
    db.$queryRaw<UserDetail['subscriptions']>(Prisma.sql`
      SELECT "stripeId", "status", "priceId", "currentPeriodEnd", "createdAt" FROM "tickrify"."Subscription"
       WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 10`),
    safe(db.$queryRaw<Array<NonNullable<UserDetail['trial']>>>(Prisma.sql`
      SELECT "status", "startedAt", "endedAt", "endReason", "source" FROM "tickrify"."UserTrial" WHERE "userId" = ${userId}`), []),
    db.$queryRaw<Array<{ total: number; last7d: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "total", COUNT(*) FILTER (WHERE "createdAt" >= ${weekStart})::int AS "last7d"
        FROM "tickrify"."Analysis" WHERE "userId" = ${userId}`),
    db.$queryRaw<UserDetail['analyses']['recent']>(Prisma.sql`
      SELECT "id", "createdAt", "status", "result"->'analysis'->>'symbol' AS "symbol",
             "result"->>'signalState' AS "signalState", "result"->'codeSummary'->>'action' AS "action"
        FROM "tickrify"."Analysis" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 15`),
    safe(db.$queryRaw<UserDetail['setups']>(Prisma.sql`
      SELECT "id", "symbol", "timeframe", "status", "lastAnalysisAt" FROM "tickrify"."TrackedSetup"
       WHERE "userId" = ${userId} ORDER BY "lastAnalysisAt" DESC LIMIT 10`), []),
    safe(db.$queryRaw<Array<{ status: string; n: number }>>(Prisma.sql`
      SELECT "status", COUNT(*)::int AS n FROM "tickrify"."SetupAlert" WHERE "userId" = ${userId} GROUP BY "status"`), []),
    safe(db.$queryRaw<UserDetail['alerts']['recent']>(Prisma.sql`
      SELECT "id", "symbol", "level", "label", "status", "createdAt", "triggeredAt" FROM "tickrify"."SetupAlert"
       WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 10`), []),
    safe(db.$queryRaw<Array<{ threadId: string; status: string; lastMessageAt: Date | null; messages: number }>>(Prisma.sql`
      SELECT t."id" AS "threadId", t."status" AS "status", t."lastMessageAt" AS "lastMessageAt",
             (SELECT COUNT(*)::int FROM "tickrify"."SupportMessage" m WHERE m."threadId" = t."id") AS "messages"
        FROM "tickrify"."SupportThread" t WHERE t."userId" = ${userId}`), []),
  ]);

  return {
    user,
    subscriptions,
    trial: trials[0] ?? null,
    analyses: { total: counts[0]?.total ?? 0, last7d: counts[0]?.last7d ?? 0, recent },
    setups,
    alerts: { byStatus: Object.fromEntries(alertCounts.map((c) => [c.status, c.n])), recent: alertsRecent },
    chat: threads[0] ?? null,
  };
}
