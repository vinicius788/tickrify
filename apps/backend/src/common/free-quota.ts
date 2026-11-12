/**
 * Regra UNICA da cota gratis (usuario logado sem assinatura).
 *
 * Arquivo proprio porque a regra e lida por quatro lugares em dois processos:
 * o AiService (acesso e /usage), o worker da fila (via free-funnel e
 * recovery-email), o funil do PostHog e o e-mail de recuperacao. Antes cada um
 * repetia a mesma contagem; uma copia divergente liberaria ou bloquearia errado.
 *
 * A regra (23/09/2026):
 * - gratis = 3 analises com SINAL (BUY/SELL) ou 10 analises no total, o que
 *   vier primeiro;
 * - WAIT concluido nao consome um dos 3 sinais (conta so no total de 10);
 * - falha nao consome nada;
 * - analise em andamento conta como SINAL e no total na hora de liberar a
 *   proxima: o resultado ainda nao existe, e sem isso daria para disparar
 *   varias em paralelo e passar do limite.
 *
 * Por que: 85% das primeiras analises em producao foram WAIT. Com 3 gratis
 * contadas por analise, ~61% das pessoas nunca viam um BUY/SELL antes do paywall.
 *
 * Reset unico: `User.freeQuotaResetAt` preenchido faz a contagem olhar so as
 * analises criadas DEPOIS dele. Existe para devolver a cota a quem esgotou pela
 * regra antiga (3 analises, WAIT incluido). Preenchido a mao, por SQL; nada no
 * codigo escreve nessa coluna.
 *
 * A demo anonima do /try nao passa por aqui.
 *
 * TRIAL (13/10/2026): quem tem linha em `UserTrial` (common/trial.ts) segue a
 * regra do trial de 3 dias, no MESMO formato de resposta, para que acesso,
 * /usage, trava de leitura, funil e e-mails mudem juntos. Sem linha, tudo
 * igual a antes.
 *
 * BONUS DA OPINIAO (11/11/2026, feedback-bonus.ts): quem enviou a opiniao
 * ganha N analises. Regra antiga: os dois tetos sobem N. Ex-assinante: N
 * analises contadas a partir do credito. Trial: ver trial.ts.
 */
import { readFeedbackBonus } from './feedback-bonus';
import { TRIAL_TOTAL_ANALYSES, computeTrialState, readTrial, type TrialState } from './trial';

export const FREE_SIGNAL_LIMIT = 3;
export const FREE_TOTAL_LIMIT = 10;
/**
 * Depois de esgotar (`settledExhausted`), quantas das ultimas analises
 * concluidas continuam abertas para leitura (05/10/2026). O resto do
 * historico, o diario e marcar resultado ficam para quem assina.
 */
export const FREE_READABLE_ANALYSES = 3;

/** Recomendacoes que consomem um dos sinais gratis. O banco guarda o valor normalizado. */
const SIGNAL_RECOMMENDATIONS = ['BUY', 'SELL'];

export type FreeQuotaCounter = {
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { freeQuotaResetAt: true };
    }) => Promise<{ freeQuotaResetAt: Date | null } | null>;
  };
  analysis: {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
    /** Para o trial. Sem ele (fakes antigos de teste) ninguem esta em trial. */
    findMany?: (args: {
      where: Record<string, unknown>;
      select: { createdAt: true; status: true };
    }) => Promise<Array<{ createdAt: Date; status: string }>>;
  };
  $queryRawUnsafe?: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

