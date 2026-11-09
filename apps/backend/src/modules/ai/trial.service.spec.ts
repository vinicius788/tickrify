import { TrialService } from './trial.service';
import { TRIAL_RULES } from '../../common/trial';
import * as flags from '../../common/flags/feature-flags';

jest.mock('../../common/utils/clerk-email', () => ({ fetchClerkProfile: jest.fn().mockResolvedValue({ emailVerified: true }) }));

const DEVICE = '11111111-2222-4333-8444-555555555555';

function setup(counts: { device?: number; ip?: number } = {}) {
  const inserted: unknown[][] = [];
  const updates: unknown[][] = [];
  let row: Record<string, unknown> | null = null;
  const prisma = {
    analysis: { count: jest.fn().mockResolvedValue(0) },
    user: { findUnique: jest.fn().mockResolvedValue({ email: 'a@gmail.com', clerkUserId: 'clerk_1' }) },
    subscription: { count: jest.fn().mockResolvedValue(0) },
    $executeRawUnsafe: jest.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('INSERT INTO')) {
        inserted.push(args);
        row = { userId: args[0], status: args[4], startedAt: new Date(), usageDays: [] };
      } else if (sql.includes('UPDATE')) updates.push(args);
      return 1;
    }),
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      if (sql.includes('"deviceHash" = $1')) return [{ n: counts.device ?? 0 }];
      if (sql.includes('"ipHash" = $1')) return [{ n: counts.ip ?? 0 }];
      if (sql.includes('"UserTrial"') && row) return [row];
      return [];
    }),
  };
  const service = new TrialService(prisma as never, {} as never);
  (service as unknown as { ready: boolean }).ready = true;
  return { service, inserted, updates, prisma, setRow: (r: Record<string, unknown>) => (row = r) };
}

describe('TrialService.ensure: uma conta nova no mesmo aparelho nao renova a cota', () => {
  beforeEach(() => jest.spyOn(flags, 'flagBool').mockReturnValue(true));
  afterEach(() => jest.restoreAllMocks());

  it('aparelho que ja usou trial em outra conta e recusado', async () => {
    const { service, inserted } = setup({ device: TRIAL_RULES.maxTrialsPerDevice });
    await expect(service.ensure('u2', { ip: '1.1.1.1', deviceId: DEVICE })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRIAL_DEVICE_LIMIT' }),
    });
    expect(inserted).toHaveLength(0);
  });

  it('aparelho novo ganha o trial e grava o hash, nunca o id cru', async () => {
    const { service, inserted } = setup();
    await service.ensure('u1', { ip: '1.1.1.1', deviceId: DEVICE, userAgent: 'UA' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0][3]).toMatch(/^[a-f0-9]{32}$/);
    expect(inserted[0]).not.toContain(DEVICE);
  });

  it('mesma rede com navegadores diferentes gera chaves diferentes (NAT)', async () => {
    const a = setup();
    await a.service.ensure('u1', { ip: '1.1.1.1', deviceId: DEVICE, userAgent: 'Chrome' });
    const b = setup();
    await b.service.ensure('u2', { ip: '1.1.1.1', deviceId: DEVICE, userAgent: 'Safari' });
    expect(a.inserted[0][2]).not.toBe(b.inserted[0][2]);
  });

  it('IP + navegador acima do teto segue recusado', async () => {
    const { service } = setup({ ip: TRIAL_RULES.maxNewTrialsPerIpPerDay });
    await expect(service.ensure('u1', { ip: '1.1.1.1', userAgent: 'UA' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TRIAL_NETWORK_LIMIT' }),
    });
  });

  it('id de aparelho invalido e ignorado, sem punir ninguem', async () => {
    const { service, inserted } = setup({ device: 5 });
    await service.ensure('u1', { ip: '1.1.1.1', deviceId: 'x' });
    expect(inserted[0][3]).toBeNull();
  });
});
