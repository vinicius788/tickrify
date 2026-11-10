import { Prisma } from '@prisma/client';

/**
 * Banco falso para codigo que fala por SQL cru (`$queryRaw`/`$executeRaw` em
 * template). Cada SQL cai no primeiro handler cujo trecho aparece no texto, e
 * toda chamada fica registrada com o texto e os valores, para o teste conferir
 * o que foi GRAVADO (e o que nunca foi tocado). Usado pelos specs de setups e
 * do chat; o SQL de verdade foi conferido num Postgres descartavel.
 */
export type RawSqlCall = { kind: 'query' | 'execute'; text: string; values: unknown[] };
type Handler = (text: string, values: unknown[]) => unknown;

export function sqlOf(args: unknown[]): { text: string; values: unknown[] } {
  const built = args[0] as { sql?: unknown; values?: unknown[] };
  if (typeof built?.sql === 'string') return { text: built.sql, values: built.values ?? [] };
  const [strings, ...values] = args as [TemplateStringsArray, ...unknown[]];
  const sql = Prisma.sql(strings, ...values);
  return { text: sql.sql, values: sql.values };
}

export function makeRawSqlPrisma(routes: Array<[string, Handler]>, extra: Record<string, unknown> = {}) {
  const calls: RawSqlCall[] = [];
  const run = (kind: 'query' | 'execute') =>
    jest.fn(async (...args: unknown[]) => {
      const { text, values } = sqlOf(args);
      calls.push({ kind, text, values });
      const route = routes.find(([needle]) => text.includes(needle));
      if (route) return route[1](text, values);
      return kind === 'query' ? [] : 1;
    });
  const prisma: any = {
    $executeRawUnsafe: jest.fn(async () => 0),
    $queryRaw: run('query'),
    $executeRaw: run('execute'),
    user: { findUnique: jest.fn(async () => ({ clerkUserId: 'clerk_1' })) },
    ...extra,
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, calls };
}
