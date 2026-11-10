import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import { TelegramService } from './telegram.service';
import { telegramWebhookSecret } from './telegram-alert';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));

function makeService(opts: { owner?: string | null; chatId?: string | null } = {}) {
  const { prisma, calls } = makePrisma([
    ['SELECT "chatId" FROM "tickrify"."UserTelegram"', () => (opts.chatId === undefined ? [] : [{ chatId: opts.chatId }])],
    ['WHERE "linkCode" = ', () => (opts.owner ? [{ userId: opts.owner }] : [])],
  ]);
  const sent: Array<{ method: string; body: any }> = [];
  const service = new TelegramService(prisma);
  service.fetchImpl = jest.fn(async (url: string, init: { body: string }) => {
    const method = url.split('/').pop() as string;
    sent.push({ method, body: JSON.parse(init.body) });
    return { status: 200, json: async () => ({ ok: true, result: method === 'getMe' ? { username: 'TickrifyAlertsBot' } : {} }) };
  }) as any;
  return { service, prisma, calls, sent };
}
const start = (text: string, type = 'private') => ({ message: { text, chat: { id: 777, type } } });

describe('TelegramService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'TOKEN';
    process.env.PUBLIC_API_URL = 'https://api.tickrify.com/';
  });
  afterEach(() => { process.env = { ...env }; });

  it('sem token: indisponivel, sem chamar o Telegram, e pedir link responde 503', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const t = makeService();
    await t.service.onModuleInit();
    expect(t.sent).toHaveLength(0);
    expect(await t.service.status('u1')).toEqual({ available: false, linked: false, botUsername: null });
    await expect(t.service.createLink('u1')).rejects.toMatchObject({ status: 503 });
  });

  it('no boot registra o webhook na URL publica com o segredo derivado do token', async () => {
    const t = makeService();
    await t.service.onModuleInit();
    const hook = t.sent.find((s) => s.method === 'setWebhook')!;
    expect(hook.body).toEqual({ url: 'https://api.tickrify.com/api/telegram/webhook', secret_token: telegramWebhookSecret('TOKEN'), allowed_updates: ['message'] });
  });

  it('o link leva ao bot com um codigo novo gravado para a conta', async () => {
    const t = makeService();
    await t.service.onModuleInit();
    const link = await t.service.createLink('u1');
    expect(link.url).toMatch(/^https:\/\/t\.me\/TickrifyAlertsBot\?start=[A-Za-z0-9_-]{24}$/);
    const insert = t.calls.find((c) => c.text.includes('INSERT INTO "tickrify"."UserTelegram"'))!;
    expect(insert.values).toContain('u1');
    expect(insert.values).toContain(link.url.split('start=')[1]);
  });

  it('/start com codigo valido liga o chat a conta e tira o chat de outra conta', async () => {
    const t = makeService({ owner: 'u1' });
    await t.service.onModuleInit();
    await t.service.handleUpdate(start('/start abcdefghijklmnopqrstuvwx'));
    const updates = t.calls.filter((c) => c.kind === 'execute' && c.text.includes('UPDATE "tickrify"."UserTelegram"'));
    expect(updates[0].text).toContain('"userId" <> ');
    expect(updates[1].values).toEqual(expect.arrayContaining(['777', 'u1']));
    expect(t.sent[t.sent.length - 1].body.text).toContain('Connected.');
  });

  it('codigo vencido ou inexistente nao liga nada', async () => {
    const t = makeService({ owner: null });
    await t.service.onModuleInit();
    await t.service.handleUpdate(start('/start abcdefghijklmnopqrstuvwx'));
    expect(t.calls.some((c) => c.kind === 'execute' && c.text.includes('SET "chatId" = '))).toBe(false);
    expect(t.sent[t.sent.length - 1].body.text).toContain('expired');
  });

  it('grupo ou canal e ignorado', async () => {
    const t = makeService({ owner: 'u1' });
    await t.service.onModuleInit();
    const before = t.sent.length;
    await t.service.handleUpdate(start('/start abcdefghijklmnopqrstuvwx', 'group'));
    expect(t.sent).toHaveLength(before);
  });

  it('/stop desliga o chat', async () => {
    const t = makeService();
    await t.service.onModuleInit();
    await t.service.handleUpdate(start('/stop'));
    expect(t.calls.some((c) => c.text.includes('SET "chatId" = NULL') && c.values.includes('777'))).toBe(true);
    expect(t.sent[t.sent.length - 1].body.text).toContain('Alerts are off');
  });

  it('o segredo do webhook so vale exato', async () => {
    const t = makeService();
    expect(t.service.isValidWebhookSecret(telegramWebhookSecret('TOKEN'))).toBe(true);
    expect(t.service.isValidWebhookSecret('errado')).toBe(false);
    expect(t.service.isValidWebhookSecret(undefined)).toBe(false);
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(t.service.isValidWebhookSecret(telegramWebhookSecret('TOKEN'))).toBe(false);
  });
});
