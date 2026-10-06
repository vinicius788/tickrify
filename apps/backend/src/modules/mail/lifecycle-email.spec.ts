import {
  LifecycleDeps,
  LifecycleKind,
  lifecycleAuditAction,
  publicUrl,
  renderLifecycleEmail,
  runLifecycleSweep,
  UNSUBSCRIBE_AUDIT_ACTION,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from './lifecycle-email';

const NOW = new Date('2026-10-01T12:00:00Z');

function makeDeps(opts: {
  enabled?: boolean;
  users?: Array<{ id: string; email: string | null; name: string | null }>;
  audits?: Array<{ action: string; targetUserId: string; createdAt?: Date }>;
  paying?: string[];
  checkoutSessions?: Array<{ targetUserId: string; createdAt: Date }>;
  sendOk?: boolean;
}) {
  const audits = [...(opts.audits ?? [])];
  const created: Array<{ action: string; targetUserId: string }> = [];
  const sent: Array<{ to: string; kind: string; subject: string; unsubscribeUrl: string }> = [];
  const order: string[] = [];
  const logs: string[] = [];
  const prisma = {
    user: {
      findMany: jest.fn(async () => opts.users ?? []),
      findUnique: jest.fn(async ({ where }: any) => (opts.users ?? []).find((u) => u.id === where.id) ?? null),
    },
    subscription: {
      findFirst: jest.fn(async ({ where }: any) => ((opts.paying ?? []).includes(where.userId) ? { id: 's' } : null)),
    },
    adminAudit: {
      // Filtra pela janela como o banco faria (recuperacao 1h-24h, reativacao 3-30 dias).
      findMany: jest.fn(async ({ where }: any) =>
        (opts.checkoutSessions ?? []).filter(
          (row) =>
            (!where?.createdAt?.gte || row.createdAt >= where.createdAt.gte) &&
            (!where?.createdAt?.lte || row.createdAt <= where.createdAt.lte),
        ),
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const hit = audits.find(
          (a) =>
            a.action === where.action &&
            a.targetUserId === where.targetUserId &&
            (!where.createdAt?.gt || (a.createdAt && a.createdAt > where.createdAt.gt)) &&
            (!where.createdAt?.gte || (a.createdAt && a.createdAt >= where.createdAt.gte)),
        );
        return hit ? { id: 'x' } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        order.push('audit');
        created.push(data);
        audits.push(data);
        return { id: `audit_${data.targetUserId}_${data.action}` };
      }),
      delete: jest.fn(async ({ where }: any) => {
        order.push(`unmark:${where.id}`);
        const i = audits.findIndex((a) => `audit_${a.targetUserId}_${a.action}` === where.id);
        if (i >= 0) audits.splice(i, 1);
      }),
    },
  };
  const deps: LifecycleDeps = {
    prisma: prisma as any,
    mail: {
      sendLifecycle: jest.fn(async (to, email) => {
        order.push('send');
        sent.push({ to, kind: email.kind, subject: email.subject, unsubscribeUrl: email.unsubscribeUrl });
        return opts.sendOk ?? true;
      }),
    },
    isEnabled: () => opts.enabled ?? false,
    appUrl: 'https://tickrify.com',
    apiBaseUrl: 'https://tickrify.onrender.com',
    now: () => NOW,
    log: (_l, m) => logs.push(m),
  };
  return { deps, prisma, created, sent, order, logs };
}

