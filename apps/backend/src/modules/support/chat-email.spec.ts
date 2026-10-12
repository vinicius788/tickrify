import { makeRawSqlPrisma } from '../../__tests__/raw-sql-mock';
import {
  FOUNDER_NOTIFY_EVERY_MS,
  REPLY_EMAIL_AFTER_MS,
  REPLY_EMAIL_EVERY_MS,
  notifyFounder,
  renderChatReplyEmail,
  runChatReplySweep,
} from './chat-email';
import { captureServer as captureServerMock } from '../../common/analytics/posthog';

jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));
const captureServer = captureServerMock as jest.Mock;

const T0 = new Date('2026-10-12T12:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const INPUT = { threadId: 'thread-cccccccc', clerkUserId: 'clerk_uC', userEmail: 'c@x.com', isSubscriber: false, freeLocked: true, body: 'Paywall question' };

/** Banco falso com o estado da reserva: o UPDATE condicional decide pelo relogio. */
function founderDb() {
  let last: Date | null = null;
  const harness = makeRawSqlPrisma([
    // Devolver a reserva vem antes: o trecho do UPDATE da reserva tambem casa aqui.
    ['SET "lastFounderNotifyAt" = NULL', () => { last = null; return 1; }],
    [
      'SET "lastFounderNotifyAt" = ',
      (_text, values) => {
        const [now, , cutoff] = values as [Date, string, Date];
        if (last === null || last.getTime() <= cutoff.getTime()) {
          last = now;
          return [{ id: INPUT.threadId }];
        }
        return [];
      },
    ],
  ]);
  return harness;
}

describe('aviso ao fundador (chat_founder_notify)', () => {
  beforeEach(() => captureServer.mockClear());

  it('no maximo 1 por conversa a cada 15 min (relogio falso)', async () => {
    const { prisma } = founderDb();
    const mail = { sendChatFounderNotify: jest.fn(async () => true), sendLifecycle: jest.fn() };
    const deps = (now: Date) => ({ prisma, mail, isEnabled: () => true, log: jest.fn(), now: () => now, to: 'support@tickrify.com' });

    expect(await notifyFounder(deps(T0), INPUT)).toBe(true);
    expect(await notifyFounder(deps(at(60_000)), INPUT)).toBe(false);
    expect(await notifyFounder(deps(at(FOUNDER_NOTIFY_EVERY_MS - 1)), INPUT)).toBe(false);
    expect(await notifyFounder(deps(at(FOUNDER_NOTIFY_EVERY_MS)), INPUT)).toBe(true);
    expect(mail.sendChatFounderNotify).toHaveBeenCalledTimes(2);
    expect(mail.sendChatFounderNotify).toHaveBeenCalledWith('support@tickrify.com', {
      userEmail: 'c@x.com', isSubscriber: false, freeLocked: true, body: 'Paywall question',
    });
    // O texto vai so no e-mail do suporte; o evento so leva o id.
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_founder_notify_sent', { threadId: INPUT.threadId });
  });

  it('chave desligada: nenhum envio e nenhuma reserva', async () => {
    const { prisma, calls } = founderDb();
    const mail = { sendChatFounderNotify: jest.fn(async () => true), sendLifecycle: jest.fn() };
    const log = jest.fn();
    expect(await notifyFounder({ prisma, mail, isEnabled: () => false, log, now: () => T0 }, INPUT)).toBe(false);
    expect(mail.sendChatFounderNotify).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith('info', `[chat] dry-run kind=chat_founder_notify thread=${INPUT.threadId}`);
  });

  it('provedor recusou: devolve a reserva e a proxima mensagem tenta de novo', async () => {
    const { prisma } = founderDb();
    const mail = { sendChatFounderNotify: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true), sendLifecycle: jest.fn() };
    const deps = (now: Date) => ({ prisma, mail, isEnabled: () => true, log: jest.fn(), now: () => now });
    expect(await notifyFounder(deps(T0), INPUT)).toBe(false);
    expect(await notifyFounder(deps(at(60_000)), INPUT)).toBe(true);
  });
});

