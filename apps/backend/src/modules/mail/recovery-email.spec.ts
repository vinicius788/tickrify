jest.mock('../../common/utils/clerk-email', () => ({
  fetchClerkEmail: jest.fn().mockResolvedValue(null),
}));

import { notifyIfFreeQuotaExhausted, type RecoveryEmailDeps } from './recovery-email';

function makeDeps(opts: { used: number; alreadySent?: boolean; paid?: boolean; email?: string | null }) {
  const sendRecovery = jest.fn().mockResolvedValue(undefined);
  const auditCreate = jest.fn().mockResolvedValue({});
  const deps = {
    prisma: {
      analysis: { count: jest.fn().mockResolvedValue(opts.used) },
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
    log: jest.fn(),
  } as unknown as RecoveryEmailDeps;
  return { deps, sendRecovery, auditCreate };
}

describe('notifyIfFreeQuotaExhausted', () => {
  it('terceira gratis concluida: registra e envia uma vez', async () => {
    const { deps, sendRecovery, auditCreate } = makeDeps({ used: 3 });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('recovery_email_sent');
    expect(sendRecovery).toHaveBeenCalledWith('ana@example.com');
  });

  it('ainda tem gratis: nao envia', async () => {
    const { deps, sendRecovery } = makeDeps({ used: 2 });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('ja recebeu antes: nao envia de novo', async () => {
    const { deps, sendRecovery } = makeDeps({ used: 3, alreadySent: true });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('ja assina: nao envia', async () => {
    const { deps, sendRecovery } = makeDeps({ used: 3, paid: true });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('sem e-mail conhecido: nao registra nem envia', async () => {
    const { deps, sendRecovery, auditCreate } = makeDeps({ used: 3, email: null });
    await notifyIfFreeQuotaExhausted(deps, 'u1');
    expect(auditCreate).not.toHaveBeenCalled();
    expect(sendRecovery).not.toHaveBeenCalled();
  });

  it('falha no banco: nao propaga erro', async () => {
    const { deps } = makeDeps({ used: 3 });
    (deps.prisma.analysis.count as jest.Mock).mockRejectedValue(new Error('db down'));
    await expect(notifyIfFreeQuotaExhausted(deps, 'u1')).resolves.toBeUndefined();
  });
});
