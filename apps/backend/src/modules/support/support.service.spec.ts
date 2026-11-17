import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { makeRawSqlPrisma } from '../../__tests__/raw-sql-mock';
import { SupportService, CHAT_RATE_LIMIT_PER_HOUR, feedbackAskText } from './support.service';
import { SupportAdminController } from './support-admin.controller';
import { SupportController } from './support.controller';
import { AdminGuard } from '../auth/admin.guard';
import { AdminChatStatusDto, AdminStartChatDto, ChatMessagesQueryDto, SendChatMessageDto } from './dto/support.dto';
import { captureServer as captureServerMock } from '../../common/analytics/posthog';
import { __resetFlagCacheForTests, applyFlagOverrideLocally } from '../../common/flags/feature-flags';

jest.mock('../../common/analytics/posthog', () => ({
  ...jest.requireActual('../../common/analytics/posthog'),
  captureServer: jest.fn(),
}));
const captureServer = captureServerMock as jest.Mock;

const THREAD_C = { id: 'thread-cccccccc', userId: 'uC', status: 'open', lastMessageAt: null, lastUserReadAt: null, lastFounderReadAt: null };
const SECRET_TEXT = 'my broker account is 12345 and I hate WAIT <script>alert(1)</script>';

function setup(routes: Array<[string, (text: string, values: unknown[]) => unknown]> = [], opts: { freeLocked?: boolean } = {}) {
  const { prisma, calls } = makeRawSqlPrisma(
    [
      // Os do teste primeiro: o primeiro trecho que casa responde.
      ...routes,
      ['COUNT(*)::int AS "n"\n      FROM "tickrify"."SupportMessage" m', () => [{ n: 0 }]],
      ['INSERT INTO "tickrify"."SupportThread"', () => [{ id: THREAD_C.id }]],
      ['FROM "tickrify"."SupportThread" WHERE "userId"', (_t, values) => (values.includes('uC') ? [THREAD_C] : [])],
      ['INSERT INTO "tickrify"."SupportMessage"', (_t, values) => [{ id: 'msg-1', author: values[2], body: values[3], createdAt: new Date('2026-10-12T12:00:00Z') }]],
    ],
    { subscription: { findFirst: jest.fn(async () => null) } },
  );
  const mail = { sendChatFounderNotify: jest.fn(async () => true), sendLifecycle: jest.fn(async () => true) };
  const ai = { isFreeLocked: jest.fn(async () => opts.freeLocked ?? false) };
  const service = new SupportService(prisma, mail as any, ai as any);
  return { service, prisma, calls, mail, ai };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SupportService (chat com o fundador)', () => {
  beforeEach(() => {
    captureServer.mockClear();
    __resetFlagCacheForTests();
  });

  it('a mensagem vai para a conversa do token, guardada como texto puro', async () => {
    const { service, calls } = setup();
    await service.onModuleInit();
    const { message } = await service.sendUserMessage({ id: 'uC', clerkUserId: 'clerk_uC' }, `  ${SECRET_TEXT}  `);

    expect(message.body).toBe(SECRET_TEXT);
    const insert = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SupportMessage"'));
    expect(insert?.values).toEqual(expect.arrayContaining([THREAD_C.id, 'user', SECRET_TEXT]));
    const thread = calls.find((c) => c.text.includes('INSERT INTO "tickrify"."SupportThread"'));
    expect(thread?.values).toContain('uC');
  });

  it('usuario B nunca le nem escreve na conversa de A: tudo sai do id do token', async () => {
    const { service, calls } = setup();
    await service.onModuleInit();
    expect(await service.getThreadForUser('uB')).toEqual({ thread: null });
    expect(await service.listMessagesForUser('uB', null)).toEqual({ items: [], nextCursor: null });
    // Nenhuma consulta de mensagens rodou para B: sem conversa, sem leitura.
    expect(calls.some((c) => c.text.includes('FROM "tickrify"."SupportMessage"\n      WHERE "threadId"'))).toBe(false);
  });

  it('o corpo da requisicao nao escolhe conversa: DTO recusa id de conversa ou de usuario', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    const meta = { type: 'body' as const, metatype: SendChatMessageDto };
    await expect(pipe.transform({ body: 'hi' }, meta)).resolves.toBeDefined();
    await expect(pipe.transform({ body: 'hi', threadId: THREAD_C.id }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ body: 'hi', userId: 'uC' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ body: 'x'.repeat(2001) }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ body: 'x'.repeat(2000) }, meta)).resolves.toBeDefined();
    await expect(pipe.transform({}, meta)).rejects.toBeDefined();
  });

  it('corpo vazio e acima de 2000 sao recusados tambem no servico', async () => {
    const { service } = setup();
    await service.onModuleInit();
    await expect(service.sendUserMessage({ id: 'uC' }, '   \n ')).rejects.toMatchObject({ status: 400, response: expect.objectContaining({ code: 'chat_empty' }) });
    await expect(service.sendUserMessage({ id: 'uC' }, 'x'.repeat(2001))).rejects.toMatchObject({ status: 400 });
  });

  it(`limite de ${CHAT_RATE_LIMIT_PER_HOUR} mensagens por hora, contado no banco`, async () => {
    const { service, calls } = setup([['COUNT(*)::int AS "n"\n      FROM "tickrify"."SupportMessage" m', () => [{ n: CHAT_RATE_LIMIT_PER_HOUR }]]]);
    await service.onModuleInit();
    await expect(service.sendUserMessage({ id: 'uC' }, 'one more')).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ code: 'chat_rate_limited' }),
    });
    expect(calls.some((c) => c.text.includes('INSERT INTO "tickrify"."SupportMessage"'))).toBe(false);
  });

  it('gratis esgotado CONSEGUE conversar (o chat nao passa pela trava) e o evento marca freeLocked', async () => {
    const { service, calls } = setup([], { freeLocked: true });
    await service.onModuleInit();
    await expect(service.sendUserMessage({ id: 'uC', clerkUserId: 'clerk_uC' }, 'why is it locked?')).resolves.toBeDefined();
    expect(calls.some((c) => c.text.includes('INSERT INTO "tickrify"."SupportMessage"'))).toBe(true);
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_message_sent', expect.objectContaining({ freeLocked: true, author: 'user' }));
  });

  it('nenhuma propriedade de evento contem o corpo da mensagem', async () => {
    const { service } = setup();
    await service.onModuleInit();
    await service.sendUserMessage({ id: 'uC', clerkUserId: 'clerk_uC' }, SECRET_TEXT);
    await flush();
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_thread_started', { threadId: THREAD_C.id, startedBy: 'user' });
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_message_sent', {
      threadId: THREAD_C.id,
      author: 'user',
      length: SECRET_TEXT.length,
      isSubscriber: false,
      freeLocked: false,
    });
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('12345');
    expect(JSON.stringify(captureServer.mock.calls)).not.toContain('script');
  });

  it('chave CHAT_EMAIL_NOTIFY desligada (padrao): nenhum e-mail, so dry-run', async () => {
    const { service, mail, calls } = setup();
    await service.onModuleInit();
    await service.sendUserMessage({ id: 'uC', clerkUserId: 'clerk_uC' }, 'hello');
    await flush();
    expect(mail.sendChatFounderNotify).not.toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes('"lastFounderNotifyAt"'))).toBe(false);
  });

  it('chave ligada: avisa o fundador com o texto, reservando no banco (1 a cada 15 min)', async () => {
    applyFlagOverrideLocally('CHAT_EMAIL_NOTIFY', 'true');
    const { service, mail, calls } = setup([['SET "lastFounderNotifyAt"', () => [{ id: THREAD_C.id }]]]);
    await service.onModuleInit();
    await service.sendUserMessage({ id: 'uC', clerkUserId: 'clerk_uC', email: 'c@x.com' }, 'hello founder');
    await flush();
    expect(calls.find((c) => c.text.includes('SET "lastFounderNotifyAt"'))?.text).toContain('"lastFounderNotifyAt" <= ');
    expect(mail.sendChatFounderNotify).toHaveBeenCalledWith('support@tickrify.com', expect.objectContaining({ body: 'hello founder', userEmail: 'c@x.com' }));
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_founder_notify_sent', { threadId: THREAD_C.id });
  });

  it('resposta do fundador marca lastFounderMessageAt e o evento vai para a pessoa da conversa', async () => {
    const { service, calls } = setup([
      ['WHERE t."id" = ', () => [{ ...THREAD_C, clerkUserId: 'clerk_uC', email: 'c@x.com' }]],
    ]);
    await service.onModuleInit();
    await service.adminReply(THREAD_C.id, 'Thanks for writing');
    const touch = calls.find((c) => c.text.includes('"lastFounderMessageAt" = '));
    expect(touch).toBeDefined();
    await flush();
    expect(captureServer).toHaveBeenCalledWith('clerk_uC', 'chat_message_sent', expect.objectContaining({ author: 'founder', length: 18 }));
  });

  it('o /admin recebe quando a pessoa leu (userReadAt), na conversa e na lista', async () => {
    const lida = new Date('2026-11-17T13:00:00Z');
    const { service } = setup([
      ['WHERE t."id" = ', () => [{ ...THREAD_C, lastUserReadAt: lida, clerkUserId: 'clerk_uC', email: 'c@x.com' }]],
      ['SELECT * FROM (', () => [{ ...THREAD_C, lastUserReadAt: lida, createdAt: lida, email: 'c@x.com', unread: 0, lastAuthor: 'founder' }]],
      ['ORDER BY "createdAt" DESC', () => []],
    ]);
    await service.onModuleInit();
    const conversa = await service.adminGetThread(THREAD_C.id, null);
    expect(conversa.thread.userReadAt).toEqual(lida);
    const lista = await service.adminListThreads();
    expect(lista.items[0].userReadAt).toEqual(lida);
  });

  it('sem as tabelas no boot: 503 e nada gravado', async () => {
    const { service, prisma, calls } = setup();
    prisma.$executeRawUnsafe.mockRejectedValue(new Error('denied'));
    await service.onModuleInit();
    await expect(service.sendUserMessage({ id: 'uC' }, 'hi')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
});

describe('rotas do chat: acesso', () => {
  it('rotas do dono exigem AuthGuard + AdminGuard na classe; usuario comum leva 403', () => {
    const guards = new Reflector().get(GUARDS_METADATA, SupportAdminController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([AdminGuard]));
    const context = { switchToHttp: () => ({ getRequest: () => ({ user: { id: 'uC', role: 'user' } }) }) } as any;
    expect(() => new AdminGuard().canActivate(context)).toThrow(ForbiddenException);
    const admin = { switchToHttp: () => ({ getRequest: () => ({ user: { id: 'owner', role: 'admin' } }) }) } as any;
    expect(new AdminGuard().canActivate(admin)).toBe(true);
  });

  it('rotas do usuario nao aceitam id na URL: so a propria conversa', () => {
    const routes = Object.getOwnPropertyNames(SupportController.prototype)
      .filter((name) => name !== 'constructor' && name !== 'requireId')
      .map((name) => Reflect.getMetadata('path', (SupportController.prototype as any)[name]));
    expect(routes.sort()).toEqual(['messages', 'messages', 'read', 'thread']);
  });

  it('DTOs do admin: status fechado na lista e e-mail valido', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    await expect(pipe.transform({ status: 'closed' }, { type: 'body', metatype: AdminChatStatusDto })).resolves.toBeDefined();
    await expect(pipe.transform({ status: 'deleted' }, { type: 'body', metatype: AdminChatStatusDto })).rejects.toBeDefined();
    await expect(pipe.transform({ email: 'a@b.com', body: 'hi' }, { type: 'body', metatype: AdminStartChatDto })).resolves.toBeDefined();
    await expect(pipe.transform({ email: 'not-an-email', body: 'hi' }, { type: 'body', metatype: AdminStartChatDto })).rejects.toBeDefined();
    await expect(pipe.transform({ cursor: "x' OR 1=1" }, { type: 'query', metatype: ChatMessagesQueryDto })).rejects.toBeDefined();
  });

  describe('pedido de feedback do fundador (CHAT_FEEDBACK_ASK)', () => {
    beforeEach(() => {
      captureServer.mockClear();
      __resetFlagCacheForTests();
    });

    const THREAD_B = { id: 'thread-bbbbbbbb', userId: 'uB', status: 'open', lastMessageAt: null, lastUserReadAt: null, lastFounderReadAt: null };

    /** Conversa de B passa a existir quando o INSERT roda; a mensagem so entra uma vez (ON CONFLICT). */
    function feedbackSetup(user: { name: string | null; eligible: boolean } = { name: 'Ana Souza', eligible: true }) {
      let threadExists = false;
      let messageExists = false;
      return setup([
        ['FROM "tickrify"."User" u WHERE u."id"', () => [{ ...user, clerkUserId: 'clerk_uB' }]],
        ['INSERT INTO "tickrify"."SupportThread"', () => {
          const created = !threadExists;
          threadExists = true;
          return created ? [{ id: THREAD_B.id }] : [];
        }],
        ['FROM "tickrify"."SupportThread" WHERE "userId"', (_t, values) => (values.includes('uB') && threadExists ? [THREAD_B] : [])],
        ['ON CONFLICT ("id") DO NOTHING', () => {
          if (messageExists) return [];
          messageExists = true;
          return [{ id: 'feedback_ask:uB', createdAt: new Date('2026-10-20T13:00:00Z') }];
        }],
        ['SELECT COUNT(*)::int AS "n" FROM "tickrify"."SupportMessage"', () => [{ n: messageExists ? 1 : 0 }]],
      ]);
    }

    it('chave desligada (padrao): nada e criado, nem consulta extra', async () => {
      const { service, calls } = feedbackSetup();
      await service.onModuleInit();
      expect(await service.getThreadForUser('uB')).toEqual({ thread: null });
      expect(calls.some((c) => c.text.includes('ON CONFLICT ("id") DO NOTHING'))).toBe(false);
      expect(calls.some((c) => c.text.includes('FROM "tickrify"."User" u'))).toBe(false);
    });

    it('chave ligada e ja fez analise: cria a conversa com 1 mensagem do fundador, que aparece como nao lida', async () => {
      applyFlagOverrideLocally('CHAT_FEEDBACK_ASK', 'true');
      const { service, calls } = feedbackSetup();
      await service.onModuleInit();

      const { thread } = await service.getThreadForUser('uB');

      expect(thread).toEqual(expect.objectContaining({ id: THREAD_B.id, unread: 1 }));
      const insert = calls.find((c) => c.text.includes('ON CONFLICT ("id") DO NOTHING'));
      expect(insert?.text).toContain("'founder'");
      expect(insert?.values).toEqual(expect.arrayContaining(['feedback_ask:uB', THREAD_B.id, feedbackAskText('Ana Souza')]));
      expect(captureServer).toHaveBeenCalledWith('clerk_uB', 'chat_feedback_ask_sent', { threadId: THREAD_B.id });
      expect(captureServer).toHaveBeenCalledWith('clerk_uB', 'chat_thread_started', { threadId: THREAD_B.id, startedBy: 'founder_auto' });
    });

    it('nao marca lastFounderMessageAt: o e-mail "o fundador respondeu" nunca sai por esta mensagem', async () => {
      applyFlagOverrideLocally('CHAT_FEEDBACK_ASK', 'true');
      const { service, calls } = feedbackSetup();
      await service.onModuleInit();
      await service.getThreadForUser('uB');
      expect(calls.some((c) => c.text.includes('"lastFounderMessageAt"'))).toBe(false);
    });

    it('uma vez por pessoa: abrir o painel de novo (ou a outra instancia) nao repete a mensagem', async () => {
      applyFlagOverrideLocally('CHAT_FEEDBACK_ASK', 'true');
      const { service, calls } = feedbackSetup();
      await service.onModuleInit();
      await service.getThreadForUser('uB');
      await service.getThreadForUser('uB');

      expect(calls.filter((c) => c.text.includes('ON CONFLICT ("id") DO NOTHING'))).toHaveLength(1);
      expect(captureServer.mock.calls.filter((c) => c[1] === 'chat_feedback_ask_sent')).toHaveLength(1);
    });

    it('quem ainda nao fez nenhuma analise nao recebe', async () => {
      applyFlagOverrideLocally('CHAT_FEEDBACK_ASK', 'true');
      const { service, calls } = feedbackSetup({ name: 'Ana', eligible: false });
      await service.onModuleInit();
      expect(await service.getThreadForUser('uB')).toEqual({ thread: null });
      expect(calls.some((c) => c.text.includes('INSERT INTO "tickrify"."SupportThread"'))).toBe(false);
    });

    it('quem ja tem conversa com o fundador nao recebe o pedido', async () => {
      applyFlagOverrideLocally('CHAT_FEEDBACK_ASK', 'true');
      const { service, calls } = setup([['SELECT COUNT(*)::int AS "n" FROM "tickrify"."SupportMessage"', () => [{ n: 0 }]]]);
      await service.onModuleInit();
      expect((await service.getThreadForUser('uC')).thread).toEqual(expect.objectContaining({ id: THREAD_C.id, unread: 0 }));
      expect(calls.some((c) => c.text.includes('ON CONFLICT ("id") DO NOTHING'))).toBe(false);
    });

    it('texto: primeiro nome sem marcacao, sem travessao, e "there" quando nao ha nome', () => {
      expect(feedbackAskText('Ana <b>Souza</b>')).toMatch(/^Hi Ana, I'm Vinicius/);
      expect(feedbackAskText(null)).toMatch(/^Hi there, /);
      expect(feedbackAskText('Ana')).not.toContain('\u2014');
      expect(feedbackAskText('Ana').length).toBeLessThan(2000);
    });
  });
});