describe('aviso de resposta (chat_reply)', () => {
  const F = T0;
  const candidate = (over: Record<string, unknown> = {}) => ({
    threadId: 'thread-cccccccc', userId: 'uC', clerkUserId: 'clerk_uC', email: 'c@x.com', name: 'Mattia',
    lastFounderMessageAt: F, lastReplyEmailAt: null, ...over,
  });
  const ENV = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  beforeAll(() => { process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret'; });
  afterAll(() => { process.env.EMAIL_UNSUBSCRIBE_SECRET = ENV; });
  beforeEach(() => captureServer.mockClear());

  function sweepDeps(rows: unknown[], claim = true, enabled = true) {
    const harness = makeRawSqlPrisma([
      ['FROM "tickrify"."SupportThread" t', () => rows],
      ['SET "lastReplyEmailAt" = ', () => (claim ? [{ id: 'thread-cccccccc' }] : [])],
    ]);
    const mail = { sendChatFounderNotify: jest.fn(), sendLifecycle: jest.fn(async () => true) };
    return { ...harness, mail, enabled };
  }

  it('consulta: so depois de 10 min sem ler, 1 a cada 6 h, nunca para descadastrado', async () => {
    const { prisma, calls, mail } = sweepDeps([]);
    const now = at(REPLY_EMAIL_AFTER_MS + 60_000);
    await runChatReplySweep({ prisma, mail, isEnabled: () => true, appUrl: 'https://tickrify.com', apiBaseUrl: 'https://api.test', log: jest.fn(), now: () => now });
    const query = calls[0];
    expect(query.text).toContain('"lastUserReadAt" < t."lastFounderMessageAt"');
    expect(query.text).toContain(`a."action" = `);
    expect(query.values).toContain('email_unsubscribed');
    expect(query.values).toEqual(expect.arrayContaining([
      new Date(now.getTime() - REPLY_EMAIL_AFTER_MS),
      new Date(now.getTime() - REPLY_EMAIL_EVERY_MS),
    ]));
  });

  it('envia sem o texto da resposta, com descadastro e o nome Vinícius', async () => {
    const { prisma, mail } = sweepDeps([candidate()]);
    const result = await runChatReplySweep({
      prisma, mail, isEnabled: () => true, appUrl: 'https://tickrify.com', apiBaseUrl: 'https://api.test', log: jest.fn(),
      now: () => at(REPLY_EMAIL_AFTER_MS),
    });
    expect(result.sent).toBe(1);
    const [to, email] = (mail.sendLifecycle as jest.Mock).mock.calls[0];
    expect(to).toBe('c@x.com');
    expect(email.kind).toBe('chat_reply');
    expect(email.subject).toBe('Vinícius replied to your message');
    expect(email.subject).not.toMatch(/\bVini\b/);
    expect(email.unsubscribeUrl).toContain('/api/email/unsubscribe?u=uC');
    expect(email.html).toContain('/dashboard?chat=open');
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_reply_email_sent', { threadId: 'thread-cccccccc' });
  });

  it('outra instancia ja reservou: nao envia de novo', async () => {
    const { prisma, mail } = sweepDeps([candidate()], false);
    const result = await runChatReplySweep({ prisma, mail, isEnabled: () => true, appUrl: 'x', apiBaseUrl: 'y', log: jest.fn(), now: () => at(REPLY_EMAIL_AFTER_MS) });
    expect(result.sent).toBe(0);
    expect(mail.sendLifecycle).not.toHaveBeenCalled();
  });

  it('chave desligada: so dry-run, uma vez por resposta (primeira volta depois dos 10 min)', async () => {
    const log = jest.fn();
    const { prisma, mail, calls } = sweepDeps([candidate()]);
    const first = await runChatReplySweep({ prisma, mail, isEnabled: () => false, appUrl: 'x', apiBaseUrl: 'y', log, now: () => at(REPLY_EMAIL_AFTER_MS + 60_000) });
    expect(first).toEqual({ sent: 0, dryRun: 1 });
    const later = await runChatReplySweep({ prisma, mail, isEnabled: () => false, appUrl: 'x', apiBaseUrl: 'y', log, now: () => at(REPLY_EMAIL_AFTER_MS + 30 * 60_000) });
    expect(later.dryRun).toBe(0);
    expect(mail.sendLifecycle).not.toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes('SET "lastReplyEmailAt"'))).toBe(false);
  });

  it('template: sem texto da conversa, botao abre o chat no painel', () => {
    const email = renderChatReplyEmail({ appUrl: 'https://tickrify.com/', firstName: 'Mattia', unsubscribeUrl: 'https://api.test/u' });
    expect(email.html).toContain('Open your Tickrify dashboard to read it');
    expect(email.html).toContain('https://tickrify.com/dashboard?chat=open');
    expect(email.html).not.toMatch(/—|–/);
  });
});
