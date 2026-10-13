import { FREE_SIGNAL_LIMIT, FREE_TOTAL_LIMIT, getFreeQuota } from '../free-quota';

/**
 * Banco falso com linhas de verdade: a contagem aplica a clausula `where` que
 * `getFreeQuota` monta. Assim o teste pega erro na CLAUSULA (ex.: esquecer
 * `isDemo`), nao so na aritmetica.
 */
type Row = { userId: string; isDemo: boolean; status: string; recommendation: string | null; createdAt: Date };

function matches(row: Row, where: Record<string, any>): boolean {
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.isDemo !== undefined && row.isDemo !== where.isDemo) return false;
  const st = where.status;
  if (typeof st === 'string' && row.status !== st) return false;
  if (st && typeof st === 'object') {
    if ('not' in st && row.status === st.not) return false;
    if ('notIn' in st && st.notIn.includes(row.status)) return false;
  }
  if (where.createdAt?.gt && !(row.createdAt > where.createdAt.gt)) return false;
  const rec = where.recommendation;
  if (rec && typeof rec === 'object' && 'in' in rec && !rec.in.includes(row.recommendation)) return false;
  return true;
}

function db(rows: Array<Partial<Row>>, freeQuotaResetAt: Date | null = null) {
  const full = rows.map((r) => ({
    userId: 'u1',
    isDemo: true,
    status: 'completed',
    recommendation: 'WAIT',
    createdAt: new Date('2026-09-10T00:00:00Z'),
    ...r,
  }));
  return {
    user: { findUnique: jest.fn(async () => ({ freeQuotaResetAt })) },
    analysis: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => full.filter((r) => matches(r, where)).length),
    },
  };
}

const times = (n: number, row: Partial<Row>) => Array.from({ length: n }, () => row);

describe('getFreeQuota (regra unica da cota gratis)', () => {
  it('WAIT concluido nao consome sinal', async () => {
    const q = await getFreeQuota(db(times(3, { recommendation: 'WAIT' })), 'u1');
    expect(q).toMatchObject({ signalsUsed: 0, totalUsed: 3, remaining: 3, exhausted: false });
  });

  it('BUY e SELL consomem sinal', async () => {
    const q = await getFreeQuota(db([{ recommendation: 'BUY' }, { recommendation: 'SELL' }, { recommendation: 'WAIT' }]), 'u1');
    expect(q).toMatchObject({ signalsUsed: 2, totalUsed: 3, remaining: 1, exhausted: false });
  });

  it('3 sinais bloqueiam', async () => {
    const q = await getFreeQuota(db(times(3, { recommendation: 'BUY' })), 'u1');
    expect(q).toMatchObject({ signalsUsed: FREE_SIGNAL_LIMIT, remaining: 0, exhausted: true, settledExhausted: true });
  });

  it('10 analises no total bloqueiam, mesmo sem sinal', async () => {
    const q = await getFreeQuota(db(times(FREE_TOTAL_LIMIT, { recommendation: 'WAIT' })), 'u1');
    expect(q).toMatchObject({ signalsUsed: 0, totalUsed: 10, remaining: 0, exhausted: true, settledExhausted: true });
  });

  it('falha nao conta em nada', async () => {
    const q = await getFreeQuota(db(times(12, { status: 'failed', recommendation: null })), 'u1');
    expect(q).toMatchObject({ signalsUsed: 0, totalUsed: 0, exhausted: false });
  });

  it('analise em andamento conta como sinal para liberar a proxima, mas nao esgota o "settled"', async () => {
    const q = await getFreeQuota(
      db([{ recommendation: 'BUY' }, { recommendation: 'SELL' }, { status: 'processing', recommendation: null }]),
      'u1',
    );
    expect(q).toMatchObject({ signalsUsed: 3, totalUsed: 3, exhausted: true, settledExhausted: false });
  });

  it('pending tambem conta: disparos em paralelo nao passam do limite', async () => {
    const q = await getFreeQuota(db(times(3, { status: 'pending', recommendation: null })), 'u1');
    expect(q.exhausted).toBe(true);
  });

  it('analise paga (isDemo=false) e de outro usuario ficam fora', async () => {
    const q = await getFreeQuota(
      db([...times(5, { isDemo: false, recommendation: 'BUY' }), ...times(5, { userId: 'u2', recommendation: 'BUY' })]),
      'u1',
    );
    expect(q).toMatchObject({ signalsUsed: 0, totalUsed: 0, exhausted: false });
  });

  describe('reset unico (User.freeQuotaResetAt)', () => {
    const antigas = times(3, { recommendation: 'WAIT', createdAt: new Date('2026-09-20T00:00:00Z') });

    it('3 analises antigas + reset preenchido: cota cheia de novo', async () => {
      const q = await getFreeQuota(db(antigas, new Date('2026-09-23T12:00:00Z')), 'u1');
      expect(q).toMatchObject({ signalsUsed: 0, totalUsed: 0, remaining: 3, exhausted: false });
    });

    it('sem reset: nada muda', async () => {
      const sinais = times(3, { recommendation: 'BUY', createdAt: new Date('2026-09-20T00:00:00Z') });
      const q = await getFreeQuota(db(sinais), 'u1');
      expect(q).toMatchObject({ signalsUsed: 3, exhausted: true });
    });

    it('depois do reset, as analises novas voltam a contar', async () => {
      const q = await getFreeQuota(
        db(
          [
            ...times(3, { recommendation: 'BUY', createdAt: new Date('2026-09-20T00:00:00Z') }),
            { recommendation: 'SELL', createdAt: new Date('2026-09-24T00:00:00Z') },
          ],
          new Date('2026-09-23T12:00:00Z'),
        ),
        'u1',
      );
      expect(q).toMatchObject({ signalsUsed: 1, totalUsed: 1, remaining: 2 });
    });
  });

  it('ex-assinante (assinatura da Stripe encerrada) fica em modo leitura, mesmo com gratis sobrando', async () => {
    const fake: any = db([]);
    fake.$queryRawUnsafe = jest.fn(async (sql: string) =>
      sql.includes('"Subscription"') ? [{ ok: true }] : sql.includes('to_regclass') ? [{ ok: false }] : [],
    );
    const q = await getFreeQuota(fake, 'u1');
    expect(q).toMatchObject({ formerSubscriber: true, exhausted: true, settledExhausted: true, remaining: 0, trial: null });
  });

  it('quem nunca assinou nao e ex-assinante', async () => {
    const q = await getFreeQuota(db([]), 'u1');
    expect(q).toMatchObject({ formerSubscriber: false, exhausted: false });
  });
});
