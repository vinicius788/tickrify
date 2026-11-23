import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import {
  renderSetupAlertTelegram,
  resetTelegramSchemaForTest,
  runSetupAlertTelegramSweep,
  telegramWebhookSecret,
  TELEGRAM_ALERT_RULES,
} from './telegram-alert';

const NOW = new Date('2026-11-10T14:45:00Z');
const pending = (extra: Record<string, unknown> = {}) => ({
  alertId: 'alert-1',
  setupId: 'setup-1',
  userId: 'u1',
  chatId: '777',
  symbol: 'BTCUSDT',
  priceSymbol: 'BTCUSDT',
  timeframe: '5m',
  level: 74530,
  label: 'entry',
  triggeredAt: new Date('2026-11-10T14:44:00Z'),
  clerkUserId: 'clerk_1',
  analysisResult: { analysis: { symbol: 'BTCUSDT', entry: 74530, stopLoss: 74380, takeProfit1: 74880, invalidationLevel: 74410 } },
  analysisRecommendation: 'BUY',
  ...extra,
});

function makeDeps(opts: { enabled?: boolean; token?: string | null; rows?: unknown[]; personRecent?: number; claimed?: number; status?: number } = {}) {
  const { prisma, calls } = makePrisma([
    ['WHERE a."status" = \'triggered\'', () => opts.rows ?? [pending()]],
    ['AS "personRecent"', () => [{ personRecent: opts.personRecent ?? 0 }]],
    ['INSERT INTO "tickrify"."TelegramAlertSend"', () => opts.claimed ?? 1],
  ]);
  const status = opts.status ?? 200;
  const fetchImpl = jest.fn(async () => ({ status, json: async () => ({ ok: status === 200, result: {} }) }));
  const capture = jest.fn();
  const log = jest.fn();
  return {
    calls, fetchImpl, capture, log, prisma,
    deps: {
      prisma, token: opts.token === undefined ? 'TOKEN' : opts.token, isEnabled: () => opts.enabled ?? true,
      appUrl: 'https://tickrify.com', now: () => NOW, capture, fetchImpl, log,
    },
  };
}
const executed = (calls: Array<{ kind: string; text: string }>, needle: string) => calls.filter((c) => c.kind === 'execute' && c.text.includes(needle));

