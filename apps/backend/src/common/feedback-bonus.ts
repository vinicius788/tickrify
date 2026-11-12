/**
 * Opiniao que vale analises (11/11/2026): uma frase sobre a plataforma, uma
 * vez por conta, credita FEEDBACK_RULES.bonusAnalyses analises gratis.
 *
 * Arquivo proprio porque o bonus e lido pela cota gratis (free-quota.ts), pelo
 * estado do trial (trial.ts) e pelo modulo de feedback, na API e no worker. O
 * credito E a linha em `UserFeedback` (coluna `bonusAnalyses`): gravar a
 * opiniao e creditar sao o mesmo INSERT, entao nao existe opiniao sem credito
 * nem credito sem opiniao. Tabela por SQL (boot do FeedbackService + migracao
 * 20261111120000_user_feedback), fora do schema.prisma.
 */
export const FEEDBACK_RULES = {
  minLength: 15,
  maxLength: 500,
  bonusAnalyses: 3,
} as const;

export type FeedbackBonus = { grantedAt: Date; analyses: number };

export type FeedbackBonusDb = {
  $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

/**
 * Mesma protecao do trial: a leitura roda dentro da transacao serializavel que
 * reserva a analise gratis, e um SELECT em tabela ausente abortaria a
 * transacao inteira. Depois de achar a tabela, o processo nao pergunta de novo.
 */
let tableSeen = false;
async function tableExists(db: FeedbackBonusDb): Promise<boolean> {
  if (tableSeen) return true;
  try {
    const rows = await db.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT to_regclass('"tickrify"."UserFeedback"') IS NOT NULL AS ok`,
    );
    tableSeen = rows?.[0]?.ok === true;
    return tableSeen;
  } catch {
    return false;
  }
}

/** Bonus por pessoa. Quem nao enviou opiniao fica fora do mapa. Nunca lanca. */
export async function readFeedbackBonuses(db: FeedbackBonusDb, userIds: string[]): Promise<Map<string, FeedbackBonus>> {
  const out = new Map<string, FeedbackBonus>();
  if (userIds.length === 0 || !(await tableExists(db))) return out;
  try {
    const rows = await db.$queryRawUnsafe<Array<{ userId: string; createdAt: Date; bonusAnalyses: number }>>(
      `SELECT "userId", "createdAt", "bonusAnalyses" FROM "tickrify"."UserFeedback" WHERE "userId" = ANY($1::text[])`,
      userIds,
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      const grantedAt = new Date(row.createdAt);
      const analyses = Math.max(0, Math.floor(Number(row.bonusAnalyses) || 0));
      if (!Number.isNaN(grantedAt.getTime()) && analyses > 0) out.set(String(row.userId), { grantedAt, analyses });
    }
  } catch {
    /* sem bonus: a cota segue a regra de sempre */
  }
  return out;
}

export async function readFeedbackBonus(db: FeedbackBonusDb, userId: string): Promise<FeedbackBonus | null> {
  return (await readFeedbackBonuses(db, [userId])).get(userId) ?? null;
}