export type FreeQuota = {
  /** Sinais concluidos + analises em andamento. */
  signalsUsed: number;
  signalsLimit: number;
  /** Analises nao falhadas, em andamento incluidas. */
  totalUsed: number;
  totalLimit: number;
  /** Sinais que ainda podem ser liberados (0 quando qualquer limite bateu). */
  remaining: number;
  /** Bloqueia a proxima analise. Conta o que esta em andamento. */
  exhausted: boolean;
  /**
   * Esgotada so com resultados JA conhecidos. E este que decide o e-mail de
   * recuperacao e o `free_quota_exhausted`: uma analise em andamento pode
   * terminar em WAIT e devolver a vaga, e dizer "acabou" antes disso e falso.
   */
  settledExhausted: boolean;
  /** Estado do trial de 3 dias; null = regra antiga (3 planos). */
  trial: TrialState | null;
  /**
   * Ja foi assinante da Stripe e a assinatura terminou (13/10/2026): modo
   * leitura, igual ao fim do trial. Historico inteiro aberto; nova analise,
   * diario e marcar resultado ficam para quem assina de novo.
   */
  formerSubscriber: boolean;
};

/**
 * Le a cota gratis. Consultas em sequencia (e nao Promise.all) de proposito:
 * tambem roda dentro da transacao serializavel do `enforceAccessAndCreate`,
 * que usa uma conexao so.
 */
export async function getFreeQuota(prisma: FreeQuotaCounter, userId: string): Promise<FreeQuota> {
  const trial = await getTrialQuota(prisma, userId);
  if (trial) return trial;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { freeQuotaResetAt: true } });
  const base = {
    userId,
    isDemo: true,
    ...(user?.freeQuotaResetAt ? { createdAt: { gt: user.freeQuotaResetAt } } : {}),
  };
  // Checagem de operacao (trade-state.ts) conta como analise no total.
  const checks = await freeTradeChecks(prisma, userId, user?.freeQuotaResetAt ?? null);
  const totalUsed =
    (await prisma.analysis.count({
      where: { ...base, status: { not: 'failed' } },
    })) + checks.length;
  const signalsDone = await prisma.analysis.count({
    where: { ...base, status: 'completed', recommendation: { in: SIGNAL_RECOMMENDATIONS } },
  });
  const inFlight = await prisma.analysis.count({
    where: { ...base, status: { notIn: ['failed', 'completed'] } },
  });

  const signalsUsed = signalsDone + inFlight;
  const formerSubscriber = await hadEndedSubscription(prisma, userId);
  const raw = prisma.$queryRawUnsafe?.bind(prisma);
  const bonus = raw ? await readFeedbackBonus({ $queryRawUnsafe: raw }, userId) : null;
  const pendingChecks = checks.filter((c) => c.status === 'pending').length;

  if (formerSubscriber) {
    // Modo leitura: so o bonus da opiniao libera analise, contado desde o credito.
    const since = bonus ? { userId, isDemo: true, createdAt: { gte: bonus.grantedAt } } : null;
    const bonusChecks = bonus ? checks.filter((c) => c.createdAt.getTime() >= bonus.grantedAt.getTime()) : [];
    const bonusLive = since ? (await prisma.analysis.count({ where: { ...since, status: { not: 'failed' } } })) + bonusChecks.length : 0;
    const bonusDone = since
      ? (await prisma.analysis.count({ where: { ...since, status: 'completed' } })) + bonusChecks.filter((c) => c.status !== 'pending').length
      : 0;
    const limit = bonus?.analyses ?? 0;
    return {
      signalsUsed: Math.min(bonusLive, limit),
      signalsLimit: limit,
      totalUsed,
      totalLimit: FREE_TOTAL_LIMIT + limit,
      remaining: Math.max(0, limit - bonusLive),
      exhausted: bonusLive >= limit,
      settledExhausted: bonusDone >= limit,
      trial: null,
      formerSubscriber,
    };
  }

  const signalsLimit = FREE_SIGNAL_LIMIT + (bonus?.analyses ?? 0);
  const totalLimit = FREE_TOTAL_LIMIT + (bonus?.analyses ?? 0);
  const exhausted = signalsUsed >= signalsLimit || totalUsed >= totalLimit;
  const settledExhausted = signalsDone >= signalsLimit || totalUsed - inFlight - pendingChecks >= totalLimit;

  return {
    signalsUsed,
    signalsLimit,
    totalUsed,
    totalLimit,
    remaining: exhausted ? 0 : signalsLimit - signalsUsed,
    exhausted,
    settledExhausted,
    trial: null,
    formerSubscriber,
  };
}

