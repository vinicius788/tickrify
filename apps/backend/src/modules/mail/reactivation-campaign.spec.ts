import {
  CAMPAIGN_AUDIT_ACTION,
  campaignReport,
  campaignCandidates,
  countCampaign,
  renderCampaignEmail,
  sendCampaign,
  type CampaignDeps,
} from './reactivation-campaign';
import { getFreeQuota } from '../../common/free-quota';

jest.mock('../../common/free-quota', () => ({
  ...jest.requireActual('../../common/free-quota'),
  getFreeQuota: jest.fn(),
}));
const quota = getFreeQuota as jest.Mock;

const NOW = new Date('2026-10-06T12:00:00Z');
type Q = { remaining: number; settledExhausted: boolean };

function makeDeps(opts: {
  users: Array<{ id: string; email: string | null; name?: string | null; quota: Q; completed: number; last?: string }>;
  skipped?: string[];
  recentLifecycle?: string[];
  sendOk?: (to: string) => boolean;
}) {
  const byId = new Map(opts.users.map((u) => [u.id, u]));
  quota.mockImplementation(async (_p: unknown, userId: string) => byId.get(userId)?.quota);
  const audits: Array<{ action: string; targetUserId: string }> = [];
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const order: string[] = [];
  const deps: CampaignDeps = {
    prisma: {
      user: { findMany: jest.fn().mockResolvedValue(opts.users.map((u) => ({ id: u.id, email: u.email, name: u.name ?? null }))) },
      analysis: {
        count: jest.fn(async ({ where }: { where: { userId: string } }) => byId.get(where.userId)?.completed ?? 0),
        findFirst: jest.fn(async ({ where }: { where: { userId: string } }) => {
          const last = byId.get(where.userId)?.last;
          return last ? { createdAt: new Date(last) } : null;
        }),
      },
      adminAudit: {
        findMany: jest.fn(async ({ where }: { where: { action: unknown } }) =>
          typeof where.action === 'object' && where.action && 'startsWith' in (where.action as object)
            ? (opts.recentLifecycle ?? []).map((id) => ({ targetUserId: id }))
            : (opts.skipped ?? []).map((id) => ({ targetUserId: id })),
        ),
        count: jest.fn().mockResolvedValue(audits.length),
        create: jest.fn(async ({ data }: { data: { action: string; targetUserId: string } }) => {
          audits.push(data);
          order.push(`audit:${data.targetUserId}`);
          return { id: `a_${data.targetUserId}` };
        }),
        delete: jest.fn(async ({ where }: { where: { id: string } }) => {
          const i = audits.findIndex((a) => `a_${a.targetUserId}` === where.id);
          if (i >= 0) audits.splice(i, 1);
          order.push(`unmark:${where.id}`);
        }),
      },
      subscription: {},
    } as unknown as CampaignDeps['prisma'],
    mail: {
      sendLifecycle: jest.fn(async (to: string, email: { subject: string; html: string }) => {
        order.push(`send:${to}`);
        sent.push({ to, subject: email.subject, html: email.html });
        return opts.sendOk ? opts.sendOk(to) : true;
      }),
    },
    appUrl: 'https://tickrify.com',
    apiBaseUrl: 'https://api.test',
    now: () => NOW,
    sleep: async () => undefined,
    log: jest.fn(),
  };
  return { deps, audits, sent, order };
}

const users = [
  { id: 'u_ex', email: 'ex@x.com', name: 'Ana Maria', quota: { remaining: 0, settledExhausted: true }, completed: 3 },
  { id: 'u_1', email: 'one@x.com', quota: { remaining: 1, settledExhausted: false }, completed: 2 },
  { id: 'u_2', email: 'two@x.com', quota: { remaining: 2, settledExhausted: false }, completed: 1 },
  { id: 'u_3', email: 'three@x.com', quota: { remaining: 3, settledExhausted: false }, completed: 2, last: '2026-09-10T10:00:00Z' },
  { id: 'u_3r', email: 'threer@x.com', quota: { remaining: 3, settledExhausted: false }, completed: 1, last: '2026-09-28T10:00:00Z' },
  { id: 'u_0', email: 'never@x.com', quota: { remaining: 3, settledExhausted: false }, completed: 0 },
  { id: 'u_null', email: null, quota: { remaining: 0, settledExhausted: true }, completed: 3 },
];

