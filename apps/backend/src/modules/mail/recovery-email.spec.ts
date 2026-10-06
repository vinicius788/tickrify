jest.mock('../../common/utils/clerk-email', () => ({
  fetchClerkEmail: jest.fn().mockResolvedValue(null),
}));

import { notifyIfFreeQuotaExhausted, retryRecoveryEmails, type RecoveryEmailDeps } from './recovery-email';

/**
 * `analysis.count` falso que responde pela clausula, na mesma forma que
 * `getFreeQuota` pergunta: total nao falhado, sinais concluidos e em andamento.
 */
function quotaCount(q: { signals: number; total?: number; inFlight?: number }) {
  const inFlight = q.inFlight ?? 0;
  const total = q.total ?? q.signals + inFlight;
  return jest.fn(async ({ where }: { where: Record<string, any> }) => {
    if (where.status === 'completed') return q.signals;
    if (where.status && typeof where.status === 'object' && 'notIn' in where.status) return inFlight;
    return total;
  });
}

function makeDeps(opts: { quota: { signals: number; total?: number; inFlight?: number }; alreadySent?: boolean; paid?: boolean; email?: string | null; offerActive?: boolean; sendOk?: boolean }) {
  const sendRecovery = jest.fn().mockResolvedValue(opts.sendOk ?? true);
  const auditCreate = jest.fn().mockResolvedValue({ id: 'audit_1' });
  const auditDelete = jest.fn().mockResolvedValue({});
  const deps = {
    prisma: {
      analysis: { count: quotaCount(opts.quota) },
      adminAudit: {
        findFirst: jest.fn().mockResolvedValue(opts.alreadySent ? { id: 'a1' } : null),
        create: auditCreate,
        delete: auditDelete,
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: opts.email === undefined ? 'ana@example.com' : opts.email, clerkUserId: 'clerk_1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    },
    mail: { sendRecovery },
    hasPaidAccess: jest.fn().mockResolvedValue(Boolean(opts.paid)),
    foundingOffer: jest.fn().mockResolvedValue({ active: opts.offerActive ?? true, code: 'EARLY35', percentOff: 35 }),
    log: jest.fn(),
  } as unknown as RecoveryEmailDeps;
  return { deps, sendRecovery, auditCreate, auditDelete };
}

describe('notifyIfFreeQuotaExhausted', () => {
  it('terceiro sinal gratis concluido: registra e envia uma vez', async () => {
    const { deps, sendRecovery, auditCreate } = makeDeps({ quota: { signals: 3 } });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('recovery_email_sent');
    expect(sendRecovery).toHaveBeenCalledWith('ana@example.com', expect.objectContaining({ code: 'EARLY35' }));
  });

  it('cupom esgotado: o e-mail sai sem oferta', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 3 }, offerActive: false });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).toHaveBeenCalledWith('ana@example.com', null);
  });

  it('consulta da oferta quebra: o e-mail sai mesmo assim, sem oferta', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 3 } });
    (deps as any).foundingOffer = () => {
      throw new Error('stripe fora do ar');
    };
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).toHaveBeenCalledWith('ana@example.com', null);
  });

  it('ainda tem gratis: nao envia', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 2 } });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('WAITs nao esgotam: 1 sinal e 6 analises no total, nao envia', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 1, total: 6 } });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('10 analises no total esgotam mesmo com menos de 3 sinais: envia', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 0, total: 10 } });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).toHaveBeenCalledTimes(1);
  });

  it('analise em andamento nao conta como esgotamento: 2 sinais + 1 rodando, nao envia', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 2, inFlight: 1 } });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('ja recebeu antes: nao envia de novo', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 3 }, alreadySent: true });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('ja assina: nao envia', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 3 }, paid: true });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('sem e-mail conhecido: nao registra nem envia', async () => {
    const { deps, sendRecovery, auditCreate } = makeDeps({ quota: { signals: 3 }, email: null });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(auditCreate).not.toHaveBeenCalled();
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('falha no banco: nao propaga erro', async () => {
    const { deps } = makeDeps({ quota: { signals: 3 } });
    (deps.prisma.analysis.count as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(notifyIfFreeQuotaExhausted(deps, 'u1')).resolves.toBeUndefined();
  });
});

describe('envio recusado pelo provedor (cota da Resend, 06/10/2026)', () => {
  it('tira a marca e nao diz "enviado" no log', async () => {
    const { deps, auditDelete } = makeDeps({ quota: { signals: 3 }, sendOk: false });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(auditDelete).toHaveBeenCalledWith({ where: { id: 'audit_1' } });
    const logs = (deps.log as jest.Mock).mock.calls.map((c) => c[1]).join(' ');
    expect(logs).not.toContain('enviado (');
    expect(logs).toContain('Envio recusado');
  });

  it('envio aceito mantem a marca', async () => {
    const { deps, auditDelete } = makeDeps({ quota: { signals: 3 } });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(auditDelete).not.toHaveBeenCalled();
  });

  it('retentativa: so quem esgotou nas ultimas 72h e ainda nao tem a marca', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 3 } });
    (deps.prisma as any).user.findMany = jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    (deps.prisma as any).adminAudit.findMany = jest.fn().mockResolvedValue([{ targetUserId: 'u2' }]);
    const now = new Date('2026-10-06T20:00:00Z');
    const tried = await retryRecoveryEmails(deps, now);
    expect(tried).toBe(1);
    expect(sendRecovery).toHaveBeenCalledTimes(1);
    const where = ((deps.prisma as any).user.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.analyses.some.createdAt.gte.toISOString()).toBe('2026-10-03T20:00:00.000Z');
    expect(where.NOT).toEqual({ role: 'admin' });
  });

  it('retentativa ignora quem ainda tem analise gratis', async () => {
    const { deps, sendRecovery } = makeDeps({ quota: { signals: 1 } });
    (deps.prisma as any).user.findMany = jest.fn().mockResolvedValue([{ id: 'u1' }]);
    expect(await retryRecoveryEmails(deps)).toBe(0);
    expect(sendRecovery).not.toHaveBeenCalled();
  });
});