describe('lifecycle emails', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-only-secret';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('switched off (default): only logs a dry run, writes and sends nothing', async () => {
    const { deps, created, sent, logs } = makeDeps({
      users: [{ id: 'u1', email: 'ana@example.com', name: 'Ana Silva' }],
    });
    const counts = await runLifecycleSweep(deps);
    expect(counts.activation_1).toBe(1);
    expect(created).toEqual([]);
    expect(sent).toEqual([]);
    expect(logs.some((l) => l.includes('dry-run kind=activation_1 user=u1'))).toBe(true);
    expect(logs.join('\n')).not.toContain('ana@example.com');
  });

  it('switched on: records before sending, once, with a working unsubscribe link', async () => {
    const { deps, sent, order, created } = makeDeps({
      enabled: true,
      users: [{ id: 'u1', email: 'ana@example.com', name: 'Ana Silva' }],
    });
    await runLifecycleSweep(deps);
    const first = sent.filter((s) => s.kind === 'activation_1');
    expect(first).toHaveLength(1);
    expect(order.slice(0, 2)).toEqual(['audit', 'send']);
    expect(created[0]).toMatchObject({ action: lifecycleAuditAction('activation_1'), targetUserId: 'u1' });
    const url = new URL(first[0].unsubscribeUrl);
    expect(url.origin).toBe('https://tickrify.onrender.com');
    expect(verifyUnsubscribeToken(url.searchParams.get('u')!, url.searchParams.get('t')!)).toBe(true);

    // Segunda volta: ja registrado, nao manda de novo.
    sent.length = 0;
    await runLifecycleSweep(deps);
    expect(sent.filter((s) => s.kind === 'activation_1')).toHaveLength(0);
  });

  it('provider refused (Resend daily quota): the mark comes off and the next sweep retries', async () => {
    const { deps, order, sent } = makeDeps({
      enabled: true,
      sendOk: false,
      users: [{ id: 'u1', email: 'ana@example.com', name: 'Ana' }],
    });
    await runLifecycleSweep(deps);
    expect(order).toContain(`unmark:audit_u1_${lifecycleAuditAction('activation_1')}`);
    await runLifecycleSweep(deps);
    expect(sent.filter((s) => s.kind === 'activation_1')).toHaveLength(2);
  });

  it('never emails subscribers or people who unsubscribed', async () => {
    const { deps, sent } = makeDeps({
      enabled: true,
      users: [
        { id: 'paid', email: 'p@example.com', name: null },
        { id: 'out', email: 'o@example.com', name: null },
      ],
      paying: ['paid'],
      audits: [{ action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: 'out' }],
    });
    await runLifecycleSweep(deps);
    expect(sent).toEqual([]);
  });

  it('without an unsubscribe secret nothing goes out', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    delete process.env.CLERK_SECRET_KEY;
    const { deps, sent, created } = makeDeps({
      enabled: true,
      users: [{ id: 'u1', email: 'ana@example.com', name: null }],
    });
    await runLifecycleSweep(deps);
    expect(sent).toEqual([]);
    expect(created).toEqual([]);
  });

  it('abandoned checkout: bank decline gets the card tip subject, otherwise the weekly plan', async () => {
    const sessionAt = new Date(NOW.getTime() - 3 * 3600_000);
    const { deps, sent } = makeDeps({
      enabled: true,
      users: [
        { id: 'declined', email: 'd@example.com', name: 'Leo' },
        { id: 'left', email: 'l@example.com', name: null },
      ],
      checkoutSessions: [
        { targetUserId: 'declined', createdAt: sessionAt },
        { targetUserId: 'left', createdAt: sessionAt },
      ],
      audits: [{ action: 'funnel:payment_failed', targetUserId: 'declined', createdAt: new Date(sessionAt.getTime() + 60_000) }],
    });
    // Sem usuarios nas janelas de ativacao nesta volta.
    (deps.prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    await runLifecycleSweep(deps);
    const bySubject = Object.fromEntries(sent.map((s) => [s.to, s.subject]));
    expect(bySubject['d@example.com']).toBe('Your payment did not go through');
    expect(bySubject['l@example.com']).toBe('You left your Tickrify checkout');
  });

  it('abandoned checkout waits while a newer checkout is still fresh', async () => {
    const { deps, sent } = makeDeps({
      enabled: true,
      users: [{ id: 'u1', email: 'a@example.com', name: null }],
      checkoutSessions: [{ targetUserId: 'u1', createdAt: new Date(NOW.getTime() - 5 * 3600_000) }],
      audits: [{ action: 'funnel:checkout_session_created', targetUserId: 'u1', createdAt: new Date(NOW.getTime() - 10 * 60_000) }],
    });
    (deps.prisma.user.findMany as jest.Mock).mockResolvedValue([]);
    await runLifecycleSweep(deps);
    expect(sent).toEqual([]);
  });

  it('second analysis: one read and gone, the text follows the first result; two reads get nothing', async () => {
    const users = [
      { id: 'w1', email: 'w@x.com', name: 'Ana', analyses: [{ recommendation: 'WAIT' }] },
      { id: 'b1', email: 'b@x.com', name: null, analyses: [{ recommendation: 'BUY' }] },
      { id: 'two', email: 't@x.com', name: null, analyses: [{ recommendation: 'SELL' }, { recommendation: 'WAIT' }] },
    ];
    const { deps, sent, prisma } = makeDeps({ enabled: true, users: users as any });
    // So a busca do segunda analise devolve estes usuarios (a de ativacao filtra outra coisa).
    (prisma.user.findMany as jest.Mock).mockImplementation(async (args: any) => (args?.select?.analyses ? users : []));

    const counts = await runLifecycleSweep(deps);
    expect(counts.second_analysis).toBe(2);
    const bySubject = Object.fromEntries(sent.filter((m) => m.kind === 'second_analysis').map((m) => [m.to, m.subject]));
    expect(bySubject['w@x.com']).toBe('Your first Tickrify read said WAIT');
    expect(bySubject['b@x.com']).toBe('You still have 2 free trade plans on Tickrify');
    expect(bySubject['t@x.com']).toBeUndefined();
  });

  it('second analysis texts: link to a new analysis, no em dash, true free rule', () => {
    for (const firstWasWait of [true, false]) {
      const email = renderLifecycleEmail('second_analysis', {
        appUrl: 'https://tickrify.com',
        unsubscribeUrl: 'https://tickrify.onrender.com/api/email/unsubscribe?u=1&t=x',
        firstWasWait,
      });
      expect(email.html).toContain('https://tickrify.com/dashboard/new');
      expect(email.html).not.toContain('—');
      expect(email.html).toContain('Unsubscribe');
    }
  });

  it('activation email no longer promises the removed one-click example', () => {
    const email = renderLifecycleEmail('activation_1', {
      appUrl: 'https://tickrify.com',
      unsubscribeUrl: 'https://tickrify.onrender.com/api/email/unsubscribe?u=1&t=x',
    });
    expect(email.html).not.toContain('one-click example');
    expect(email.html).toContain('three real example analyses');
  });

  it('winback: checkout aberto ha 3 a 30 dias recebe o segundo toque, uma vez; o de ontem nao', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const { deps, sent, created } = makeDeps({
      enabled: true,
      users: [
        { id: 'old', email: 'old@x.com', name: null },
        { id: 'fresh', email: 'fresh@x.com', name: null },
      ],
      checkoutSessions: [
        { targetUserId: 'old', createdAt: new Date(NOW.getTime() - 10 * DAY) },
        { targetUserId: 'fresh', createdAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) },
      ],
    });

    const counts = await runLifecycleSweep(deps);
    expect(counts.checkout_winback).toBe(1);
    const winback = sent.filter((m) => m.kind === 'checkout_winback');
    expect(winback).toEqual([expect.objectContaining({ to: 'old@x.com', subject: 'Tickrify starts at $7.99 a week' })]);
    expect(created.some((c) => c.action === lifecycleAuditAction('checkout_winback' as LifecycleKind))).toBe(true);

    // Segunda volta: ja recebeu, nao repete.
    await runLifecycleSweep(deps);
    expect(sent.filter((m) => m.kind === 'checkout_winback')).toHaveLength(1);
  });

  it('winback: texto honesto, sem erro inventado, link do semanal e descadastro', () => {
    const email = renderLifecycleEmail('checkout_winback', {
      appUrl: 'https://tickrify.com',
      unsubscribeUrl: 'https://tickrify.onrender.com/api/email/unsubscribe?u=1&t=x',
    });
    expect(email.html).toContain('https://tickrify.com/pricing?cycle=weekly');
    expect(email.html).toContain('it was not completed');
    expect(email.html).not.toMatch(/our (side|error)|technical (issue|error)|on our end/i);
    expect(email.html).not.toContain('—');
    expect(email.html).toContain('Unsubscribe');
  });

  it('tokens: a tampered token or another user id is refused', () => {
    const t = unsubscribeToken('u1')!;
    expect(verifyUnsubscribeToken('u1', t)).toBe(true);
    expect(verifyUnsubscribeToken('u2', t)).toBe(false);
    expect(verifyUnsubscribeToken('u1', t.replace(/.$/, t.endsWith('a') ? 'b' : 'a'))).toBe(false);
    expect(verifyUnsubscribeToken('u1', '')).toBe(false);
  });

  it('links never point to localhost', () => {
    expect(publicUrl('http://localhost:5173', 'https://tickrify.com')).toBe('https://tickrify.com');
    expect(publicUrl('https://tickrify.com/', 'x')).toBe('https://tickrify.com');
  });

  it.each<[LifecycleKind, boolean]>([
    ['activation_1', false],
    ['activation_2', false],
    ['checkout_recovery', false],
    ['checkout_recovery', true],
  ])('%s (declined=%s): no em dash, no emoji, has unsubscribe and the right link', (kind, declined) => {
    const email = renderLifecycleEmail(kind, {
      appUrl: 'https://tickrify.com',
      firstName: 'Ana',
      unsubscribeUrl: 'https://tickrify.onrender.com/api/email/unsubscribe?u=u1&t=abc',
      declined,
    });
    expect(email.html + email.subject).not.toMatch(/—/);
    expect(email.html + email.subject).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(email.html).toContain('Unsubscribe from these emails');
    expect(email.html).toContain('Hi Ana,');
    if (kind === 'checkout_recovery') expect(email.html).toContain('https://tickrify.com/pricing?cycle=weekly');
    if (kind === 'activation_2') expect(email.html).toContain('https://tickrify.com/blog/how-tickrify-works/#phone');
  });
});

describe('unsubscribe endpoint', () => {
  // Import tardio: o controller le o segredo do ambiente na hora da chamada.
  const { MailController } = jest.requireActual('./mail.controller');
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  function controllerWith(existing: boolean) {
    const prisma = {
      adminAudit: {
        findFirst: jest.fn().mockResolvedValue(existing ? { id: 'a' } : null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return { controller: new MailController(prisma as any), prisma };
  }

  it('valid link records the opt-out once and confirms', async () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-only-secret';
    const { controller, prisma } = controllerWith(false);
    const html = await controller.unsubscribePage({ u: 'u1', t: unsubscribeToken('u1')! });
    expect(html).toContain('You are unsubscribed');
    expect(prisma.adminAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: UNSUBSCRIBE_AUDIT_ACTION, targetUserId: 'u1' }),
    });
  });

  it('forged link changes nothing', async () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-only-secret';
    const { controller, prisma } = controllerWith(false);
    await expect(controller.unsubscribeOneClick({ u: 'u1', t: 'f'.repeat(32) })).resolves.toEqual({ ok: false });
    expect(prisma.adminAudit.create).not.toHaveBeenCalled();
  });
});
