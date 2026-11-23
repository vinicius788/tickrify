/**
 * TRIAL DE 3 DIAS SEM CARTAO (13/10/2026) — regras e estado, num lugar so.
 *
 * Substitui "3 analises gratis no total" para quem entra com a chave
 * TRIAL_MODE ligada (desligada por padrao). Nao existe cartao, cobranca
 * automatica nem trial da Stripe: a pessoa so paga quando ela mesma clica
 * para assinar.
 *
 * Regras (TRIAL_RULES):
 * - Dia de uso = dia do calendario NO FUSO DA PESSOA (navegador, guardado no
 *   trial; sem fuso, UTC) com pelo menos 1 analise. Falha nao conta. Analise
 *   em andamento conta para BLOQUEAR (senao daria para disparar varias em
 *   paralelo) mas so resultado conhecido ENCERRA o trial.
 * - Cota: dia 1 = 3, dia 2 = 2, dia 3 = 2. WAIT conta (custa o mesmo).
 * - Acaba ao esgotar a cota do 3o dia, ao comecar um 4o dia de uso ou 7 dias
 *   depois do inicio, o que vier primeiro. Depois: modo leitura (historico
 *   aberto, nada novo ate assinar).
 * - Uma conta, um trial (chave primaria em userId). Conta nova de um e-mail
 *   (normalizado) que ja usou o produto em conta mais antiga nao ganha trial
 *   nem cota gratis (`isRepeatEmailAccount`, 23/11/2026).
 *
 * Arquivo proprio (como free-quota.ts): lido pela cota gratis (API e worker),
 * pelos e-mails e pelos eventos do PostHog, em dois processos. Tabela
 * `UserTrial` criada por SQL no boot (TrialService) e na migracao
 * 20261013120000_user_trial; FORA do schema.prisma, lida por SQL.
 *
 * BONUS DA OPINIAO (11/11/2026, feedback-bonus.ts): quem enviou a opiniao tem
 * `row.bonus`. Analise feita depois do credito, num momento em que o trial ja
 * barrava (cota do dia, trial encerrado ou vencido), sai do bonus e NAO entra
 * na conta de dias do trial. A separacao mora em `computeTrialState`, entao
 * API, worker, funil e e-mails enxergam o mesmo.
 */
import { readFeedbackBonuses, type FeedbackBonus } from './feedback-bonus';

export const TRIAL_RULES = {
  /** Analises por dia de uso, na ordem dos dias. */
  dailyQuota: [3, 2, 2] as readonly number[],
  usageDays: 3,
  /** Dias corridos desde o inicio do trial. */
  windowDays: 7,
  /** Teto de gasto estimado com analises de trial por dia (UTC). */
  dailySpendCapUsd: 10,
  /** Custo medio de uma analise quick (luna, esforco low), medido em 09/09/2026. */
  estimatedCostPerAnalysisUsd: 0.0195,
  /** Trials novos por rede (IP) em 24h antes de pedir para voltar amanha. */
  maxNewTrialsPerIpPerDay: 3,
  /** Mesmo print da mesma pessoa nesta janela devolve a leitura anterior, sem IA. */
  duplicateChartWindowHours: 24,
} as const;

export const TRIAL_TOTAL_ANALYSES = TRIAL_RULES.dailyQuota.reduce((a, b) => a + b, 0);

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrialStatus = 'active' | 'ended_converted' | 'ended_unconverted' | 'denied';
export type TrialEndReason = 'completed' | 'expired';
export type TrialPaywall = 'daily_limit' | 'day3_quota' | 'fourth_day' | 'expired';

export type TrialUsageDay = {
  date: string;
  /** Analises concluidas naquele dia (fuso da pessoa). */
  count: number;
  /** `trial_day_completed` ja enviado ao PostHog. */
  reported?: boolean;
};

