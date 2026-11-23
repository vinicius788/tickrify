import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import { alertPlanOf, formatLevel, renderSetupAlertEmail, runSetupAlertEmailSweep, setupAlertLink } from './setup-alert-email';
import { UNSUBSCRIBE_AUDIT_ACTION } from './lifecycle-email';

const NOW = new Date('2026-10-27T13:50:00Z');
const pending = (extra: Record<string, unknown> = {}) => ({
  alertId: 'alert-1',
  setupId: 'setup-aaaaaaaa',
  userId: 'u1',
  symbol: 'XAUUSD',
  priceSymbol: 'XAUUSD',
  timeframe: '15m',
  level: 4180,
  label: 'tp1',
  triggeredAt: new Date('2026-10-27T13:42:00Z'),
  email: 'u1@x.com',
  name: 'Joao Silva',
  clerkUserId: 'clerk_1',
  analysisResult: { analysis: { symbol: 'XAUUSD', takeProfit1: 4180, stopLoss: 4100, entry: 4140, invalidationLevel: 4095 } },
  analysisRecommendation: 'BUY',
  plan: { direction: 'long', invalidation: 4095, target: 4180, conditional: null },
  ...extra,
});

function makeDeps(opts: {
  enabled?: boolean;
  rows?: unknown[];
  setupRecent?: number;
  personRecent?: number;
  unsubscribed?: boolean;
  sendOk?: boolean;
  claimed?: number;
}) {
  const { prisma, calls } = makePrisma(
    [
      ['WHERE a."status" = \'triggered\'', () => opts.rows ?? [pending()]],
      ['AS "setupRecent"', () => [{ setupRecent: opts.setupRecent ?? 0, personRecent: opts.personRecent ?? 0 }]],
      ['SET "emailedAt" = ', (text) => (text.includes('NULL WHERE') ? 1 : opts.claimed ?? 1)],
    ],
    {
      adminAudit: {
        findFirst: jest.fn(async ({ where }: any) =>
          opts.unsubscribed && where.action === UNSUBSCRIBE_AUDIT_ACTION ? { id: 'a1' } : null,
        ),
      },
    },
  );
  const mail = { sendLifecycle: jest.fn(async () => opts.sendOk ?? true) };
  const capture = jest.fn();
  const log = jest.fn();
  const deps = {
    prisma,
    mail,
    isEnabled: () => opts.enabled ?? true,
    appUrl: 'https://tickrify.com',
    apiBaseUrl: 'https://api.tickrify.com',
    now: () => NOW,
    capture,
    log,
  };
  return { deps, calls, mail, capture, log };
}

