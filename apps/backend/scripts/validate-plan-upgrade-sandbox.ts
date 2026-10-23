/** Explicit opt-in integration runner. Real Stripe TEST API + throwaway localhost DB only.
 * Run setup, open the returned test portal sessions, then run verify. No live fallback.
 */
import 'reflect-metadata';
import assert = require('node:assert/strict');
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import Stripe from 'stripe';
import { PrismaService } from '../src/modules/database/prisma.service';
import { AffiliatesService } from '../src/modules/affiliates/affiliates.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { portalV2Configuration } from '../src/config/stripe.config';

type Scenario = { userId: string; clerkId: string; customer: string; subscription: string; item: string; portalUrl: string; beforeBalance: number };
type State = { run: string; since: number; product: string; weekly: string; monthly: string; config: string; success: Scenario; declined: Scenario };
const command = process.argv[2];
const directory = process.argv[3];
assert(directory?.startsWith('/tmp/tickrify-upgrade-sandbox.'), 'Evidence directory must be the disposable sandbox directory.');
const localUrl = 'postgresql://tickrify_test@127.0.0.1:55439/tickrify_upgrade_test?sslmode=disable';
const key = parse(readFileSync(resolve(__dirname, '../.env'))).STRIPE_SECRET_KEY?.trim();
assert(key && /^(sk|rk)_test_/.test(key), 'TEST secret key required.');
// Never import the rest of .env or connect with its remote database URLs.
process.env.STRIPE_SECRET_KEY = key;
process.env.DATABASE_URL = localUrl;
process.env.DIRECT_URL = localUrl;
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.STRIPE_UPGRADE_ENABLED = 'true';
delete process.env.POSTHOG_KEY;
delete process.env.META_ACCESS_TOKEN;
const stripe = new Stripe(key, { apiVersion: '2023-10-16', maxNetworkRetries: 0 });
const db = new PrismaService();
const service = new StripeService(db, new AffiliatesService(db));
function testObject<T extends { livemode: boolean }>(value: T): T { assert.equal(value.livemode, false); return value; }
function save(file: string, value: unknown) { writeFileSync(resolve(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 }); }
function configure(state: Pick<State, 'product' | 'weekly' | 'monthly' | 'config'>) {
  process.env.STRIPE_TEST_PRODUCT_ID = state.product;
  process.env.STRIPE_TEST_PRICE_WEEKLY = state.weekly;
  process.env.STRIPE_TEST_PRICE_MONTHLY = state.monthly;
  process.env.STRIPE_PORTAL_V2_CONFIG_ID = state.config;
}
async function setup() {
  const run = randomUUID();
  const since = Math.floor(Date.now() / 1000);
  const checkpoints: unknown[] = [];
  const checkpoint = (value: unknown) => { checkpoints.push(value); save('setup-checkpoints.json', checkpoints); };
  const metadata = { tickrify_sandbox_run: run };
  const product = testObject(await stripe.products.create({ name: `Tickrify upgrade sandbox ${run}`, metadata }));
  const weekly = testObject(await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: 799, recurring: { interval: 'week' }, metadata }));
  const monthly = testObject(await stripe.prices.create({ product: product.id, currency: 'usd', unit_amount: 2900, recurring: { interval: 'month' }, metadata }));
  configure({ product: product.id, weekly: weekly.id, monthly: monthly.id, config: '' });
  const config = testObject(await stripe.billingPortal.configurations.create(portalV2Configuration(process.env.APP_URL!)));
  checkpoint({ run, since, product: product.id, weekly: weekly.id, monthly: monthly.id, config: config.id });
  configure({ product: product.id, weekly: weekly.id, monthly: monthly.id, config: config.id });
  async function scenario(label: string, decline: boolean): Promise<Scenario> {
    const customer = testObject(await stripe.customers.create({ name: `Synthetic ${label}`, metadata }));
    const card = testObject(await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id }));
    const user = await db.user.create({ data: { clerkUserId: `sandbox_${run}_${label}`, stripeCustomerId: customer.id } });
    const sub = testObject(await stripe.subscriptions.create({ customer: customer.id, items: [{ price: weekly.id, quantity: 1 }], default_payment_method: card.id,
      payment_behavior: 'error_if_incomplete', metadata: { ...metadata, userId: user.id, clerkUserId: user.clerkUserId } }));
    assert.equal(sub.status, 'active'); assert.equal(sub.items.data.length, 1);
    assert.equal(await service.syncActiveSubscriptionFromStripe(user.id, customer.id), true);
    assert.equal((await db.userTicks.findUniqueOrThrow({ where: { userId: user.id } })).balance, 25);
    // Model already-used benefits. Refusal must preserve the 18 remaining, not reset to 25 or 200.
    const beforeBalance = decline ? 18 : 25;
    if (decline) {
      await db.userTicks.update({ where: { userId: user.id }, data: { balance: beforeBalance } });
      const bad = testObject(await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: customer.id }));
      await stripe.subscriptions.update(sub.id, { default_payment_method: bad.id });
    }
    process.env.STRIPE_UPGRADE_USER_IDS = user.id;
    checkpoint({ label, userId: user.id, clerkId: user.clerkUserId, customer: customer.id, subscription: sub.id, item: sub.items.data[0].id, beforeBalance });
    const portal = await service.createCustomerPortal(user.clerkUserId, true);
    return { userId: user.id, clerkId: user.clerkUserId, customer: customer.id, subscription: sub.id, item: sub.items.data[0].id, portalUrl: portal.url, beforeBalance };
  }
  const success = await scenario('success', false);
  const declined = await scenario('declined', true);
  const state: State = { run, since, product: product.id, weekly: weekly.id, monthly: monthly.id, config: config.id, success, declined };
  save('state.json', state);
  console.log(JSON.stringify({ setup: 'test-only', run, product: product.id, weekly: weekly.id, monthly: monthly.id, config: config.id, account: 'acct_1RgwA6PeLxbYL5mv', database: '127.0.0.1:55439/tickrify_upgrade_test', evidence: resolve(directory, 'state.json') }));
}
async function resume() {
  const checkpoints = JSON.parse(readFileSync(resolve(directory, 'setup-checkpoints.json'), 'utf8'));
  const seed: Pick<State, 'run' | 'since' | 'product' | 'weekly' | 'monthly' | 'config'> = checkpoints[0];
  configure(seed);
  const scenarios: Scenario[] = [];
  for (const label of ['success', 'declined']) {
    const clerkId = `sandbox_${seed.run}_${label}`;
    const user = await db.user.findUniqueOrThrow({ where: { clerkUserId: clerkId } });
    const record = await db.subscription.findFirstOrThrow({ where: { userId: user.id } });
    const sub = testObject(await stripe.subscriptions.retrieve(record.stripeId));
    assert.equal(sub.items.data[0].price.id, seed.weekly);
    assert(user.stripeCustomerId);
    if (label === 'declined') {
      const bad = testObject(await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: user.stripeCustomerId }));
      await stripe.subscriptions.update(sub.id, { default_payment_method: bad.id });
    }
    process.env.STRIPE_UPGRADE_USER_IDS = user.id;
    const portal = await service.createCustomerPortal(clerkId, true);
    scenarios.push({ userId: user.id, clerkId, customer: user.stripeCustomerId, subscription: sub.id, item: sub.items.data[0].id,
      beforeBalance: (await db.userTicks.findUniqueOrThrow({ where: { userId: user.id } })).balance, portalUrl: portal.url });
  }
  save('state.json', { ...seed, success: scenarios[0], declined: scenarios[1] });
  console.log('Two existing synthetic test scenarios prepared; no replacement subscriptions created.');
}
async function verify() {
  const state: State = JSON.parse(readFileSync(resolve(directory, 'state.json'), 'utf8'));
  configure(state);
  process.env.STRIPE_UPGRADE_USER_IDS = `${state.success.userId},${state.declined.userId}`;
  const localSecret = `whsec_local_${state.run}`;
  process.env.STRIPE_WEBHOOK_SECRET = localSecret;
  const relevant: Stripe.Event[] = [];
  for await (const event of stripe.events.list({ created: { gte: state.since }, limit: 100 })) {
    testObject(event);
    if ([state.success.subscription, state.declined.subscription].some(id => JSON.stringify(event.data.object).includes(id)) &&
        ['customer.subscription.created', 'customer.subscription.updated', 'invoice.payment_succeeded', 'invoice.payment_failed'].includes(event.type)) relevant.push(event);
  }
  assert(relevant.length > 0, 'No real Stripe events found.');
  // Deliver real Stripe event bodies in reverse order, with duplicates and valid local HMAC.
  let duplicates = 0;
  for (const event of relevant) {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: localSecret });
    await service.handleWebhookEvent(signature, Buffer.from(payload));
    const duplicate = await service.handleWebhookEvent(signature, Buffer.from(payload));
    if ('duplicate' in duplicate && duplicate.duplicate) duplicates++;
  }
  const results = [];
  for (const [label, scenario] of Object.entries({ success: state.success, declined: state.declined })) {
    const sub = testObject(await stripe.subscriptions.retrieve(scenario.subscription));
    const invoiceId = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
    assert(invoiceId);
    const invoice = testObject(await stripe.invoices.retrieve(invoiceId));
    const view = await service.getUserSubscription(scenario.clerkId);
    const record = await db.subscription.findUniqueOrThrow({ where: { stripeId: sub.id } });
    await service.ensureTicksForActiveSubscriber(scenario.userId, record);
    const balance = (await db.userTicks.findUniqueOrThrow({ where: { userId: scenario.userId } })).balance;
    assert.equal(sub.items.data.length, 1); assert.equal(sub.items.data[0].id, scenario.item); assert.equal(sub.items.data[0].quantity, 1);
    assert.equal((await stripe.subscriptions.list({ customer: scenario.customer, status: 'all' })).data.length, 1);
    assert.equal(sub.status, 'active'); assert.equal(record.status, 'active');
    if (label === 'success') {
      assert.equal(sub.items.data[0].price.id, state.monthly); assert.equal(invoice.status, 'paid');
      assert.equal(invoice.billing_reason, 'subscription_update'); assert.equal(balance, 200);
      assert.equal(view?.canChangePlans, false, 'Monthly subscriber cannot downgrade.');
    } else {
      assert.equal(sub.items.data[0].price.id, state.weekly); assert.equal(balance, scenario.beforeBalance);
      assert.equal(invoice.status, 'open'); assert.equal(invoice.amount_paid, 0);
      assert.equal(invoice.billing_reason, 'subscription_update'); assert(sub.pending_update);
      const originalPaid = await stripe.invoices.list({ customer: scenario.customer, status: 'paid', limit: 10 });
      const originalWeeklyLine = originalPaid.data.flatMap(paid => paid.lines.data).find(line => line.price?.id === state.weekly && !line.proration);
      assert(originalWeeklyLine); assert.equal(sub.current_period_end, originalWeeklyLine.period.end, 'Already-paid weekly access must not end early.');
    }
    const cycleResets = await db.tickTransaction.count({ where: { userId: scenario.userId, stripePaymentIntentId: { startsWith: `allowance-cycle:${sub.id}:` } } });
    assert.equal(cycleResets, label === 'success' ? 1 : 0);
    results.push({ cycleResets, scenario: label, subscription: sub.id, item: sub.items.data[0].id, status: sub.status, price: sub.items.data[0].price.id, balance, pendingPayment: Boolean(sub.pending_update), accessPaidThrough: sub.current_period_end, itemCount: sub.items.data.length, invoice: {
      id: invoice.id, status: invoice.status, reason: invoice.billing_reason, amount_due: invoice.amount_due, amount_paid: invoice.amount_paid, currency: invoice.currency,
      lines: invoice.lines.data.map(line => ({ amount: line.amount, proration: line.proration, price: line.price?.id, period: line.period })),
    } });
  }
  const report = { account: 'acct_1RgwA6PeLxbYL5mv', mode: 'test', events: relevant.length, duplicateDeliveriesIgnored: duplicates, results };
  save('results.json', report); console.log(JSON.stringify(report, null, 2));
}
(async () => {
  assert.equal((await stripe.accounts.retrieve()).id, 'acct_1RgwA6PeLxbYL5mv');
  await db.$connect();
  const target = await db.$queryRaw<Array<{ db: string; host: string; port: number }>>`SELECT current_database()::text AS db, inet_server_addr()::text AS host, inet_server_port() AS port`;
  assert.deepEqual(target, [{ db: 'tickrify_upgrade_test', host: '127.0.0.1/32', port: 55439 }]);
  await service.onModuleInit();
  if (command === 'setup') await setup();
  else if (command === 'resume') await resume();
  else if (command === 'verify') await verify();
  else throw new Error('Use setup or verify.');
})().catch(error => { console.error(error instanceof Error ? error.message : 'Sandbox failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