export type TrialRow = {
  userId: string;
  startedAt: Date;
  timezone: string | null;
  status: TrialStatus;
  endedAt: Date | null;
  endReason: TrialEndReason | null;
  convertedAt: Date | null;
  dayAtConversion: number | null;
  usageDays: TrialUsageDay[];
  analysesToday: number;
  todayDate: string | null;
  source: 'signup' | 'reactivation';
  denyReason: string | null;
  /** Credito da opiniao (feedback-bonus.ts). Ausente = nunca enviou. */
  bonus?: FeedbackBonus | null;
};

export type TrialAnalysis = { createdAt: Date; status: string };

export type TrialState = {
  /** active = ainda pode usar (talvez so amanha); ended = acabou ou negado. */
  status: 'active' | 'ended';
  endReason: TrialEndReason | null;
  /** O que a tela deve mostrar agora. null = pode analisar. */
  paywall: TrialPaywall | null;
  /** Dia de uso atual ou o proximo (1 a 3). */
  dayIndex: number;
  usedToday: number;
  limitToday: number;
  remainingToday: number;
  /** Dias com pelo menos 1 analise concluida. */
  daysUsed: number;
  usageDays: TrialUsageDay[];
  totalUsed: number;
  windowEndsAt: Date;
  timezone: string;
  today: string;
  /** Bloqueia a proxima analise (conta o que esta em andamento). */
  blocked: boolean;
  /** Acabou com resultados ja conhecidos: e o que trava a conta (modo leitura). */
  endedSettled: boolean;
  settledPaywall: TrialPaywall | null;
  /** Analises do bonus da opiniao: total creditado (0 = sem bonus). */
  bonusTotal: number;
  /** O que resta do bonus, contando analise em andamento. */
  bonusRemaining: number;
  /** O que resta do bonus so com resultados conhecidos (decide a trava). */
  bonusSettledRemaining: number;
};

/** Fuso IANA valido ou null. */
export function validTimezone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tz = value.trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Data do calendario (YYYY-MM-DD) no fuso. */
export function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Hora local (0 a 23) no fuso. */
export function localHour(date: Date, timezone: string): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/** Presentation only: next local calendar day, if it falls inside the trial window. */
export function nextTrialAvailability(state: TrialState, now = new Date()): Date | null {
  if (state.status !== 'active' || state.paywall !== 'daily_limit') return null;
  const today = localDate(now, state.timezone);
  let low = now.getTime();
  let high = low + 36 * 60 * 60 * 1000;
  // Search the calendar boundary rather than adding 24h (DST and half-hour zones).
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDate(new Date(mid), state.timezone) === today) low = mid;
    else high = mid;
  }
  return high < state.windowEndsAt.getTime() ? new Date(high) : null;
}

type Core = {
  ended: boolean;
  endReason: TrialEndReason | null;
  paywall: TrialPaywall | null;
  dayIndex: number;
  usedToday: number;
  limitToday: number;
  blocked: boolean;
  days: Map<string, number>;
};

function core(analyses: TrialAnalysis[], startedAt: Date, timezone: string, now: Date): Core {
  const days = new Map<string, number>();
  for (const a of analyses) {
    if (a.createdAt.getTime() < startedAt.getTime()) continue;
    const date = localDate(a.createdAt, timezone);
    days.set(date, (days.get(date) ?? 0) + 1);
  }
  const today = localDate(now, timezone);
  const dates = [...days.keys()].sort();
  const position = dates.indexOf(today);
  const dayIndex = position >= 0 ? position + 1 : dates.filter((d) => d < today).length + 1;
  const usedToday = days.get(today) ?? 0;
  const limitToday = dayIndex <= TRIAL_RULES.usageDays ? TRIAL_RULES.dailyQuota[dayIndex - 1] : 0;

  let paywall: TrialPaywall | null = null;
  let endReason: TrialEndReason | null = null;
  if (now.getTime() >= startedAt.getTime() + TRIAL_RULES.windowDays * DAY_MS) {
    paywall = 'expired';
    endReason = 'expired';
  } else if (dayIndex > TRIAL_RULES.usageDays) {
    paywall = 'fourth_day';
    endReason = 'completed';
  } else if (dayIndex === TRIAL_RULES.usageDays && usedToday >= limitToday) {
    paywall = 'day3_quota';
    endReason = 'completed';
  } else if (usedToday >= limitToday) {
    paywall = 'daily_limit';
  }
  const ended = endReason !== null;
  return { ended, endReason, paywall, dayIndex, usedToday, limitToday, blocked: paywall !== null, days };
}

