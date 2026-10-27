import {
  FOUNDER_AUDIT_ACTION,
  FOUNDER_MAX_PER_SEND,
  renderFounderEmail,
  sendFounderCampaign,
  type FounderDeps,
} from './founder-campaign';
import { UNSUBSCRIBE_AUDIT_ACTION } from './lifecycle-email';

const NOW = new Date('2026-10-28T12:00:00Z');
type U = {
  id: string;
  email: string;
  name?: string | null;
  role?: string;
  subscriptions?: Array<{ status: string; stripeId: string }>;
};

function makeDeps(opts: { users: U[]; audits?: Array<{ action: string; targetUserId: string }>; sendOk?: (to: string) => boolean }) {
  const order: string[] = [];
  const created: any[] = [];
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  let n = 0;
  const deps: FounderDeps = {
    prisma: {
      user: {
        findMany: jest.fn().mockResolvedValue(
          opts.users.map((u) => ({ name: null, role: 'user', subscriptions: [], ...u })),
        ),
      },
      adminAudit: {
        findMany: jest.fn().mockResolvedValue(opts.audits ?? []),
        create: jest.fn(async ({ data }: any) => {
          order.push('audit');
          created.push(data);
          return { id: `aud_${created.length}` };
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
    } as any,
    mail: {
      sendLifecycle: jest.fn(async (to: string, email: any) => {
        order.push('mail');
        sent.push({ to, subject: email.subject, html: email.html });
        return opts.sendOk ? opts.sendOk(to) : true;
      }),
    },
    stripe: {
      issue: jest.fn(async () => {
        order.push('issue');
        n += 1;
        return { id: `promo_${n}`, code: `FND-AAAA000${n}` };
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
    },
    appUrl: 'https://tickrify.com',
    apiBaseUrl: 'https://api.tickrify.com',
    now: () => NOW,
    sleep: async () => undefined,
    log: jest.fn(),
  };
  return { deps, order, created, sent };
}

describe('campanha Founding Member', () => {
  const saved = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  beforeEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = saved;
  });

  it('e-mail: preco, 30 vagas, validade, link pessoal e descadastro; sem travessao nem emoji', () => {
    const mail = renderFounderEmail({
      appUrl: 'https://tickrify.com/',
      firstName: 'Alex',
      unsubscribeUrl: 'https://api.tickrify.com/u',
      code: 'FND-AB12CD34',
      expiresAt: new Date('2026-11-04T12:00:00Z'),
    });
    expect(mail.subject).toBe('Your Tickrify founding price: $15/month, locked');
    expect(mail.html).toContain('https://tickrify.com/pricing?offer=FND-AB12CD34');
    expect(mail.html).toContain('November 4');
    expect(mail.html).toContain('30 people');
    expect(mail.html).toContain('https://api.tickrify.com/u');
    expect(mail.html).toContain('Hi Alex,');
    expect(`${mail.subject} ${mail.html}`).not.toMatch(/—|–/);
    expect(mail.html).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
    expect(mail.kind).toBe('campaign_founder');
  });

  it('simulacao (sem confirm): conta quem receberia e nao toca na Stripe, no provedor nem no banco', async () => {
    const { deps } = makeDeps({
      users: [
        { id: 'u1', email: 'a@x.com' },
        { id: 'u2', email: 'b@x.com', role: 'admin' },
        { id: 'u3', email: 'c@x.com', subscriptions: [{ status: 'active', stripeId: 'sub_1' }] },
        { id: 'u4', email: 'd@x.com', subscriptions: [{ status: 'active', stripeId: 'manual_owner_1' }] },
        { id: 'u5', email: 'e@x.com' },
        { id: 'u6', email: 'f@x.com' },
      ],
      audits: [
        { action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: 'u5' },
        { action: FOUNDER_AUDIT_ACTION, targetUserId: 'u6' },
      ],
    });
    const out = await sendFounderCampaign(deps, ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com', 'ghost@x.com'], true);
    expect(out).toMatchObject({
      dryRun: true,
      requested: 7,
      eligible: 1,
      sent: 0,
      skipped: { notFound: 1, admin: 1, subscriber: 2, unsubscribed: 1, alreadySent: 1 },
    });
    expect(deps.stripe.issue).not.toHaveBeenCalled();
    expect(deps.mail.sendLifecycle).not.toHaveBeenCalled();
    expect(deps.prisma.adminAudit.create).not.toHaveBeenCalled();
  });

  it('envio real: cria o codigo, grava a marca ANTES de enviar e manda o link pessoal', async () => {
    const { deps, order, created, sent } = makeDeps({ users: [{ id: 'u1', email: 'A@x.com', name: 'Alex Lima' }] });
    const out = await sendFounderCampaign(deps, [' A@X.com '], false);
    expect(out).toMatchObject({ dryRun: false, eligible: 1, sent: 1, failed: 0 });
    expect(order).toEqual(['issue', 'audit', 'mail']);
    expect(created[0]).toMatchObject({
      action: FOUNDER_AUDIT_ACTION,
      targetUserId: 'u1',
      details: { promotionCodeId: 'promo_1', code: 'FND-AAAA0001' },
    });
    expect(sent[0].html).toContain('?offer=FND-AAAA0001');
    expect(sent[0].html).toContain('Hi Alex,');
    const expiresAt = (deps.stripe.issue as jest.Mock).mock.calls[0][1];
    expect(expiresAt).toBe(Math.floor((NOW.getTime() + 7 * 86_400_000) / 1000));
  });

  it('e-mail recusado pelo provedor: tira a marca e desativa o codigo (nada solto na Stripe)', async () => {
    const { deps } = makeDeps({ users: [{ id: 'u1', email: 'a@x.com' }], sendOk: () => false });
    const out = await sendFounderCampaign(deps, ['a@x.com'], false);
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(deps.prisma.adminAudit.delete).toHaveBeenCalledWith({ where: { id: 'aud_1' } });
    expect(deps.stripe.revoke).toHaveBeenCalledWith('promo_1');
  });

  it('para depois de 5 falhas seguidas do provedor', async () => {
    const users = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, email: `p${i}@x.com` }));
    const { deps } = makeDeps({ users, sendOk: () => false });
    const out = await sendFounderCampaign(deps, users.map((u) => u.email), false);
    expect(out.failed).toBe(5);
    expect(deps.mail.sendLifecycle).toHaveBeenCalledTimes(5);
  });

  it('Stripe fora do ar: nenhum e-mail sai sem codigo', async () => {
    const { deps } = makeDeps({ users: [{ id: 'u1', email: 'a@x.com' }] });
    (deps.stripe.issue as jest.Mock).mockRejectedValue(new Error('stripe down'));
    const out = await sendFounderCampaign(deps, ['a@x.com'], false);
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(deps.mail.sendLifecycle).not.toHaveBeenCalled();
    expect(deps.prisma.adminAudit.create).not.toHaveBeenCalled();
  });

  it('sem segredo de descadastro nada sai', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const savedClerk = process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_SECRET_KEY;
    try {
      const { deps } = makeDeps({ users: [{ id: 'u1', email: 'a@x.com' }] });
      const out = await sendFounderCampaign(deps, ['a@x.com'], false);
      expect(out).toMatchObject({ sent: 0, eligible: 0 });
      expect(deps.stripe.issue).not.toHaveBeenCalled();
    } finally {
      if (savedClerk !== undefined) process.env.CLERK_SECRET_KEY = savedClerk;
    }
  });

  it(`limita a ${FOUNDER_MAX_PER_SEND} por disparo e ignora repetidos`, async () => {
    const emails = Array.from({ length: 60 }, (_, i) => `p${i}@x.com`);
    const { deps } = makeDeps({ users: [] });
    const out = await sendFounderCampaign(deps, [...emails, ...emails], true);
    expect(out.requested).toBe(FOUNDER_MAX_PER_SEND);
  });
});
