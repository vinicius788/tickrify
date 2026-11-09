import { makeRawSqlPrisma as makePrisma } from '../../__tests__/raw-sql-mock';
import { formatLevel, renderSetupAlertEmail, runSetupAlertEmailSweep, setupAlertLink } from './setup-alert-email';
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

  it('texto: assunto com ativo e nivel, rotulo, hora UTC, aviso de que nao e sinal, link de atualizar com utm e assinatura', () => {
    const email = renderSetupAlertEmail({
      appUrl: 'https://tickrify.com',
      firstName: 'Joao',
      item: pending() as any,
      unsubscribeUrl: 'https://api.tickrify.com/api/email/unsubscribe?u=u1&t=x',
    });
    expect(email.subject).toBe('Your XAUUSD setup reached 4,180');
    expect(email.kind).toBe('setup_alert');
    expect(email.html).toContain('Target 1');
    expect(email.html).toContain('13:42 UTC on Oct 27');
    expect(email.html).toContain('Update the chart to review it. This is not a signal to enter.');
    expect(email.html).toContain(
      'https://tickrify.com/dashboard/new?setup=setup-aaaaaaaa&amp;alert=alert-1&amp;utm_source=email&amp;utm_campaign=setup_alert',
    );
    expect(email.html).toContain('Vinícius');
    expect(email.html).not.toMatch(/\bVini\b/);
    expect(email.html).not.toContain('—');
    expect(email.html).toContain('Unsubscribe');
  });

  it('niveis formatados sem perder casas de forex', () => {
    expect(formatLevel(4180)).toBe('4,180');
    expect(formatLevel(1.0952)).toBe('1.0952');
    expect(formatLevel(0.00001234)).toBe('0.00001234');
    expect(setupAlertLink('https://tickrify.com/', { setupId: 's1', alertId: 'a1' })).toBe(
      'https://tickrify.com/dashboard/new?setup=s1&alert=a1&utm_source=email&utm_campaign=setup_alert',
    );
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