/**
 * Estado do trial a partir das analises da pessoa (gratis, desde o inicio).
 * Funcao pura: mesma resposta na API, no worker e nos testes.
 */
export function computeTrialState(row: TrialRow, analyses: TrialAnalysis[], now = new Date()): TrialState {
  const timezone = validTimezone(row.timezone) ?? 'UTC';
  const today = localDate(now, timezone);
  const windowEndsAt = new Date(row.startedAt.getTime() + TRIAL_RULES.windowDays * DAY_MS);
  // Encerrado no banco continua encerrado (o calculo pode mudar com fuso novo).
  const storedEnd = row.status === 'ended_unconverted' || row.status === 'ended_converted' || row.status === 'denied';
  const split = splitBonus(row, analyses, timezone, storedEnd);
  const live = split.trial.filter((a) => a.status !== 'failed');
  const done = split.trial.filter((a) => a.status === 'completed');
  const all = core(live, row.startedAt, timezone, now);
  const settled = core(done, row.startedAt, timezone, now);

  const reported = new Set(row.usageDays.filter((d) => d.reported).map((d) => d.date));
  const usageDays = [...settled.days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count, ...(reported.has(date) ? { reported: true } : {}) }));

  const endedSettled = storedEnd || settled.ended;
  const ended = endedSettled || all.ended;
  const storedPaywall: TrialPaywall | null =
    row.status === 'denied' ? 'expired' : row.endReason === 'expired' ? 'expired' : row.endReason === 'completed' ? 'day3_quota' : null;
  const settledPaywall = storedEnd ? storedPaywall ?? 'expired' : settled.ended ? settled.paywall : null;
  const paywall = endedSettled ? settledPaywall : all.paywall;
  const dayIndex = Math.min(all.dayIndex, TRIAL_RULES.usageDays);
  const bonusRemaining = Math.max(0, split.total - split.used);
  const trialRemaining = ended ? 0 : Math.max(0, all.limitToday - all.usedToday);

  return {
    status: ended ? 'ended' : 'active',
    endReason: storedEnd ? row.endReason : (settled.endReason ?? all.endReason),
    // Com bonus sobrando nada barra: a tela nao mostra paywall.
    paywall: bonusRemaining > 0 ? null : paywall,
    dayIndex,
    usedToday: all.usedToday,
    limitToday: all.limitToday,
    remainingToday: trialRemaining > 0 ? trialRemaining : bonusRemaining,
    daysUsed: usageDays.length,
    usageDays,
    totalUsed: live.filter((a) => a.createdAt.getTime() >= row.startedAt.getTime()).length,
    windowEndsAt,
    timezone,
    today,
    blocked: (ended || all.blocked) && bonusRemaining <= 0,
    endedSettled,
    settledPaywall,
    bonusTotal: split.total,
    bonusRemaining,
    bonusSettledRemaining: Math.max(0, split.total - split.usedDone),
  };
}

/**
 * Separa as analises do bonus da opiniao das analises do trial. Em ordem de
 * criacao: analise feita depois do credito, enquanto o trial (so com as
 * analises do proprio trial ate ali) ja barrava, consome o bonus. Trial negado
 * pelo anti-abuso nao tem bonus. Falha nao consome nada.
 */
