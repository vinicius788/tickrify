import { TicksService } from '../ticks.service';

describe('TicksService', () => {
  let service: TicksService;
  let prisma: any;

  const balances = new Map<string, number>();
  const transactions: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    balances.clear();
    transactions.length = 0;

    prisma = {
      userTicks: {
        findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
          const balance = balances.get(where.userId);
          return typeof balance === 'number' ? { userId: where.userId, balance } : null;
        }),
        upsert: jest.fn(
          async ({
            where,
            create,
            update,
          }: {
            where: { userId: string };
            create: { userId: string; balance: number };
            update: { balance: { increment: number } };
          }) => {
            const current = balances.get(where.userId);
            if (typeof current === 'number') {
              const next = current + update.balance.increment;
              balances.set(where.userId, next);
              return { userId: where.userId, balance: next };
            }

            balances.set(create.userId, create.balance);
            return { userId: create.userId, balance: create.balance };
          },
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { userId: string };
            data: { balance: { decrement: number } };
          }) => {
            const current = balances.get(where.userId) ?? 0;
            const next = current - data.balance.decrement;
            balances.set(where.userId, next);
            return { userId: where.userId, balance: next };
          },
        ),
        // Débito atômico (guard WHERE balance >= amount): retorna count 1 se houve
        // saldo suficiente e decrementa; caso contrário count 0 (sem alterar saldo).
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { userId: string; balance?: { gte: number } };
            data: { balance: { decrement: number } };
          }) => {
            const current = balances.get(where.userId) ?? 0;
            const required = where.balance?.gte ?? 0;
            if (current < required) {
              return { count: 0 };
            }
            balances.set(where.userId, current - data.balance.decrement);
            return { count: 1 };
          },
        ),
      },
      tickTransaction: {
        findUnique: jest.fn(
          async ({ where }: { where: { stripePaymentIntentId: string } }) => {
            return (
              transactions.find(
                (tx) => tx.stripePaymentIntentId === where.stripePaymentIntentId,
              ) ?? null
            );
          },
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = { id: `tx_${transactions.length + 1}`, ...data };
          transactions.push(created);
          return created;
        }),
        findMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
          return transactions.filter((tx) => tx.userId === where.userId);
        }),
      },
      // Suporta as duas formas: callback interativo ($transaction(async (tx) => ...))
      // usado por debitTicks, e a forma de lista ($transaction([...])) usada por addTicks.
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        const results: unknown[] = [];
        for (const operation of arg) {
          results.push(await operation);
        }
        return results;
      }),
    };

    service = new TicksService(prisma);
  });

  it('retorna 0 para usuário novo', async () => {
    expect(await service.getBalance('user-new')).toBe(0);
  });

  it('adiciona Ticks corretamente', async () => {
    await service.addTicks('user-1', 20, 'Compra Starter');
    expect(await service.getBalance('user-1')).toBe(20);
  });

  it('debita 1 Tick (análise rápida)', async () => {
    await service.addTicks('user-2', 10, 'Setup');
    await service.debitTicks('user-2', 1, 'Análise rápida');
    expect(await service.getBalance('user-2')).toBe(9);
  });

  it('debita 3 Ticks (análise deep)', async () => {
    await service.addTicks('user-3', 10, 'Setup');
    await service.debitTicks('user-3', 3, 'Análise deep');
    expect(await service.getBalance('user-3')).toBe(7);
  });

  it('participa da transação do chamador sem abrir outra transação', async () => {
    await service.addTicks('user-transaction', 2, 'Setup');
    prisma.$transaction.mockClear();

    await service.debitTicks('user-transaction', 1, 'Análise rápida', { analysisType: 'quick' }, prisma);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(await service.getBalance('user-transaction')).toBe(1);
    expect(prisma.tickTransaction.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        userId: 'user-transaction', amount: -1, type: 'USAGE',
        metadata: { analysisType: 'quick' },
      }),
    });
  });

  it('lança INSUFFICIENT_TICKS com saldo insuficiente', async () => {
    await expect(service.debitTicks('user-sem-ticks', 1, 'Análise')).rejects.toThrow(
      'INSUFFICIENT_TICKS',
    );
  });

  it('lança erro se tentar debitar mais do que o saldo', async () => {
    await service.addTicks('user-4', 2, 'Setup');
    await expect(service.debitTicks('user-4', 3, 'Análise deep')).rejects.toThrow(
      'INSUFFICIENT_TICKS',
    );
  });
});