describe('setup-alert email', () => {
  const oldSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  beforeAll(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-secret';
  });
  afterAll(() => {
    if (oldSecret === undefined) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = oldSecret;
  });

  it('texto: assunto, plano, hora UTC, aviso de que nao e sinal, link com utm e remetente da marca, sem o nome do dono', () => {
    const email = renderSetupAlertEmail({
      appUrl: 'https://tickrify.com',
      firstName: 'Joao',
      item: pending() as any,
      unsubscribeUrl: 'https://api.tickrify.com/api/email/unsubscribe?u=u1&t=x',
    });
    expect(email.subject).toBe('Your XAUUSD setup reached 4,180');
    expect(email.kind).toBe('setup_alert');
    expect(email.html).toContain('target 1 from your analysis');
    expect(email.html).toContain('<b>Direction:</b> Buy');
    expect(email.html).toContain('<b>Invalidation:</b> 4,095');
    expect(email.html).toContain('<b>Target:</b> 4,180');
    expect(email.html).toContain('>Update chart</a>');
    expect(email.from).toBe('Tickrify <alerts@tickrify.com>');
    expect(email.replyTo).toBe('support@tickrify.com');
    expect(email.html).toContain('13:42 UTC on Oct 27');
    expect(email.html).toContain('Update the chart to review it. This is not a signal to enter.');
    expect(email.html).toContain(
      'https://tickrify.com/dashboard/new?setup=setup-aaaaaaaa&amp;alert=alert-1&amp;utm_source=email&amp;utm_campaign=setup_alert',
    );
    expect(email.html).not.toMatch(/Vin[ií]/);
    expect(email.html).not.toContain('—');
    expect(email.html).toContain('Unsubscribe');
  });

  it('alerta do WATCH diz o que o nivel e, sem alvo; custom diz que foi escolhido', () => {
    const render = (label: string, plan: object) => renderSetupAlertEmail({ appUrl: 'https://tickrify.com', firstName: null, item: pending({ label, plan }) as any, unsubscribeUrl: 'https://x/u' }).html;
    const watch = render('entry', { direction: 'short', invalidation: 4200, target: null, conditional: null });
    expect(watch).toContain('possible sell level from your analysis');
    expect(watch).toContain('<b>Direction:</b> Sell');
    expect(watch).not.toContain('<b>Target:</b>');
    const custom = render('custom', { direction: null, invalidation: null, target: null, conditional: null });
    expect(custom).toContain('the level you chose');
    expect(custom).not.toContain('<b>Direction:</b>');
    expect(custom).not.toContain('<b>Invalidation:</b>');
  });

  it('plano condicional do WATCH; sem geometria valida so nivel e invalidacao', () => {
    const render = (conditional: object | null) => renderSetupAlertEmail({ appUrl: 'https://tickrify.com', firstName: null, item: pending({ label: 'entry', plan: { direction: 'long', invalidation: 4095, target: null, conditional } }) as any, unsubscribeUrl: 'https://x/u' }).html;
    expect(render({ entry: 4180, stopLoss: 4150, takeProfit1: 4240, tp1R: 2 })).toContain('<b>Plan if price reaches 4,180:</b> buy at 4,180, stop 4,150, target 4,240 (2.0R).');
    const none = render(null);
    expect(none).not.toContain('Plan if price reaches');
    expect(none).toContain('<b>Invalidation:</b> 4,095');
  });

  it('alertPlanOf: WATCH usa o plano; BUY usa alvo e invalidacao gravados', () => {
    const watchResult = { signalState: 'WATCH', watchPlan: { direction: 'long', zoneLow: 99, zoneHigh: 100, invalidation: 95, target1: 110, target2: null, validForCandles: 6, trigger: 'x', triggerType: 'zone_reaction' } };
    expect(alertPlanOf(watchResult, 'HOLD')).toEqual({ direction: 'long', invalidation: 95, target: null, conditional: null });
    const levels = { entry: 100, stopLoss: 96, takeProfit1: 110, takeProfit2: null, riskAtr: 1, tp1R: 2.5, stopWidened: false };
    expect(alertPlanOf({ ...watchResult, watchLevels: levels }, 'HOLD').conditional).toEqual({ entry: 100, stopLoss: 96, takeProfit1: 110, tp1R: 2.5 });
    expect(alertPlanOf({ analysis: { entry: 100, stopLoss: 95, takeProfit1: 110, invalidationLevel: 94 } }, 'SELL')).toEqual({ direction: 'short', invalidation: 94, target: 110, conditional: null });
  });

  it('alertPlanOf: nivel da IA de um NO_TRADE rebaixado', () => {
    const aiLevel = { price: 99, direction: 'short', invalidation: 104, validForCandles: 6, reason: 'no_valid_geometry' };
    expect(alertPlanOf({ signalState: 'NO_TRADE', aiLevel }, 'HOLD')).toEqual({ direction: 'short', invalidation: 104, target: null, conditional: null });
  });

  it('niveis formatados sem perder casas de forex', () => {
    expect(formatLevel(4180)).toBe('4,180');
    expect(formatLevel(1.0952)).toBe('1.0952');
    expect(formatLevel(0.00001234)).toBe('0.00001234');
    expect(setupAlertLink('https://tickrify.com/', { setupId: 's1', alertId: 'a1', symbol: 'XAUUSD' })).toBe(
      'https://tickrify.com/dashboard/new?setup=s1&alert=a1&utm_source=email&utm_campaign=setup_alert',
    );
  });

  it('alerta do My assets: sem setup, o link abre a nova analise com o ativo e o texto nao fala em analise', () => {
    expect(setupAlertLink('https://tickrify.com', { setupId: null, alertId: 'a1', symbol: 'XAUUSD' }, 'telegram')).toBe(
      'https://tickrify.com/dashboard/new?asset=XAUUSD&alert=a1&utm_source=telegram&utm_campaign=setup_alert',
    );
    const item = { ...pending({ setupId: null, timeframe: null, label: 'custom' }), plan: alertPlanOf(null, null) } as any;
    const mail = renderSetupAlertEmail({ appUrl: 'https://tickrify.com', firstName: 'Joao', item, unsubscribeUrl: 'https://api.tickrify.com/u' });
    expect(mail.subject).toBe('XAUUSD reached 4,180');
    expect(mail.html).toContain('a level you are watching on <b>XAUUSD</b> in My assets');
    expect(mail.html).toContain('nearest level from recent candles');
    expect(mail.html).toContain('Analyze chart');
    expect(mail.html).toContain('This is not a signal to enter.');
    expect(mail.html).not.toContain('your analysis');
    expect(mail.html).not.toContain('Direction:');
    expect(mail.html).not.toContain('—');
  });

  it('alerta do My assets entra na varredura e o intervalo e por ativo, nao por setup', async () => {
    const t = makeDeps({ rows: [pending({ setupId: null, timeframe: null, label: 'custom', analysisResult: null, analysisRecommendation: null })] });
    await expect(runSetupAlertEmailSweep(t.deps as any)).resolves.toEqual({ due: 1, sent: 1 });
    const sweep = t.calls.find((c) => c.text.includes(`WHERE a."status" = 'triggered'`))!;
    expect(sweep.text).toContain('LEFT JOIN "tickrify"."TrackedSetup"');
    expect(sweep.text).toContain('a."setupId" IS NULL OR s."id" IS NOT NULL');
    const limits = t.calls.find((c) => c.text.includes('AS "setupRecent"'))!;
    expect(limits.text).toContain('"setupId" IS NULL AND "priceSymbol" =');
    expect(limits.values).toContain('XAUUSD');
    expect(t.capture).toHaveBeenCalledWith('clerk_1', 'setup_alert_email_sent', expect.objectContaining({ setupId: null }), expect.anything());
  });

  it('chave desligada: so dry-run, sem marcar nem enviar', async () => {
    const { deps, calls, mail, log } = makeDeps({ enabled: false });
    await expect(runSetupAlertEmailSweep(deps)).resolves.toEqual({ due: 1, sent: 0 });
    expect(mail.sendLifecycle).not.toHaveBeenCalled();
    expect(calls.some((c) => c.text.includes('SET "emailedAt"'))).toBe(false);
    expect(log).toHaveBeenCalledWith('log', '[setup-alert] dry-run user=u1 alert=alert-1');
  });

  it('ligada: marca antes de enviar (UPDATE condicional) e emite setup_alert_email_sent', async () => {
    const { deps, calls, mail, capture } = makeDeps({});
    await expect(runSetupAlertEmailSweep(deps)).resolves.toEqual({ due: 1, sent: 1 });
    const claim = calls.findIndex((c) => c.text.includes('SET "emailedAt" = ') && c.text.includes('"emailedAt" IS NULL'));
    expect(claim).toBeGreaterThan(-1);
    expect(mail.sendLifecycle).toHaveBeenCalledWith('u1@x.com', expect.objectContaining({ subject: 'Your XAUUSD setup reached 4,180' }));
    expect(capture).toHaveBeenCalledWith('clerk_1', 'setup_alert_email_sent', { alertId: 'alert-1', setupId: 'setup-aaaaaaaa', label: 'tp1' }, {
      dedupeKey: 'setup_alert_email_sent:alert-1',
    });
  });

  it('a Resend recusou: tira a marca para a proxima volta tentar de novo', async () => {
    const { deps, calls } = makeDeps({ sendOk: false });
    await expect(runSetupAlertEmailSweep(deps)).resolves.toEqual({ due: 1, sent: 0 });
    const undo = calls.find((c) => c.text.includes('SET "emailedAt" = NULL'));
    expect(undo?.values).toEqual(['alert-1', NOW]);
  });

  it('outra instancia ja marcou: nao envia', async () => {
    const { deps, mail } = makeDeps({ claimed: 0 });
    await expect(runSetupAlertEmailSweep(deps)).resolves.toMatchObject({ sent: 0 });
    expect(mail.sendLifecycle).not.toHaveBeenCalled();
  });

  it('limites: 1 por setup em 12h, 3 por pessoa em 24h, nunca para descadastrado', async () => {
    for (const opts of [{ setupRecent: 1 }, { personRecent: 3 }, { unsubscribed: true }]) {
      const { deps, mail } = makeDeps(opts);
      await expect(runSetupAlertEmailSweep(deps)).resolves.toEqual({ due: 0, sent: 0 });
      expect(mail.sendLifecycle).not.toHaveBeenCalled();
    }
    const { deps } = makeDeps({ personRecent: 2 });
    await expect(runSetupAlertEmailSweep(deps)).resolves.toEqual({ due: 1, sent: 1 });
  });

  it('rodape diz o tamanho real da vela: 1m em cripto, 5m em ouro e forex', () => {
    const render = (priceSymbol: string) =>
      renderSetupAlertEmail({ appUrl: 'https://tickrify.com', firstName: null, unsubscribeUrl: 'https://x', item: pending({ priceSymbol }) as any }).html;
    expect(render('BTCUSDT')).toContain('Checked on 1-minute candles');
    expect(render('XAUUSD')).toContain('Checked on 5-minute candles');
  });

  it('loga o atraso do cruzamento ao envio, tambem no dry-run', async () => {
    const on = makeDeps({});
    await runSetupAlertEmailSweep(on.deps);
    expect(on.log).toHaveBeenCalledWith('log', '[alerts] latency_ms=480000 alert=alert-1 symbol=XAUUSD sent=1');
    const off = makeDeps({ enabled: false });
    await runSetupAlertEmailSweep(off.deps);
    expect(off.log).toHaveBeenCalledWith('log', '[alerts] latency_ms=480000 alert=alert-1 symbol=XAUUSD dry_run=1');
  });

  it('janela: ligada olha 6h de disparos; dry-run so o gravado nos ultimos 5 min', async () => {
    const on = makeDeps({});
    await runSetupAlertEmailSweep(on.deps);
    expect(on.calls[0].values).toEqual([new Date(NOW.getTime() - 6 * 3600_000), NOW]);
    const off = makeDeps({ enabled: false });
    await runSetupAlertEmailSweep(off.deps);
    expect(off.calls[0].text).toContain('a."updatedAt" >');
    expect(off.calls[0].values).toEqual([new Date(NOW.getTime() - 5 * 60_000), NOW]);
    // Alerta automatico cujo WATCH venceu nunca vira e-mail.
    expect(on.calls[0].text).toContain('a."expiresAt" IS NULL OR a."expiresAt" >');
  });
});