function splitBonus(
  row: TrialRow,
  analyses: TrialAnalysis[],
  timezone: string,
  storedEnd: boolean,
): { trial: TrialAnalysis[]; total: number; used: number; usedDone: number } {
  const bonus = row.status === 'denied' ? null : row.bonus ?? null;
  if (!bonus || bonus.analyses <= 0) return { trial: analyses, total: 0, used: 0, usedDone: 0 };
  const grantedAt = bonus.grantedAt.getTime();
  const endedAt = storedEnd ? (row.endedAt?.getTime() ?? 0) : null;
  const trial: TrialAnalysis[] = [];
  let used = 0;
  let usedDone = 0;
  for (const a of [...analyses].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    const at = a.createdAt.getTime();
    if (a.status === 'failed' || at < grantedAt || used >= bonus.analyses) {
      trial.push(a);
      continue;
    }
    const barred =
      (endedAt !== null && at >= endedAt) ||
      core(trial.filter((t) => t.status !== 'failed'), row.startedAt, timezone, a.createdAt).blocked;
    if (!barred) {
      trial.push(a);
      continue;
    }
    used += 1;
    if (a.status === 'completed') usedDone += 1;
  }
  return { trial, total: bonus.analyses, used, usedDone };
}

// ── Anti-abuso ──────────────────────────────────────────────────────────────

/**
 * Dominios de e-mail descartavel mais comuns. Lista curta de proposito: so
 * barra o que e obviamente descartavel; o resto passa (nao punir legitimo).
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamailblock.com', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com',
  'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com',
  'trashmail.de', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'mohmal.com', 'fakeinbox.com',
  'emailondeck.com', 'mailnesia.com', 'tempinbox.com', 'spamgourmet.com', 'moakt.com', 'tmpmail.org',
  'tmpmail.net', 'burnermail.io', 'mail.tm', 'mailpoof.com', 'inboxkitten.com', 'emailfake.com',
  'fakemail.net', 'mytemp.email', 'tempr.email', 'discard.email', 'luxusmail.org', 'minuteinbox.com',
]);

export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Subdominio de um descartavel (ex.: x.mailinator.com).
  return [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`));
}

// ── E-mail repetido (23/11/2026) ────────────────────────────────────────────

/**
 * Mesmo endereco de verdade, escrito de outro jeito. Minusculo, sem espacos,
 * sem "+tag"; no Gmail (googlemail.com e o mesmo) os pontos nao contam.
 * Numeros ficam: sao caixas diferentes. Sem "@" ou com parte vazia: null.
 * `normalizedEmailSql` e a mesma regra em SQL; teste .pg confere as duas.
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  const [rawLocal = '', domain = ''] = String(email ?? '').toLowerCase().replace(/\s+/g, '').split('@');
  const local = rawLocal.split('+')[0];
  if (!domain) return null;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const plain = local.replace(/\./g, '');
    return plain ? `${plain}@gmail.com` : null;
  }
  return local ? `${local}@${domain}` : null;
}

/** `normalizeEmail` em SQL (so funcoes IMMUTABLE: vira coluna gerada). */
export function normalizedEmailSql(column: string): string {
  const e = `regexp_replace(lower(${column}), '\\s', '', 'g')`;
  const local = `split_part(split_part(${e}, '@', 1), '+', 1)`;
  const domain = `split_part(${e}, '@', 2)`;
  return `CASE WHEN ${domain} IN ('gmail.com', 'googlemail.com') THEN NULLIF(replace(${local}, '.', ''), '') || '@gmail.com'
    WHEN ${domain} <> '' THEN NULLIF(${local}, '') || '@' || ${domain} END`;
}

/**
 * `User.emailNormalized`: coluna GERADA (preenche linhas antigas e novas
 * sozinha, acompanha troca de e-mail), fora do schema.prisma. Boot do
 * TrialService + migracao 20261123130000_user_email_normalized.
 */
export const USER_EMAIL_NORMALIZED_SQL = [
  `ALTER TABLE "tickrify"."User" ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT GENERATED ALWAYS AS (${normalizedEmailSql('"email"')}) STORED`,
  'CREATE INDEX IF NOT EXISTS "User_emailNormalized_idx" ON "tickrify"."User"("emailNormalized")',
];

/**
 * Fontes da checagem de conta repetida. Consulta que nunca da erro, pelo mesmo
 * motivo de `trialTableExists` (roda na transacao serializavel da reserva).
 */
