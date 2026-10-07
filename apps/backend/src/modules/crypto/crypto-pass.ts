import type { PrismaClient } from '@prisma/client';
import { getPriceId, WEEKLY_PRICE_ID } from '../../config/stripe.config';

/**
 * Passe pre-pago pago em cripto (07/10/2026). Existe porque nos paises
 * emergentes o BANCO recusa o cartao em dolar (todas as recusas desde set/26
 * vieram do emissor; a Stripe nao bloqueou nenhuma). Cripto nao passa pelo banco.
 *
 * Cobranca UNICA, sem renovacao. O passe vira uma linha em `Subscription` com
 * `stripeId = crypto_<id do CryptoPayment>`, entao ticks, paywall e a trava do
 * gratis reaproveitam o que ja existe para o cartao. O `priceId` e o do plano
 * equivalente no cartao so para resolver o tamanho do saldo (25 ou 200).
 */
export type CryptoPassKind = 'week' | 'month';

export const CRYPTO_PASSES: Record<CryptoPassKind, { priceCents: number; days: number; priceId: string }> = {
  week: { priceCents: 799, days: 7, priceId: WEEKLY_PRICE_ID },
  month: { priceCents: 2900, days: 30, priceId: getPriceId('starter', 'monthly', 'usd') },
};

export const CRYPTO_PASS_PREFIX = 'crypto_';

export function isCryptoPassId(stripeId: string | null | undefined): boolean {
  return typeof stripeId === 'string' && stripeId.startsWith(CRYPTO_PASS_PREFIX);
}

export function isCryptoPassKind(value: unknown): value is CryptoPassKind {
  return value === 'week' || value === 'month';
}

const DAY_MS = 24 * 60 * 60 * 1000;

type PassPrisma = Pick<PrismaClient, 'subscription' | '$transaction' | '$executeRaw'>;

/**
 * Vence o passe cujo fim ja passou e promove o proximo (`scheduled`, comprado
 * com outro ainda ativo). Sem `userId`, varre todos (worker). Roda no comeco de
 * toda verificacao de acesso pago: a trava entra no minuto em que o passe vence,
 * sem depender da varredura.
 */
export async function refreshCryptoPasses(
  prisma: Pick<PrismaClient, 'subscription'>,
  userId?: string,
  now = new Date(),
): Promise<{ expired: number; promoted: number }> {
  const scope = { stripeId: { startsWith: CRYPTO_PASS_PREFIX }, ...(userId ? { userId } : {}) };

  const expired = await prisma.subscription.updateMany({
    where: { ...scope, status: { in: ['active', 'scheduled'] }, currentPeriodEnd: { lte: now } },
    data: { status: 'expired' },
  });
  const promoted = await prisma.subscription.updateMany({
    where: { ...scope, status: 'scheduled', currentPeriodStart: { lte: now }, currentPeriodEnd: { gt: now } },
    data: { status: 'active' },
  });
  return { expired: expired.count, promoted: promoted.count };
}

/**
 * Libera o passe de um pagamento confirmado. Idempotente pelo `stripeId`
 * unico (`crypto_<paymentId>`): aviso repetido do provedor nao cria outro.
 * Com passe ativo ou agendado, o novo comeca quando o ultimo termina.
 */
export async function activateCryptoPass(
  prisma: PassPrisma,
  input: { userId: string; paymentId: string; kind: CryptoPassKind },
  now = new Date(),
): Promise<{ stripeId: string; status: 'active' | 'scheduled'; start: Date; end: Date; created: boolean }> {
  const pass = CRYPTO_PASSES[input.kind];
  const stripeId = `${CRYPTO_PASS_PREFIX}${input.paymentId}`;

  return prisma.$transaction(async (tx) => {
    // Dois pagamentos do mesmo usuario confirmando juntos calculariam o mesmo
    // inicio e se sobreporiam. A trava e por usuario e dura so a transacao.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`;

    const existing = await tx.subscription.findUnique({
      where: { stripeId },
      select: { status: true, currentPeriodStart: true, currentPeriodEnd: true },
    });
    if (existing?.currentPeriodStart && existing.currentPeriodEnd) {
      return {
        stripeId,
        status: existing.status === 'scheduled' ? 'scheduled' : 'active',
        start: existing.currentPeriodStart,
        end: existing.currentPeriodEnd,
        created: false,
      };
    }

    const last = await tx.subscription.findFirst({
      where: {
        userId: input.userId,
        stripeId: { startsWith: CRYPTO_PASS_PREFIX },
        status: { in: ['active', 'scheduled'] },
        currentPeriodEnd: { gt: now },
      },
      orderBy: { currentPeriodEnd: 'desc' },
      select: { currentPeriodEnd: true },
    });

    const start = last?.currentPeriodEnd && last.currentPeriodEnd > now ? last.currentPeriodEnd : now;
    const end = new Date(start.getTime() + pass.days * DAY_MS);
    const status = start.getTime() <= now.getTime() ? 'active' : 'scheduled';

    await tx.subscription.create({
      data: {
        userId: input.userId,
        stripeId,
        status,
        priceId: pass.priceId,
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
    });
    return { stripeId, status, start, end, created: true };
  });
}