/**
 * Teve assinatura da Stripe que ja terminou (`canceled`). O acesso manual
 * (`manual_*`) e checkout nunca pago (`incomplete_expired`) nao contam. Quem
 * tem assinatura viva nem chega aqui (todo chamador confere o acesso pago
 * antes). Sem `$queryRawUnsafe` (fakes de teste antigos): false.
 */
export async function hadEndedSubscription(prisma: FreeQuotaCounter, userId: string): Promise<boolean> {
  const raw = prisma.$queryRawUnsafe?.bind(prisma);
  if (!raw) return false;
  try {
    const rows = await raw<Array<{ ok: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "tickrify"."Subscription" WHERE "userId" = $1 AND "stripeId" LIKE 'sub\\_%' AND "status" = 'canceled') AS ok`,
      userId,
    );
    return rows?.[0]?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Datas das checagens de operacao gratis desde `since`. Mesma protecao do
 * trial (to_regclass): roda dentro da transacao serializavel da reserva, e um
 * SELECT em tabela ausente abortaria a transacao inteira.
 */
let tradeCheckTableSeen = false;
async function freeTradeChecks(prisma: FreeQuotaCounter, userId: string, since: Date | null): Promise<Array<{ createdAt: Date; status: string }>> {
  const raw = prisma.$queryRawUnsafe?.bind(prisma);
  if (!raw) return [];
  try {
    if (!tradeCheckTableSeen) {
      const ok = await raw<Array<{ ok: boolean }>>(`SELECT to_regclass('"tickrify"."TradeCheck"') IS NOT NULL AS ok`);
      tradeCheckTableSeen = ok?.[0]?.ok === true;
      if (!tradeCheckTableSeen) return [];
    }
    const rows = await raw<Array<{ createdAt: Date; pending?: boolean }>>(
      `SELECT "createdAt", "result" = 'null'::jsonb AS "pending" FROM "tickrify"."TradeCheck" WHERE "userId" = $1 AND "isFree" = true AND "createdAt" > $2`,
      userId,
      since ?? new Date(0),
    );
    return Array.isArray(rows)
      ? rows.map((r) => ({ createdAt: new Date(r.createdAt), status: r.pending ? 'pending' : 'completed' }))
          .filter((r) => !Number.isNaN(r.createdAt.getTime()))
      : [];
  } catch {
    return [];
  }
}

/** Cota de quem esta em trial, no formato da cota gratis. null = sem trial. */
async function getTrialQuota(prisma: FreeQuotaCounter, userId: string): Promise<FreeQuota | null> {
  if (!prisma.$queryRawUnsafe || !prisma.analysis.findMany) return null;
  const row = await readTrial({ $queryRawUnsafe: prisma.$queryRawUnsafe.bind(prisma) }, userId);
  if (!row) return null;
  const analyses = await prisma.analysis.findMany({
    where: { userId, isDemo: true, createdAt: { gte: row.startedAt } },
    select: { createdAt: true, status: true },
  });
  // Checagem de operacao conta como analise no dia do trial.
  const checks = await freeTradeChecks(prisma, userId, row.startedAt);
  const state = computeTrialState(row, [...analyses, ...checks]);
  return {
    // Durante o trial "sinais" = analises do dia (WAIT conta), para o front antigo.
    signalsUsed: state.usedToday,
    signalsLimit: state.limitToday,
    totalUsed: state.totalUsed,
    totalLimit: TRIAL_TOTAL_ANALYSES,
    remaining: state.blocked ? 0 : state.remainingToday,
    exhausted: state.blocked,
    // Bonus da opiniao ainda por usar mantem a conta destravada.
    settledExhausted: state.endedSettled && state.bonusSettledRemaining <= 0,
    trial: state,
    formerSubscriber: false,
  };
}
