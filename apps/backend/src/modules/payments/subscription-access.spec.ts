import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { PRICES } from '../../config/stripe.config';
import { StripeService } from './stripe.service';

jest.mock('../../common/analytics/posthog', () => ({ captureServer: jest.fn() }));
jest.mock('../../common/analytics/meta-capi', () => ({ sendMetaEvent: jest.fn() }));

describe('paid access after subscription reconciliation', () => {
  const NOW = new Date('2026-10-25T12:00:00Z');
  const START = new Date('2026-10-20T12:00:00Z');
  const END = new Date('2026-11-20T12:00:00Z');
  const WEEKLY = 'price_1UKeWPB1hl0IoocUjsQNv9BG';
  const MONTHLY = PRICES.starter.monthly.usd;
  let row: any;
  let prisma: any;
  let stripe: any;
  let ai: AiService;
  let balance: number;
  let ledger: Map<string, any>;
  let previousEnv: NodeJS.ProcessEnv;

  function live(overrides: Record<string, unknown> = {}) {
    return {
      id: 'sub_access_test', customer: 'cus_access_test', status: 'active',
      current_period_start: START.getTime() / 1000,
      current_period_end: END.getTime() / 1000,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: MONTHLY } }] },
      ...overrides,
    };
  }

  beforeEach(() => {
    previousEnv = { ...process.env };
    process.env.STRIPE_SECRET_KEY = 'sk_test_subscription_access_fixture';
    delete process.env.STRIPE_PORTAL_V2_CONFIG_ID;
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    for (const method of ['log', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
    balance = 17;
    ledger = new Map();
    row = {
      id: 'local_subscription', userId: 'user_test', stripeId: 'sub_access_test', status: 'active',
      priceId: MONTHLY, currentPeriodStart: START, currentPeriodEnd: new Date(NOW.getTime() - 1),
    };
    prisma = {
      subscription: {
        findFirst: jest.fn(async () => row && ['active', 'trialing'].includes(row.status) ? { ...row } : null),
        upsert: jest.fn(async ({ update }: any) => { row = { ...row, ...update }; return row; }),
        updateMany: jest.fn(async ({ data }: any) => { row = { ...row, ...data }; return { count: 1 }; }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_access_test' }) },
      userTicks: {
        findUnique: jest.fn(async () => ({ balance })),
        upsert: jest.fn(async ({ update }: any) => { balance = update.balance; }),
      },
      tickTransaction: {
        findUnique: jest.fn(async ({ where }: any) => ledger.get(where.stripePaymentIntentId) ?? null),
        create: jest.fn(async ({ data }: any) => { ledger.set(data.stripePaymentIntentId, data); }),
      },
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    stripe = { subscriptions: { retrieve: jest.fn().mockResolvedValue(live()), list: jest.fn().mockResolvedValue({ data: [] }) } };
    const billing = new StripeService(prisma, {} as any);
    (billing as any).stripe = stripe;
    // Real authorization and reconciliation; no lifecycle hooks, network or AI calls.
    ai = new AiService(prisma, {} as any, {} as any, billing, {} as any, {} as any, {} as any, {} as any);
  });

  afterEach(() => {
    process.env = previousEnv;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(['canceled', 'unpaid', 'past_due', 'incomplete', 'incomplete_expired', 'paused'])(
    'denies the same request that reconciles status %s, without changing credits', async status => {
      stripe.subscriptions.retrieve.mockResolvedValue(live({ status }));
      await expect(ai.hasPaidAccess('user_test')).resolves.toBe(false);
      expect(row.status).toBe(status);
      expect(balance).toBe(17);
      expect(prisma.tickTransaction.create).not.toHaveBeenCalled();
    });

  it('persists a missing Stripe subscription as canceled and denies this and later requests', async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(Object.assign(new Error('missing'), { code: 'resource_missing' }));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(false);
    expect(row.status).toBe('canceled');
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(false);
    expect(balance).toBe(17);
  });

  it.each(['active', 'trialing'])('allows renewed %s subscriptions and credits a window only once', async status => {
    stripe.subscriptions.retrieve.mockResolvedValue(live({ status }));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(balance).toBe(200);
    expect(prisma.tickTransaction.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
  });

  it('keeps scheduled cancellation accessible until the paid period expires', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(live({ cancel_at_period_end: true, canceled_at: NOW.getTime() / 1000 }));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    jest.setSystemTime(END);
    stripe.subscriptions.retrieve.mockResolvedValue(live({ status: 'canceled', cancel_at_period_end: true }));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(false);
    expect(prisma.tickTransaction.create).toHaveBeenCalledTimes(1);
  });

  it.each([null, new Date(NaN), new Date(NOW.getTime() - 1)])(
    'does not trust a missing, invalid or expired local period during a Stripe failure (%s)', async currentPeriodEnd => {
      row.currentPeriodEnd = currentPeriodEnd;
      stripe.subscriptions.retrieve.mockRejectedValue(new Error('temporary Stripe outage'));
      for (let i = 0; i < 3; i++) await expect(ai.hasPaidAccess('user_test')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(row.status).toBe('active'); // A temporary failure is not a cancellation.
      expect(balance).toBe(17);
      expect(prisma.tickTransaction.create).not.toHaveBeenCalled();
      stripe.subscriptions.retrieve.mockResolvedValue(live());
      await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    });

  it('uses an unexpired local period during a Stripe outage, but never extends it', async () => {
    row.currentPeriodEnd = END;
    stripe.subscriptions.retrieve.mockRejectedValue(new Error('temporary Stripe outage'));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    jest.setSystemTime(END);
    await expect(ai.hasPaidAccess('user_test')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.tickTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('does not equate an allowance database failure with loss of confirmed access', async () => {
    row.currentPeriodEnd = END;
    prisma.tickTransaction.findUnique.mockRejectedValue(new Error('allowance storage unavailable'));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(balance).toBe(17);
  });

  it('keeps an unexpired local period when only its start is missing and Stripe is unavailable', async () => {
    row.currentPeriodStart = null;
    row.currentPeriodEnd = END;
    stripe.subscriptions.retrieve.mockRejectedValue(new Error('temporary Stripe outage'));
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(balance).toBe(17);
    expect(prisma.tickTransaction.create).not.toHaveBeenCalled();
    jest.setSystemTime(END);
    await expect(ai.hasPaidAccess('user_test')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each(['canceled', 'resource_missing'])('cannot reuse a cached period if Stripe confirms %s and persistence fails', async status => {
    row.currentPeriodStart = null;
    row.currentPeriodEnd = END;
    if (status === 'resource_missing') {
      stripe.subscriptions.retrieve.mockRejectedValue(Object.assign(new Error('missing'), { code: status }));
      prisma.subscription.updateMany.mockRejectedValue(new Error('database unavailable'));
    } else {
      stripe.subscriptions.retrieve.mockResolvedValue(live({ status }));
      prisma.subscription.upsert.mockRejectedValue(new Error('database unavailable'));
    }
    await expect(ai.hasPaidAccess('user_test')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(balance).toBe(17);
  });

  it.each([undefined, 0, NOW.getTime() / 1000 - 1])(
    'does not grant or credit an active Stripe response without a future period (%s)', async current_period_end => {
      stripe.subscriptions.retrieve.mockResolvedValue(live({ current_period_end }));
      await expect(ai.hasPaidAccess('user_test')).resolves.toBe(false);
      expect(balance).toBe(17);
      expect(prisma.tickTransaction.create).not.toHaveBeenCalled();
    });

  it.each([
    ['weekly', WEEKLY, 25, '2026-10-22'],
    ['monthly', MONTHLY, 200, '2026-10-20'],
    ['yearly', PRICES.starter.yearly.usd, 200, '2026-10-20'],
  ])('preserves %s allowance amount, cadence and ledger key', async (_cycle, priceId, allowance, window) => {
    row.priceId = priceId;
    row.currentPeriodStart = new Date('2026-08-20T12:00:00Z');
    row.currentPeriodEnd = END;
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(balance).toBe(allowance);
    expect(ledger.has(`allowance:sub_access_test:${window}`)).toBe(true);
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(prisma.tickTransaction.create).toHaveBeenCalledTimes(1);
  });

  it('preserves manual access without consulting Stripe', async () => {
    row.stripeId = 'manual_owner_test';
    row.currentPeriodStart = null;
    row.currentPeriodEnd = null;
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(balance).toBe(200);
  });

  it('allows another current subscription when reconciliation ends the selected old one', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(live({ status: 'canceled' }));
    stripe.subscriptions.list.mockResolvedValue({ data: [live({ id: 'sub_replacement_test' })] });
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(true);
    expect(ledger.has('allowance:sub_replacement_test:2026-10-20')).toBe(true);
    expect(ledger.has('allowance:sub_access_test:2026-10-20')).toBe(false);
  });

  it.each(['canceled', 'active'])('lazy sync cannot bypass an ended period with status %s', async status => {
    row = null;
    stripe.subscriptions.list.mockResolvedValue({ data: [live({ status, current_period_end: NOW.getTime() / 1000 - 1 })] });
    await expect(ai.hasPaidAccess('user_test')).resolves.toBe(false);
    expect(prisma.tickTransaction.create).not.toHaveBeenCalled();
    expect(balance).toBe(17);
  });
});