describe('Watch que arma sozinho: e-mail', () => {
  const base = { appUrl: 'https://tickrify.com', firstName: null, unsubscribeUrl: 'https://x/u' };
  const armed = { status: 'armed' as const, direction: 'long' as const, entry: 4140, stop: 4095, target: 4180, checkedAt: '2026-10-27T13:42:00.000Z' };
  const item = (armCheck: unknown) => ({ ...pending({ label: 'entry', level: 4140 }), armCheck } as never);

  it('armado: assunto e texto com entrada, stop e alvo; termina com Your call', () => {
    const r = renderSetupAlertEmail({ ...base, item: item(armed) });
    expect(r.subject).toBe('Setup armed: XAUUSD buy at 4,140');
    expect(r.html).toContain('Setup armed: buy at 4,140, stop 4,095, target 4,180.');
    expect(r.html).toContain('This is not a signal to enter. Your call.');
  });

  it('invalidado: avisa que caiu e nao mostra plano', () => {
    const r = renderSetupAlertEmail({ ...base, item: item({ ...armed, status: 'invalidated', target: null }) });
    expect(r.subject).toBe('Setup invalidated: XAUUSD');
    expect(r.html).toContain('Setup invalidated: a candle closed below 4,095 before price reached 4,140.');
    expect(r.html).not.toContain('Setup armed');
  });

  it('sem conferencia ou alerta sem analise: texto de sempre', () => {
    expect(renderSetupAlertEmail({ ...base, item: item(null) }).subject).toBe('Your XAUUSD setup reached 4,140');
    const assets = renderSetupAlertEmail({ ...base, item: { ...pending({ setupId: null }), armCheck: null } as never });
    expect(assets.subject).toBe('XAUUSD reached 4,180');
  });

  it('a varredura nao envia alerta com conferencia pendente (rompimento sem fechamento)', async () => {
    const { prisma, calls } = makePrisma([['WHERE a."status" = \'triggered\'', () => []]], { adminAudit: { findFirst: jest.fn() } });
    await runSetupAlertEmailSweep({ prisma, mail: { sendLifecycle: jest.fn() }, isEnabled: () => true, appUrl: 'x', apiBaseUrl: 'y', now: () => NOW, log: jest.fn() });
    expect(calls[0].text).toContain(`COALESCE(a."armCheck"->>'status', '') <> 'pending'`);
  });
});