let repeatSourcesSeen = false;
async function repeatSources(db: TrialDb): Promise<{ column: boolean; trial: boolean; feedback: boolean }> {
  if (repeatSourcesSeen) return { column: true, trial: true, feedback: true };
  try {
    const rows = await db.$queryRawUnsafe<Array<{ column: boolean; trial: boolean; feedback: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'tickrify' AND table_name = 'User' AND column_name = 'emailNormalized') AS "column",
              to_regclass('"tickrify"."UserTrial"') IS NOT NULL AS "trial",
              to_regclass('"tickrify"."UserFeedback"') IS NOT NULL AS "feedback"`,
    );
    const found = { column: rows?.[0]?.column === true, trial: rows?.[0]?.trial === true, feedback: rows?.[0]?.feedback === true };
    repeatSourcesSeen = found.column && found.trial && found.feedback;
    return found;
  } catch {
    return { column: false, trial: false, feedback: false };
  }
}

/**
 * Conta repetida: existe OUTRA conta, criada antes, com o mesmo e-mail
 * normalizado, que ja usou o produto (analise, trial ou opiniao). Quem apaga a
 * conta no Clerk e cadastra de novo ganha outro id; esta e a trava. A conta
 * mais antiga de cada e-mail nunca e repetida. Nunca lanca (erro = false).
 */
export async function isRepeatEmailAccount(db: TrialDb, userId: string): Promise<boolean> {
  const sources = await repeatSources(db);
  if (!sources.column) return false;
  const used = [
    `EXISTS (SELECT 1 FROM "tickrify"."Analysis" a WHERE a."userId" = o."id")`,
    ...(sources.trial ? [`EXISTS (SELECT 1 FROM "tickrify"."UserTrial" t WHERE t."userId" = o."id")`] : []),
    ...(sources.feedback ? [`EXISTS (SELECT 1 FROM "tickrify"."UserFeedback" f WHERE f."userId" = o."id")`] : []),
  ].join(' OR ');
  try {
    const rows = await db.$queryRawUnsafe<Array<{ repeat: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM "tickrify"."User" me
           JOIN "tickrify"."User" o ON o."emailNormalized" = me."emailNormalized" AND o."id" <> me."id"
          WHERE me."id" = $1
            AND (o."createdAt" < me."createdAt" OR (o."createdAt" = me."createdAt" AND o."id" < me."id"))
            AND (${used})
       ) AS "repeat"`,
      userId,
    );
    return rows?.[0]?.repeat === true;
  } catch {
    return false;
  }
}

// ── Banco (SQL cru: a tabela fica fora do schema.prisma) ───────────────────

export type TrialDb = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};
export type TrialWriteDb = TrialDb & {
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
};

const SELECT_ROW = `SELECT "userId", "startedAt", "timezone", "status", "endedAt", "endReason", "convertedAt",
  "dayAtConversion", "usageDays", "analysesToday", "todayDate", "source", "denyReason"
  FROM "tickrify"."UserTrial"`;

function toRow(raw: Record<string, unknown>): TrialRow {
  const days = Array.isArray(raw.usageDays) ? (raw.usageDays as TrialUsageDay[]) : [];
  return {
    userId: String(raw.userId),
    startedAt: new Date(raw.startedAt as string),
    timezone: (raw.timezone as string | null) ?? null,
    status: raw.status as TrialStatus,
    endedAt: raw.endedAt ? new Date(raw.endedAt as string) : null,
    endReason: (raw.endReason as TrialEndReason | null) ?? null,
    convertedAt: raw.convertedAt ? new Date(raw.convertedAt as string) : null,
    dayAtConversion: raw.dayAtConversion == null ? null : Number(raw.dayAtConversion),
    usageDays: days,
    analysesToday: Number(raw.analysesToday ?? 0),
    todayDate: (raw.todayDate as string | null) ?? null,
    source: raw.source === 'reactivation' ? 'reactivation' : 'signup',
    denyReason: (raw.denyReason as string | null) ?? null,
  };
}

/**
 * A tabela existe? Consulta que NUNCA da erro (to_regclass), de proposito: a
 * leitura do trial roda dentro da transacao serializavel que reserva a analise
 * gratis, e no Postgres um SELECT que falha (tabela ausente) aborta a
 * transacao inteira e derrubaria a analise de todo usuario gratis. Depois de
 * achar a tabela, o processo nao pergunta de novo.
 */
