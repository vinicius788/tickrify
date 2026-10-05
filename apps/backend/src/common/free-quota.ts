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
 */

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
  };
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
};

/**
 * Le a cota gratis. Consultas em sequencia (e nao Promise.all) de proposito:
 * tambem roda dentro da transacao serializavel do `enforceAccessAndCreate`,
 * que usa uma conexao so.
 */
export async function getFreeQuota(prisma: FreeQuotaCounter, userId: string): Promise<FreeQuota> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { freeQuotaResetAt: true } });
  const base = {
    userId,
    isDemo: true,
    ...(user?.freeQuotaResetAt ? { createdAt: { gt: user.freeQuotaResetAt } } : {}),
  };
  const totalUsed = await prisma.analysis.count({
    where: { ...base, status: { not: 'failed' } },
  });
  const signalsDone = await prisma.analysis.count({
    where: { ...base, status: 'completed', recommendation: { in: SIGNAL_RECOMMENDATIONS } },
  });
  const inFlight = await prisma.analysis.count({
    where: { ...base, status: { notIn: ['failed', 'completed'] } },
  });

  const signalsUsed = signalsDone + inFlight;
  const exhausted = signalsUsed >= FREE_SIGNAL_LIMIT || totalUsed >= FREE_TOTAL_LIMIT;
  const settledExhausted =
    signalsDone >= FREE_SIGNAL_LIMIT || totalUsed - inFlight >= FREE_TOTAL_LIMIT;

  return {
    signalsUsed,
    signalsLimit: FREE_SIGNAL_LIMIT,
    totalUsed,
    totalLimit: FREE_TOTAL_LIMIT,
    remaining: exhausted ? 0 : FREE_SIGNAL_LIMIT - signalsUsed,
    exhausted,
    settledExhausted,
  };
}