describe('campanha de reativacao', () => {
  beforeAll(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
  });

  it('separa por quanto resta da cota gratis', async () => {
    const { deps } = makeDeps({ users });
    const out = await campaignCandidates(deps);
    expect(Object.fromEntries(out.map((c) => [c.userId, c.segment]))).toEqual({
      u_ex: 'exhausted', u_1: 'one_left', u_2: 'two_left', u_3: 'three_left', u_3r: 'three_left_recent', u_0: 'never',
    });
  });

  it('consulta exclui admin, assinante, acesso manual e conta com menos de 3 dias', async () => {
    const { deps } = makeDeps({ users });
    await campaignCandidates(deps);
    const where = (deps.prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.NOT).toEqual({ role: 'admin' });
    expect(where.createdAt.lte.toISOString()).toBe('2026-10-03T12:00:00.000Z');
    expect(where.subscriptions.none.OR).toEqual([
      { status: { in: ['active', 'trialing'] } },
      { stripeId: { startsWith: 'manual_' } },
    ]);
  });

  it('pula quem se descadastrou, quem ja recebeu e quem recebeu e-mail automatico nos ultimos 3 dias', async () => {
    const { deps } = makeDeps({ users, skipped: ['u_ex'], recentLifecycle: ['u_1'] });
    const ids = (await campaignCandidates(deps)).map((c) => c.userId);
    expect(ids).not.toContain('u_ex');
    expect(ids).not.toContain('u_1');
    expect(ids).toContain('u_2');
  });

  it('contagem por grupo nao grava nem envia nada', async () => {
    const { deps, audits, sent } = makeDeps({ users });
    const out = await countCampaign(deps);
    expect(out.bySegment).toEqual({ exhausted: 1, one_left: 1, two_left: 1, three_left: 1, three_left_recent: 1, never: 1 });
    expect(audits).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('dispara so os grupos pedidos, grava a auditoria ANTES de cada envio', async () => {
    const { deps, audits, sent, order } = makeDeps({ users });
    const out = await sendCampaign(deps, ['exhausted', 'one_left']);
    expect(sent.map((s) => s.to)).toEqual(['ex@x.com', 'one@x.com']);
    expect(audits.every((a) => a.action === CAMPAIGN_AUDIT_ACTION)).toBe(true);
    expect(order).toEqual(['audit:u_ex', 'send:ex@x.com', 'audit:u_1', 'send:one@x.com']);
    expect(out.sent).toMatchObject({ exhausted: 1, one_left: 1, two_left: 0 });
    expect(sent[0].html).toContain('Hi Ana,');
  });

  it('para depois de 5 falhas seguidas do provedor', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `f${i}`, email: `f${i}@x.com`, quota: { remaining: 0, settledExhausted: true }, completed: 3,
    }));
    const { deps, sent } = makeDeps({ users: many, sendOk: () => false });
    const out = await sendCampaign(deps, ['exhausted']);
    expect(sent).toHaveLength(5);
    expect(out.failed).toBe(5);
  });

  it('envio recusado tira a marca, para o proximo disparo tentar de novo', async () => {
    const { deps, audits, order } = makeDeps({ users, sendOk: (to) => to !== 'one@x.com' });
    await sendCampaign(deps, ['exhausted', 'one_left']);
    expect(audits.map((a) => a.targetUserId)).toEqual(['u_ex']);
    expect(order).toContain('unmark:a_u_1');
  });

  it('sem segredo de descadastro nada sai', async () => {
    const saved = process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const savedClerk = process.env.CLERK_SECRET_KEY;
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    delete process.env.CLERK_SECRET_KEY;
    const { deps, sent, audits } = makeDeps({ users });
    await sendCampaign(deps, ['exhausted']);
    expect(sent).toHaveLength(0);
    expect(audits).toHaveLength(0);
    process.env.EMAIL_UNSUBSCRIBE_SECRET = saved;
    if (savedClerk) process.env.CLERK_SECRET_KEY = savedClerk;
  });

  describe('textos', () => {
    const render = (s: Parameters<typeof renderCampaignEmail>[0]) =>
      renderCampaignEmail(s, { appUrl: 'https://tickrify.com', firstName: null, unsubscribeUrl: 'https://api.test/u' });

    it('assunto e destino certos por grupo', () => {
      expect(render('exhausted').subject).toBe('Keep using Tickrify for $7.99 a week');
      expect(render('exhausted').html).toContain('https://tickrify.com/dashboard/plans?cycle=weekly');
      expect(render('one_left').subject).toBe('You still have 1 free trade plan on Tickrify');
      expect(render('two_left').subject).toBe('You still have 2 free trade plans on Tickrify');
      expect(render('three_left').subject).toBe('Sorry about all those WAITs');
      expect(render('two_left').html).toContain('https://tickrify.com/dashboard/new');
      expect(render('three_left').html).toContain('We changed the AI on September 24');
      expect(render('three_left').html).not.toMatch(/\berror\b|\bbug\b/i);
      expect(render('two_left').html).not.toContain('Sorry');
      expect(render('three_left_recent').subject).toBe('You still have 3 free trade plans on Tickrify');
      expect(render('three_left_recent').html).not.toContain('Sorry');
    });

    it('todo e-mail tem descadastro e nenhum tem travessao ou emoji', () => {
      for (const s of ['exhausted', 'one_left', 'two_left', 'three_left', 'three_left_recent', 'never'] as const) {
        const { html, subject } = render(s);
        expect(html).toContain('https://api.test/u');
        expect(`${subject}${html}`).not.toMatch(/—|–/);
        expect(`${subject}${html}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    });
  });
});

describe('relatorio da campanha', () => {
  it('le so a acao da campanha e resume quem voltou, abriu checkout e assina', async () => {
    const rows = [
      { userId: 'u1', clerkUserId: 'c1', email: 'a@x.com', segment: 'three_left', sentAt: new Date(), analysesAfter: 2, lastAnalysisAt: new Date(), checkoutAfter: true, paying: false },
      { userId: 'u2', clerkUserId: 'c2', email: 'b@x.com', segment: 'exhausted', sentAt: new Date(), analysesAfter: 0, lastAnalysisAt: null, checkoutAfter: false, paying: true },
      { userId: 'u3', clerkUserId: null, email: 'c@x.com', segment: 'never', sentAt: new Date(), analysesAfter: 0, lastAnalysisAt: null, checkoutAfter: false, paying: false },
    ];
    const queryRaw = jest.fn().mockResolvedValue(rows);
    const out = await campaignReport({ $queryRaw: queryRaw } as any);
    expect(out.summary).toEqual({ sent: 3, analyzedAfter: 1, checkoutAfter: 1, paying: 1 });
    const sql = queryRaw.mock.calls[0][0];
    expect(sql.values).toContain(CAMPAIGN_AUDIT_ACTION);
    expect(sql.sql).toContain(`"stripeId" NOT LIKE 'manual_%'`);
  });
});