let trialTableSeen = false;
async function trialTableExists(db: TrialDb): Promise<boolean> {
  if (trialTableSeen) return true;
  try {
    const rows = await db.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT to_regclass('"tickrify"."UserTrial"') IS NOT NULL AS ok`,
    );
    trialTableSeen = rows[0]?.ok === true;
    return trialTableSeen;
  } catch {
    return false;
  }
}

/** Trial da pessoa, ou null (sem trial, ou tabela ainda nao existe). */
export async function readTrial(db: TrialDb, userId: string): Promise<TrialRow | null> {
  if (!(await trialTableExists(db))) return null;
  try {
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`${SELECT_ROW} WHERE "userId" = $1`, userId);
    if (!rows[0]) return null;
    return { ...toRow(rows[0]), bonus: (await readFeedbackBonuses(db, [userId])).get(userId) ?? null };
  } catch {
    return null;
  }
}

export async function readTrialsByStatus(db: TrialDb, statuses: TrialStatus[], limit = 200): Promise<TrialRow[]> {
  if (!(await trialTableExists(db))) return [];
  try {
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `${SELECT_ROW} WHERE "status" = ANY($1::text[]) ORDER BY "startedAt" DESC LIMIT ${Math.max(1, Math.floor(limit))}`,
      statuses,
    );
    const trials = rows.map(toRow);
    const bonuses = await readFeedbackBonuses(db, trials.map((t) => t.userId));
    return trials.map((t) => ({ ...t, bonus: bonuses.get(t.userId) ?? null }));
  } catch {
    return [];
  }
}

/** Grava o retrato do estado (dias, analises de hoje, status). */
export async function saveTrialSnapshot(
  db: TrialWriteDb,
  userId: string,
  patch: {
    usageDays: TrialUsageDay[];
    analysesToday: number;
    todayDate: string;
    status?: TrialStatus;
    endedAt?: Date | null;
    endReason?: TrialEndReason | null;
  },
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "tickrify"."UserTrial"
       SET "usageDays" = $2::jsonb, "analysesToday" = $3, "todayDate" = $4,
           "status" = COALESCE($5, "status"), "endedAt" = COALESCE($6, "endedAt"),
           "endReason" = COALESCE($7, "endReason"), "updatedAt" = NOW()
     WHERE "userId" = $1`,
    userId,
    JSON.stringify(patch.usageDays),
    patch.analysesToday,
    patch.todayDate,
    patch.status ?? null,
    patch.endedAt ?? null,
    patch.endReason ?? null,
  );
}

/**
 * Assinatura ativa: encerra o trial como convertido e devolve em quantos dias
 * de uso a pessoa estava ao assinar (0 = antes da 1a analise). null = sem
 * trial. Chamado pela Stripe (webhook/retorno do checkout). Nunca lanca.
 */
export async function markTrialConverted(
  db: TrialWriteDb & {
    analysis: {
      findMany: (args: {
        where: Record<string, unknown>;
        select: { createdAt: true; status: true };
      }) => Promise<Array<{ createdAt: Date; status: string }>>;
    };
  },
  userId: string,
  at = new Date(),
): Promise<number | null> {
  try {
    const row = await readTrial(db, userId);
    if (!row || row.status === 'denied') return null;
    if (row.status === 'ended_converted') return row.dayAtConversion;
    const analyses = await db.analysis.findMany({
      where: { userId, isDemo: true, createdAt: { gte: row.startedAt } },
      select: { createdAt: true, status: true },
    });
    const day = computeTrialState(row, analyses, at).daysUsed;
    await db.$executeRawUnsafe(
      `UPDATE "tickrify"."UserTrial"
          SET "status" = 'ended_converted', "convertedAt" = $2, "dayAtConversion" = $3,
              "endedAt" = COALESCE("endedAt", $2), "updatedAt" = NOW()
        WHERE "userId" = $1`,
      userId,
      at,
      day,
    );
    return day;
  } catch {
    return null;
  }
}