describe('alerta de nivel pelo Telegram', () => {
  beforeEach(() => resetTelegramSchemaForTest());

  it('a mensagem diz o nivel, a hora, a invalidacao e que nao e sinal; o botao leva ao fluxo de atualizar', () => {
    const m = renderSetupAlertTelegram('https://tickrify.com/', {
      ...pending(), level: 74530, plan: { direction: 'long', invalidation: 74410, target: 74880, conditional: null },
    } as any);
    expect(m.text).toContain('BTCUSDT 5m reached 74,530');
    expect(m.text).toContain('Possible buy level from your analysis. Touched at 14:44 UTC.');
    expect(m.text).toContain('Invalidation 74,410.');
    expect(m.text).toContain('This is not a signal to enter.');
    expect(m.text).not.toMatch(/[—–]/);
    expect(m.button.url).toBe('https://tickrify.com/dashboard/new?setup=setup-1&alert=alert-1&utm_source=telegram&utm_campaign=setup_alert');
  });

  it('alerta do My assets: nao fala em analise, o botao abre a nova analise com o ativo, e a varredura aceita sem setup', async () => {
    const m = renderSetupAlertTelegram('https://tickrify.com', {
      ...pending(), setupId: null, timeframe: null, label: 'custom', level: 74530, plan: { direction: null, invalidation: null, target: null, conditional: null },
    } as any);
    expect(m.text).toContain('BTCUSDT reached 74,530');
    expect(m.text).toContain('Nearest level from recent candles. Touched at 14:44 UTC.');
    expect(m.text).not.toContain('your analysis');
    expect(m.text).toContain('This is not a signal to enter.');
    expect(m.button).toEqual({ text: 'Analyze chart', url: 'https://tickrify.com/dashboard/new?asset=BTCUSDT&alert=alert-1&utm_source=telegram&utm_campaign=setup_alert' });
    const t = makeDeps({});
    await runSetupAlertTelegramSweep(t.deps as any);
    const sweep = t.calls.find((c) => c.text.includes(`a."status" = 'triggered'`))!;
    expect(sweep.text).toContain('LEFT JOIN "tickrify"."TrackedSetup"');
    expect(sweep.text).toContain('a."setupId" IS NULL OR s."id" IS NOT NULL');
  });

  it('sem token nao consulta nada', async () => {
    const t = makeDeps({ token: null });
    expect(await runSetupAlertTelegramSweep(t.deps)).toEqual({ due: 0, sent: 0 });
    expect(t.calls).toHaveLength(0);
    expect(t.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('chave desligada: so loga quem receberia, sem reservar nem enviar', async () => {
    const t = makeDeps({ enabled: false });
    expect(await runSetupAlertTelegramSweep(t.deps)).toEqual({ due: 1, sent: 0 });
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(executed(t.calls, 'TelegramAlertSend')).toHaveLength(0);
    expect(t.log).toHaveBeenCalledWith('log', '[telegram] dry-run user=u1 alert=alert-1');
  });

  it('ligada: reserva, envia ao chat da pessoa e marca o alerta para o e-mail nao sair', async () => {
    const t = makeDeps();
    expect(await runSetupAlertTelegramSweep(t.deps)).toEqual({ due: 1, sent: 1 });
    const [url, init] = t.fetchImpl.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('777');
    expect(body.reply_markup.inline_keyboard[0][0].text).toBe('Update chart');
    expect(executed(t.calls, 'SET "emailedAt"')).toHaveLength(1);
    expect(t.capture).toHaveBeenCalledWith('clerk_1', 'setup_alert_telegram_sent', expect.objectContaining({ alertId: 'alert-1' }), expect.anything());
    expect(t.log.mock.calls.some(([, m]) => String(m).includes('TOKEN'))).toBe(false);
  });

  it('outra instancia ja reservou: nao envia de novo', async () => {
    const t = makeDeps({ claimed: 0 });
    expect(await runSetupAlertTelegramSweep(t.deps)).toEqual({ due: 1, sent: 0 });
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it('teto de mensagens por pessoa em 24h', async () => {
    const t = makeDeps({ personRecent: TELEGRAM_ALERT_RULES.perPersonPer24h });
    expect(await runSetupAlertTelegramSweep(t.deps)).toEqual({ due: 0, sent: 0 });
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });

  it('envio recusado tira a reserva e deixa o e-mail como reserva', async () => {
    const t = makeDeps({ status: 500 });
    expect(await runSetupAlertTelegramSweep(t.deps)).toEqual({ due: 1, sent: 0 });
    expect(executed(t.calls, 'DELETE FROM "tickrify"."TelegramAlertSend"')).toHaveLength(1);
    expect(executed(t.calls, 'SET "emailedAt"')).toHaveLength(0);
    expect(executed(t.calls, 'UPDATE "tickrify"."UserTelegram"')).toHaveLength(0);
  });

  it('bot bloqueado pela pessoa (403) desliga a conta do Telegram', async () => {
    const t = makeDeps({ status: 403 });
    await runSetupAlertTelegramSweep(t.deps);
    expect(executed(t.calls, 'UPDATE "tickrify"."UserTelegram" SET "chatId" = NULL')).toHaveLength(1);
  });

  it('o segredo do webhook depende do token e cabe no limite do Telegram', () => {
    expect(telegramWebhookSecret('a')).toMatch(/^[a-f0-9]{48}$/);
    expect(telegramWebhookSecret('a')).not.toBe(telegramWebhookSecret('b'));
  });
});

describe('Watch que arma sozinho: Telegram', () => {
  const armed = { status: 'armed', direction: 'long', entry: 74530, stop: 74380, target: 74880, checkedAt: '2026-11-10T14:44:00.000Z' };
  const item = (armCheck: unknown) => ({ ...pending(), level: 74530, plan: { direction: 'long', invalidation: 74410, target: null, conditional: null }, armCheck } as never);

  it('armado: mesma frase do e-mail e Your call', () => {
    const m = renderSetupAlertTelegram('https://tickrify.com', item(armed));
    expect(m.text).toContain('Setup armed: buy at 74,530, stop 74,380, target 74,880.');
    expect(m.text).toContain('This is not a signal to enter. Your call.');
  });

  it('invalidado (venda: acima)', () => {
    const m = renderSetupAlertTelegram('https://tickrify.com', item({ ...armed, status: 'invalidated', direction: 'short', stop: 74900, target: null }));
    expect(m.text).toContain('Setup invalidated: a candle closed above 74,900 before price reached 74,530.');
  });

  it('sem conferencia: igual a antes', () => {
    expect(renderSetupAlertTelegram('https://tickrify.com', item(null)).text).not.toContain('Your call');
  });
});
