import { TRIAL_RULES, computeTrialState, nextTrialAvailability, isDisposableEmail, localDate, validTimezone, type TrialRow } from './trial';
import { getFreeQuota } from './free-quota';
import { runLifecycleSweep, renderLifecycleEmail, type TrialEmailInput } from '../modules/mail/lifecycle-email';

const START = new Date('2026-10-20T12:00:00Z');
const H = 60 * 60 * 1000;

const row = (over: Partial<TrialRow> = {}): TrialRow => ({
  userId: 'u1',
  startedAt: START,
  timezone: 'America/Sao_Paulo',
  status: 'active',
  endedAt: null,
  endReason: null,
  convertedAt: null,
  dayAtConversion: null,
  usageDays: [],
  analysesToday: 0,
  todayDate: null,
  source: 'signup',
  denyReason: null,
  ...over,
});
const done = (iso: string) => ({ createdAt: new Date(iso), status: 'completed' });

describe('regras do trial de 3 dias', () => {
  it.each([
    ['America/Sao_Paulo', '2026-10-20T23:00:00Z', '2026-10-21T03:00:00Z'],
    ['Asia/Kolkata', '2026-10-20T15:00:00Z', '2026-10-20T18:30:00Z'],
    ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-02T05:00:00Z'],
  ])('disponibilidade informativa respeita a virada local em %s, inclusive horario de verao', (timezone, instant, expected) => {
    const now = new Date(instant);
    const state = computeTrialState(row({ timezone, startedAt: now }), Array.from({ length: 3 }, () => done(instant)), now);
    expect(nextTrialAvailability(state, now)?.toISOString()).toBe(new Date(expected).toISOString());
  });

  it('nao promete cota amanha quando a janela vence antes, nem apos encerramento', () => {
    const now = new Date('2026-10-27T11:00:00Z');
    const state = computeTrialState(row(), Array.from({ length: 3 }, () => done(now.toISOString())), now);
    expect(state.paywall).toBe('daily_limit');
    expect(nextTrialAvailability(state, now)).toBeNull();
    expect(nextTrialAvailability({ ...state, status: 'ended' }, now)).toBeNull();
    expect(nextTrialAvailability({ ...state, paywall: null }, now)).toBeNull();
  });
  it('dia 1 tem 3 analises; a 3a esgota o dia e pede para voltar amanha', () => {
    const now = new Date('2026-10-20T20:00:00Z');
    expect(computeTrialState(row(), [], now)).toMatchObject({ dayIndex: 1, limitToday: 3, remainingToday: 3, blocked: false, paywall: null });
    const three = [done('2026-10-20T13:00:00Z'), done('2026-10-20T14:00:00Z'), done('2026-10-20T15:00:00Z')];
    expect(computeTrialState(row(), three, now)).toMatchObject({
      dayIndex: 1, usedToday: 3, remainingToday: 0, blocked: true, paywall: 'daily_limit', status: 'active', endedSettled: false,
    });
  });

  it('dia 2 e dia 3 tem 2; esgotar o dia 3 encerra (completed) e trava a conta', () => {
    const a = [
      done('2026-10-20T13:00:00Z'),
      done('2026-10-21T13:00:00Z'), done('2026-10-21T14:00:00Z'),
      done('2026-10-22T13:00:00Z'),
    ];
    const day3 = new Date('2026-10-22T15:00:00Z');
    expect(computeTrialState(row(), a, day3)).toMatchObject({ dayIndex: 3, limitToday: 2, remainingToday: 1, blocked: false });
    const ended = computeTrialState(row(), [...a, done('2026-10-22T14:00:00Z')], day3);
    expect(ended).toMatchObject({ status: 'ended', endReason: 'completed', paywall: 'day3_quota', endedSettled: true, daysUsed: 3 });
  });

  it('comecar um 4o dia de uso encerra, mesmo com cota sobrando no 3o', () => {
    const a = [done('2026-10-20T13:00:00Z'), done('2026-10-21T13:00:00Z'), done('2026-10-22T13:00:00Z')];
    expect(computeTrialState(row(), a, new Date('2026-10-23T13:00:00Z'))).toMatchObject({
      status: 'ended', endReason: 'completed', paywall: 'fourth_day', remainingToday: 0,
    });
  });

  it('7 dias depois do inicio encerra (expired), usado ou nao', () => {
    const now = new Date(START.getTime() + TRIAL_RULES.windowDays * 24 * H);
    expect(computeTrialState(row(), [done('2026-10-20T13:00:00Z')], now)).toMatchObject({
      status: 'ended', endReason: 'expired', paywall: 'expired', endedSettled: true,
    });
  });

  it('dia e o do calendario no FUSO da pessoa (fallback UTC)', () => {
    // 02:00 UTC do dia 21 ainda e dia 20 em Sao Paulo (UTC-3).
    const late = [done('2026-10-20T13:00:00Z'), done('2026-10-21T02:00:00Z')];
    const now = new Date('2026-10-21T02:30:00Z');
    expect(computeTrialState(row(), late, now)).toMatchObject({ dayIndex: 1, usedToday: 2 });
    expect(computeTrialState(row({ timezone: null }), late, now)).toMatchObject({ dayIndex: 2, usedToday: 1, timezone: 'UTC' });
    expect(localDate(new Date('2026-10-21T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-10-20');
    expect(validTimezone('Not/AZone')).toBeNull();
    expect(validTimezone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falha nao conta; analise em andamento bloqueia mas nao encerra', () => {
    const now = new Date('2026-10-20T20:00:00Z');
    const a = [
      done('2026-10-20T13:00:00Z'), done('2026-10-20T14:00:00Z'),
      { createdAt: new Date('2026-10-20T15:00:00Z'), status: 'failed' },
    ];
    expect(computeTrialState(row(), a, now).remainingToday).toBe(1);
    const inFlight = [...a, { createdAt: new Date('2026-10-20T19:59:00Z'), status: 'processing' }];
    expect(computeTrialState(row(), inFlight, now)).toMatchObject({ blocked: true, endedSettled: false, paywall: 'daily_limit' });
  });

  it('encerrado no banco continua encerrado', () => {
    const s = computeTrialState(row({ status: 'ended_unconverted', endReason: 'expired', endedAt: START }), [], START);
    expect(s).toMatchObject({ status: 'ended', endedSettled: true, blocked: true, paywall: 'expired' });
  });

  it('e-mail descartavel e barrado, o resto passa', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@inbox.mailinator.com')).toBe(true);
    expect(isDisposableEmail('trader@gmail.com')).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
  });
});

describe('cota gratis com trial', () => {
  const quotaDb = (trial: Record<string, unknown> | null, analyses: Array<{ createdAt: Date; status: string }>) => ({
    user: { findUnique: async () => ({ freeQuotaResetAt: null }) },
    analysis: { count: async () => 99, findMany: async () => analyses },
    $queryRawUnsafe: async (sql: string) =>
      sql.includes('to_regclass') ? [{ ok: true }] : sql.includes('"UserTrial"') && trial ? [trial] : [],
  });

  it('sem linha de trial: regra antiga (3 planos), sem mudar nada', async () => {
    const q = await getFreeQuota(quotaDb(null, []) as any, 'u1');
    expect(q.trial).toBeNull();
    expect(q.signalsLimit).toBe(3);
  });

  it('com trial: mesmo formato, cota do dia e trava so quando encerra', async () => {
    const trial = { userId: 'u1', startedAt: new Date(Date.now() - H), timezone: 'UTC', status: 'active', usageDays: [], source: 'signup' };
    const q = await getFreeQuota(quotaDb(trial, [{ createdAt: new Date(), status: 'completed' }]) as any, 'u1');
    expect(q).toMatchObject({ signalsUsed: 1, signalsLimit: 3, remaining: 2, exhausted: false, settledExhausted: false });
    expect(q.trial?.dayIndex).toBe(1);
  });
});

describe('e-mails do trial (modo simulado)', () => {
  const now = new Date('2026-10-21T12:00:00Z'); // 09:00 em Sao Paulo
  const input = (over: Partial<TrialEmailInput> & { userId: string }, analyses: Array<{ createdAt: Date; status: string }>, r: Partial<TrialRow> = {}): TrialEmailInput => {
    const tr = row({ userId: over.userId, ...r });
    return {
      row: tr,
      state: computeTrialState(tr, analyses, now),
      email: `${over.userId}@example.com`,
      name: null,
      lastAnalysisAt: analyses.length ? analyses[analyses.length - 1].createdAt : null,
      ...over,
    };
  };

  it('mostra quem receberia qual mensagem, sem enviar nem gravar', async () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET ??= 'test-secret';
    const trials: TrialEmailInput[] = [
      // Cadastrou ha 4h e nao analisou.
      input({ userId: 'first' }, [], { startedAt: new Date(now.getTime() - 4 * H) }),
      // Fez o dia 1 ontem (22h atras) e nao voltou; agora sao 9h no fuso dele.
      input({ userId: 'day2' }, [done('2026-10-20T14:00:00Z')], { startedAt: new Date('2026-10-20T13:00:00Z') }),
      // Encerrou sem assinar ha 2h.
      input({ userId: 'ended' }, [], { status: 'ended_unconverted', endReason: 'expired', endedAt: new Date(now.getTime() - 2 * H) }),
      // Encerrou ha 10 dias e meio.
      input({ userId: 'w10' }, [], { status: 'ended_unconverted', endReason: 'completed', endedAt: new Date(now.getTime() - 10.5 * 24 * H) }),
    ];
    const logs: string[] = [];
    const send = jest.fn();
    const create = jest.fn();
    const counts = await runLifecycleSweep({
      prisma: {
        user: { findMany: async () => [] },
        adminAudit: { findFirst: async () => null, findMany: async () => [], create, delete: jest.fn() },
        subscription: { findFirst: async () => null },
      } as any,
      loadTrials: async () => trials,
      hasTrial: async () => true,
      mail: { sendLifecycle: send },
      isEnabled: () => false,
      appUrl: 'https://tickrify.com',
      apiBaseUrl: 'https://api.example.com',
      now: () => now,
      log: (_level, message) => logs.push(message),
    });
    expect(counts).toMatchObject({ trial_first_analysis: 1, trial_day2: 1, trial_ended: 1, trial_winback_10: 1, trial_last_day: 0 });
    expect(logs).toEqual(expect.arrayContaining([
      '[lifecycle] dry-run kind=trial_first_analysis user=first',
      '[lifecycle] dry-run kind=trial_day2 user=day2',
      '[lifecycle] dry-run kind=trial_ended user=ended',
      '[lifecycle] dry-run kind=trial_winback_10 user=w10',
    ]));
    expect(send).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('dia 2 com operacao aberta: o gancho vira acompanhar o trade', () => {
    const email = renderLifecycleEmail('trial_day2', {
      appUrl: 'https://tickrify.com',
      unsubscribeUrl: 'https://x/u',
      openTradeSymbol: 'XAUUSD',
    });
    expect(email.subject).toBe('Your XAUUSD trade is still open');
    expect(email.html).toContain('Check how it is doing.');
    expect(renderLifecycleEmail('trial_day2', { appUrl: 'https://tickrify.com', unsubscribeUrl: 'https://x/u' }).subject).toBe(
      "Yesterday's chart has moved since",
    );
  });

  it('textos sem emoji e sem travessao, com descadastro', () => {
    for (const kind of ['trial_first_analysis', 'trial_day2', 'trial_last_day', 'trial_ended', 'trial_ended_followup', 'trial_winback_5', 'trial_winback_10'] as const) {
      const email = renderLifecycleEmail(kind, { appUrl: 'https://tickrify.com', unsubscribeUrl: 'https://x/u' });
      expect(email.subject + email.html).not.toMatch(/[–—]|\p{Extended_Pictographic}/u);
      expect(email.html).toContain('https://x/u');
    }
  });
});
