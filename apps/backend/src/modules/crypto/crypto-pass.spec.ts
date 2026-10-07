import { activateCryptoPass, CRYPTO_PASSES, refreshCryptoPasses } from './crypto-pass';
import { allowanceForPriceId, allowanceWindowStart } from '../../config/stripe.config';

type Row = {
  userId: string;
  stripeId: string;
  status: string;
  priceId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
};

/** Banco falso so com o que os passes usam (filtros do jeito que o codigo os escreve). */
function fakePrisma(rows: Row[] = []) {
  const matches = (row: Row, where: any): boolean => {
    if (where.userId && row.userId !== where.userId) return false;
    if (where.stripeId?.startsWith && !row.stripeId.startsWith(where.stripeId.startsWith)) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;
    if (where.currentPeriodEnd?.lte && !(row.currentPeriodEnd! <= where.currentPeriodEnd.lte)) return false;
    if (where.currentPeriodEnd?.gt && !(row.currentPeriodEnd! > where.currentPeriodEnd.gt)) return false;
    if (where.currentPeriodStart?.lte && !(row.currentPeriodStart! <= where.currentPeriodStart.lte)) return false;
    return true;
  };
  const subscription = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.stripeId === where.stripeId) ?? null),
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      if (orderBy?.currentPeriodEnd === 'desc') hit.sort((a, b) => +b.currentPeriodEnd! - +a.currentPeriodEnd!);
      return hit[0] ?? null;
    }),
    create: jest.fn(async ({ data }: any) => {
      if (rows.some((r) => r.stripeId === data.stripeId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      rows.push({ ...data });
      return data;
    }),
  };
  const prisma: any = { subscription, $executeRaw: jest.fn(async () => 1) };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  return { prisma, rows };
}

const NOW = new Date('2026-10-07T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('passe em cripto', () => {
  it('passes tem o preco e o saldo do plano equivalente no cartao', () => {
    expect(CRYPTO_PASSES.week.priceCents).toBe(799);
    expect(CRYPTO_PASSES.month.priceCents).toBe(2900);
    expect(allowanceForPriceId(CRYPTO_PASSES.week.priceId)).toBe(25);
    expect(allowanceForPriceId(CRYPTO_PASSES.month.priceId)).toBe(200);
  });

  it('janela de ticks do passe e uma so, a partir do inicio', () => {
    const start = new Date('2026-10-01T10:00:00Z');
    expect(allowanceWindowStart(start, new Date('2026-10-29T10:00:00Z'), 'pass')).toEqual(start);
  });

  it('sem passe ativo, libera na hora pelo numero de dias do passe', async () => {
    const { prisma, rows } = fakePrisma();
    const out = await activateCryptoPass(prisma, { userId: 'u1', paymentId: 'p1', kind: 'week' }, NOW);
    expect(out).toMatchObject({ stripeId: 'crypto_p1', status: 'active', created: true });
    expect(out.end.getTime() - out.start.getTime()).toBe(7 * DAY);
    expect(rows[0]).toMatchObject({ status: 'active', priceId: CRYPTO_PASSES.week.priceId });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('com passe ativo, o novo comeca quando o atual termina (agendado)', async () => {
    const end = new Date(NOW.getTime() + 3 * DAY);
    const { prisma } = fakePrisma([
      { userId: 'u1', stripeId: 'crypto_p0', status: 'active', priceId: null, currentPeriodStart: new Date(NOW.getTime() - 4 * DAY), currentPeriodEnd: end },
    ]);
    const out = await activateCryptoPass(prisma, { userId: 'u1', paymentId: 'p1', kind: 'month' }, NOW);
    expect(out.status).toBe('scheduled');
    expect(out.start).toEqual(end);
    expect(out.end.getTime() - end.getTime()).toBe(30 * DAY);
  });

  it('aviso repetido nao cria segundo passe', async () => {
    const { prisma, rows } = fakePrisma();
    await activateCryptoPass(prisma, { userId: 'u1', paymentId: 'p1', kind: 'week' }, NOW);
    const again = await activateCryptoPass(prisma, { userId: 'u1', paymentId: 'p1', kind: 'week' }, NOW);
    expect(again.created).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it('vence o passe no fim e inicia o agendado', async () => {
    const t = (d: number) => new Date(NOW.getTime() + d * DAY);
    const { prisma, rows } = fakePrisma([
      { userId: 'u1', stripeId: 'crypto_a', status: 'active', priceId: null, currentPeriodStart: t(-7), currentPeriodEnd: t(0) },
      { userId: 'u1', stripeId: 'crypto_b', status: 'scheduled', priceId: null, currentPeriodStart: t(0), currentPeriodEnd: t(30) },
      { userId: 'u1', stripeId: 'sub_card', status: 'active', priceId: null, currentPeriodStart: t(-40), currentPeriodEnd: t(-10) },
    ]);
    const out = await refreshCryptoPasses(prisma, 'u1', NOW);
    expect(out).toEqual({ expired: 1, promoted: 1 });
    expect(rows.map((r) => r.status)).toEqual(['expired', 'active', 'active']);
  });

  it('agendado que tambem ja passou vence direto, sem ficar ativo', async () => {
    const t = (d: number) => new Date(NOW.getTime() + d * DAY);
    const { prisma, rows } = fakePrisma([
      { userId: 'u1', stripeId: 'crypto_a', status: 'active', priceId: null, currentPeriodStart: t(-20), currentPeriodEnd: t(-13) },
      { userId: 'u1', stripeId: 'crypto_b', status: 'scheduled', priceId: null, currentPeriodStart: t(-13), currentPeriodEnd: t(-6) },
    ]);
    await refreshCryptoPasses(prisma, 'u1', NOW);
    expect(rows.map((r) => r.status)).toEqual(['expired', 'expired']);
  });
});
