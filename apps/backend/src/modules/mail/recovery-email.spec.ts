jest.mock('../../common/utils/clerk-email', () => ({
  fetchClerkEmail: jest.fn().mockResolvedValue(null),
}));

import { notifyIfFreeQuotaExhausted, type RecoveryEmailDeps } from './recovery-email';

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

function makeDeps(opts: { quota: { signals: number; total?: number; inFlight?: number }; alreadySent?: boolean; paid?: boolean; email?: string | null; offerActive?: boolean }) {
  const sendRecovery = jest.fn().mockResolvedValue(undefined);
  const auditCreate = jest.fn().mockResolvedValue({});
  const deps = {
    prisma: {
      analysis: { count: quotaCount(opts.quota) },
      adminAudit: {
        findFirst: jest.fn().mockResolvedValue(opts.alreadySent ? { id: 'a1' } : null),
        create: auditCreate,
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
  return { deps, sendRecovery, auditCreate };
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
