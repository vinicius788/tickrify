#!/usr/bin/env node
// Validacao E2E do pagamento em ambiente ISOLADO (substitui o runner local da
// Codex, que ficou so no _local do Mac, e o e2e-staging.mjs de marco).
//
// Fluxo: usuario de teste no Clerk DEVELOPMENT -> token -> backend local ->
// checkout Stripe TEST -> pagamento com o cartao 4242 na pagina real do
// Checkout -> eventos reais entregues pela Stripe CLI (`stripe listen`) ->
// assinatura ativa -> 200 ticks pelo webhook -> /api/ai/usage = starter ->
// reentrega do mesmo evento ignorada.
//
// Nada fora deste processo e escrito: banco e Redis sao descartaveis em pasta
// temporaria, as chaves precisam ser de TESTE (o runner aborta com qualquer
// `*_live_*`), PostHog/Meta/Resend/OpenAI ficam sem chave. Os price IDs live
// do stripe.config.ts sao trocados pelos de teste SO na memoria do backend
// local (preload), sem mudar uma linha do codigo de producao.
//
//   node scripts/e2e-payment.mjs --offline   infra local, travas e webhook, sem rede
//   node scripts/e2e-payment.mjs             fluxo completo
//
// Variaveis (todas de TESTE):
//   E2E_STRIPE_SECRET_KEY   sk_test_/rk_test_ (aceita STRIPE_TEST_SECRET_KEY)
//   E2E_CLERK_SECRET_KEY    sk_test_ da instancia development (aceita CLERK_TEST_SECRET_KEY)
//   E2E_STRIPE_PRICE_MONTHLY / _YEARLY / _WEEKLY   opcionais; sem eles o runner
//                           procura no modo teste US$ 29/mes, 290/ano e 7,99/semana
//   E2E_STRIPE_CLI          caminho da Stripe CLI (padrao: `stripe` no PATH)
//   E2E_KEEP=1              nao apaga banco/usuario/assinatura no fim (depuracao)

import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'apps/backend');
const OFFLINE = process.argv.includes('--offline');
const KEEP = process.env.E2E_KEEP === '1';
const PG_BIN = process.env.E2E_PG_BIN || '/usr/lib/postgresql/16/bin';
const PG_PORT = Number(process.env.E2E_PG_PORT || 55432 + Math.floor(Math.random() * 500));
const REDIS_PORT = Number(process.env.E2E_REDIS_PORT || 56379 + Math.floor(Math.random() * 500));
const API_PORT = Number(process.env.E2E_API_PORT || 38000 + Math.floor(Math.random() * 500));
const API = `http://127.0.0.1:${API_PORT}`;
const DB_URL = `postgresql://tk@127.0.0.1:${PG_PORT}/tickrify_e2e?schema=tickrify&sslmode=disable`;

const results = [];
const cleanups = [];
let failed = false;

const log = (msg) => console.log(`[e2e-payment] ${msg}`);
function step(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
  return ok;
}
function must(name, ok, detail) {
  if (!step(name, ok, detail)) throw new Error(`etapa obrigatoria falhou: ${name}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Nunca imprime segredo: so o prefixo. */
const mask = (v) => (v ? `${String(v).slice(0, 8)}…` : '(vazio)');

// ── 0. Travas: so TESTE, so local ────────────────────────────────────────────
const stripeKey = String(process.env.E2E_STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY || '').trim();
const clerkKey = String(process.env.E2E_CLERK_SECRET_KEY || process.env.CLERK_TEST_SECRET_KEY || '').trim();

function guards() {
  const liveVars = Object.entries(process.env)
    .filter(([, v]) => /\b(sk|rk|pk)_live_/.test(String(v)))
    .map(([k]) => k);
  must('nenhuma chave live no ambiente do runner', liveVars.length === 0, liveVars.join(', ') || 'ok');
  must('NODE_ENV nao e production', process.env.NODE_ENV !== 'production');
  if (OFFLINE) return;
  must('chave Stripe e de TESTE', /^(sk|rk)_test_/.test(stripeKey), mask(stripeKey));
  must('chave Clerk e de DEVELOPMENT', /^sk_test_/.test(clerkKey), mask(clerkKey));
}

// ── Utilidades de processo ───────────────────────────────────────────────────
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}\n${r.stderr || r.stdout}`);
  return r.stdout;
}
function startBg(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  cleanups.push(() => child.kill('SIGTERM'));
  return { child, output: () => out };
}
function psql(sql) {
  return run('psql', ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'tk', '-d', 'tickrify_e2e', '-At', '-F', '|', '-c', sql], {
    env: { ...process.env, PGOPTIONS: '-c search_path=tickrify' },
  }).trim();
}

// ── 1. Infra descartavel ─────────────────────────────────────────────────────
function startInfra() {
  // Pasta propria com dono postgres: o initdb recusa root e precisa atravessar o caminho.
  const pgDir = mkdtempSync(path.join(tmpdir(), 'tk-e2e-'));
  const asRoot = process.getuid?.() === 0;
  const pgUser = asRoot ? 'postgres' : null;
  if (asRoot) {
    const uid = Number(run('id', ['-u', 'postgres']).trim());
    chownSync(pgDir, uid, Number(run('id', ['-g', 'postgres']).trim()));
  }
  const asPg = (cmd) => (pgUser ? run('su', [pgUser, '-c', cmd]) : run('sh', ['-c', cmd]));
  asPg(`${PG_BIN}/initdb -D ${pgDir}/data -U tk --auth=trust >/dev/null`);
  asPg(`${PG_BIN}/pg_ctl -D ${pgDir}/data -o "-p ${PG_PORT} -k ${pgDir} -c listen_addresses=127.0.0.1" -l ${pgDir}/pg.log -w start >/dev/null`);
  cleanups.push(() => {
    try { asPg(`${PG_BIN}/pg_ctl -D ${pgDir}/data -m fast stop >/dev/null`); } catch { /* ja parado */ }
    if (!KEEP) rmSync(pgDir, { recursive: true, force: true });
  });
  run('psql', ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'tk', '-d', 'postgres', '-c', 'create database tickrify_e2e']);

  run('redis-server', ['--port', String(REDIS_PORT), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--daemonize', 'yes']);
  cleanups.push(() => spawnSync('redis-cli', ['-p', String(REDIS_PORT), 'shutdown', 'nosave']));

  run(path.join(BACKEND, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--config', './prisma.config.ts'], {
    cwd: BACKEND,
    env: { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL, MIGRATIONS_DATABASE_URL: DB_URL },
  });
  step('banco e Redis descartaveis no ar, migracoes aplicadas', true, `pg :${PG_PORT}, redis :${REDIS_PORT}`);
  return pgDir;
}

// ── 2. Precos de teste (troca em memoria no backend local) ───────────────────
async function stripeApi(method, pathname, form) {
  const res = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${stripeKey}`,
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe ${method} ${pathname}: ${json?.error?.message || res.status}`);
  return json;
}

async function resolveTestPrices() {
  const wanted = {
    monthly: { env: 'E2E_STRIPE_PRICE_MONTHLY', amount: 2900, interval: 'month' },
    yearly: { env: 'E2E_STRIPE_PRICE_YEARLY', amount: 29000, interval: 'year' },
    weekly: { env: 'E2E_STRIPE_PRICE_WEEKLY', amount: 799, interval: 'week' },
  };
  const list = (await stripeApi('GET', '/prices?active=true&type=recurring&limit=100')).data;
  const out = {};
  for (const [cycle, w] of Object.entries(wanted)) {
    const fromEnv = String(process.env[w.env] || '').trim();
    const price = fromEnv
      ? await stripeApi('GET', `/prices/${fromEnv}`)
      : list.find((p) => p.currency === 'usd' && p.unit_amount === w.amount &&
          p.recurring?.interval === w.interval && (p.recurring?.interval_count ?? 1) === 1);
    if (!price) { out[cycle] = null; continue; }
    must(`preco ${cycle} de teste e utilizavel`, price.livemode === false && price.active && price.currency === 'usd' &&
      price.unit_amount === w.amount && price.recurring?.interval === w.interval, price.id);
    out[cycle] = price.id;
  }
  must('preco mensal de teste encontrado (obrigatorio para o fluxo)', Boolean(out.monthly), out.monthly || 'ausente');
  return out;
}

function writePreload(dir, prices) {
  const file = path.join(dir, 'test-prices.cjs');
  const cfg = path.join(BACKEND, 'dist/src/config/stripe.config.js');
  // So roda no processo local do teste. Recusa chave live por garantia.
  writeFileSync(file, `
if (!/^(sk|rk)_test_/.test(String(process.env.STRIPE_SECRET_KEY || ''))) {
  throw new Error('[e2e preload] STRIPE_SECRET_KEY nao e de teste; abortando.');
}
const cfg = require(${JSON.stringify(cfg)});
const p = ${JSON.stringify(prices)};
if (p.monthly) cfg.PRICES.starter.monthly.usd = p.monthly;
if (p.yearly) cfg.PRICES.starter.yearly.usd = p.yearly;
if (p.weekly) cfg.WEEKLY_PRICE_ID = p.weekly;
console.log('[e2e preload] precos de teste ativos:', JSON.stringify(p));
`);
  return file;
}

// ── 3. Backend local ─────────────────────────────────────────────────────────
function backendEnv(extra) {
  const pass = ['PATH', 'HOME', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy',
    'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
  const env = Object.fromEntries(pass.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  return {
    ...env,
    NODE_ENV: 'development',
    APP_ENV: 'local',
    PORT: String(API_PORT),
    DATABASE_URL: DB_URL,
    DIRECT_URL: DB_URL,
    REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
    APP_URL: 'http://localhost:5173',
    FRONTEND_URL: 'http://localhost:5173',
    // Clientes criados no construtor precisam de valor; nada aqui alcanca dado real.
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_SERVICE_KEY: 'e2e-fake',
    OPENAI_API_KEY: 'sk-e2e-fake',
    INTERNAL_OPS_TOKEN: randomBytes(16).toString('hex'),
    ...extra,
  };
}

async function startBackend(env, preload) {
  const args = preload ? ['-r', preload, 'dist/src/main'] : ['dist/src/main'];
  const api = startBg('node', args, { cwd: BACKEND, env });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    try {
      const r = await fetch(`${API}/api/health/live`);
      if (r.ok) return api;
    } catch { /* subindo */ }
    if (api.child.exitCode !== null) break;
  }
  throw new Error(`backend nao subiu:\n${api.output().slice(-3000)}`);
}

const signStripe = (payload, secret) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
};
const postWebhook = (payload, signature) =>
  fetch(`${API}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) },
    body: payload,
  });

// Superficie publica e webhook sem assinatura: mesmas provas do preflight da Codex.
async function checkWebhookSurface(secret) {
  const unsigned = await postWebhook('{"id":"evt_x"}');
  step('webhook sem assinatura e rejeitado', unsigned.status === 400, `HTTP ${unsigned.status}`);
  const forged = await postWebhook('{"id":"evt_x"}', signStripe('{"id":"evt_x"}', 'whsec_errado'));
  step('webhook com assinatura falsa e rejeitado', forged.status === 400, `HTTP ${forged.status}`);
  const unknown = await fetch(`${API}/api/rota-que-nao-existe`);
  step('rota desconhecida responde 404', unknown.status === 404, `HTTP ${unknown.status}`);
  const closed = await fetch(`${API}/api/ai/usage`);
  step('rota autenticada sem token responde 401', closed.status === 401, `HTTP ${closed.status}`);
  return secret;
}

// ── Modo offline: prova infra, travas e idempotencia do webhook sem rede ─────
async function offline(dir) {
  const secret = `whsec_${randomBytes(24).toString('hex')}`;
  await startBackend(backendEnv({ STRIPE_SECRET_KEY: 'sk_test_e2e_offline', STRIPE_WEBHOOK_SECRET: secret, CLERK_SECRET_KEY: 'sk_test_e2e_offline' }),
    writePreload(dir, { monthly: 'price_e2e_offline_monthly' }));
  step('backend local no ar com preload de precos de teste', true, API);
  await checkWebhookSurface(secret);
  // Evento que nao consulta a Stripe: prova assinatura valida + registro + duplicata.
  const evt = JSON.stringify({ id: `evt_e2e_${Date.now()}`, object: 'event', type: 'checkout.session.expired', livemode: false,
    data: { object: { id: 'cs_test_e2e', object: 'checkout.session', status: 'expired', metadata: {} } } });
  const first = await postWebhook(evt, signStripe(evt, secret));
  const firstBody = await first.json().catch(() => ({}));
  step('evento assinado e processado', first.status === 201 || first.status === 200, `HTTP ${first.status} ${JSON.stringify(firstBody)}`);
  const second = await postWebhook(evt, signStripe(evt, secret));
  const secondBody = await second.json().catch(() => ({}));
  step('mesmo evento reenviado e ignorado como duplicado', secondBody.duplicate === true, JSON.stringify(secondBody));
  const row = psql(`select status, attempts from "StripeWebhookEvent" where id = '${JSON.parse(evt).id}'`);
  step('StripeWebhookEvent gravado uma vez como processed', row === 'processed|1', row);
}

// ── Clerk development: usuario descartavel e token de sessao ─────────────────
async function clerkApi(method, pathname, body) {
  const res = await fetch(`https://api.clerk.com/v1${pathname}`, {
    method,
    headers: { authorization: `Bearer ${clerkKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${method} ${pathname}: ${res.status} ${JSON.stringify(json?.errors?.[0] || json).slice(0, 300)}`);
  return json;
}

async function clerkSession() {
  const email = `e2e+${Date.now()}@example.com`;
  const user = await clerkApi('POST', '/users', {
    email_address: [email],
    password: randomBytes(18).toString('base64url'),
    skip_password_checks: true,
  });
  cleanups.push(async () => { if (!KEEP) await clerkApi('DELETE', `/users/${user.id}`).catch(() => {}); });
  const session = await clerkApi('POST', '/sessions', { user_id: user.id });
  // Token de sessao dura ~60s: pede um novo a cada chamada.
  const token = async () => (await clerkApi('POST', `/sessions/${session.id}/tokens`, {})).jwt;
  return { user, email, token };
}

async function apiCall(token, method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${await token()}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Pagamento na pagina real do Checkout (cartao de teste 4242) ──────────────
async function payCheckout(url) {
  const req = createRequire(import.meta.url);
  const { chromium } = req(process.env.E2E_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright');
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
  cleanups.push(() => browser.close().catch(() => {}));
  // O proxy do ambiente cloud intercepta TLS com CA propria: so neste navegador de teste.
  const page = await (await browser.newContext({ ignoreHTTPSErrors: Boolean(proxy) })).newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const fill = async (sel, value) => {
    const el = page.locator(sel).first();
    if (await el.count()) await el.fill(value);
  };
  // Se a pagina mostrar varios metodos, escolhe cartao.
  const cardTab = page.locator('[data-testid="card-accordion-item-button"], button:has-text("Card")').first();
  if (await cardTab.count()) await cardTab.click().catch(() => {});
  await page.locator('#cardNumber').waitFor({ timeout: 60000 });
  await fill('#email', `e2e+${Date.now()}@example.com`);
  await fill('#cardNumber', '4242424242424242');
  await fill('#cardExpiry', '12 / 34');
  await fill('#cardCvc', '123');
  await fill('#billingName', 'Tickrify E2E');
  await fill('#billingPostalCode', '10001');
  await page.locator('button[type="submit"], .SubmitButton').first().click();
  // Sucesso = a Stripe redireciona para o success_url (o front local nao precisa existir).
  await page.waitForURL(/session_id=cs_test_/, { timeout: 90000, waitUntil: 'commit' });
}

// ── Fluxo completo ───────────────────────────────────────────────────────────
async function full(dir) {
  const account = await stripeApi('GET', '/account');
  step('conta Stripe acessivel no modo teste', true, account.id);
  const endpoints = (await stripeApi('GET', '/webhook_endpoints?limit=100')).data;
  const toProd = endpoints.filter((e) => /tickrify\.com|onrender\.com|vercel\.app/.test(e.url) && e.status === 'enabled');
  step('nenhum webhook de TESTE aponta para producao', toProd.length === 0,
    toProd.length ? toProd.map((e) => `${e.id} ${e.url}`).join(', ') : `${endpoints.length} endpoint(s) de teste`);

  const prices = await resolveTestPrices();

  // Stripe CLI entrega eventos REAIS por conexao de saida: sem tunel e sem porta publica.
  const cli = process.env.E2E_STRIPE_CLI || 'stripe';
  const secret = run(cli, ['listen', '--api-key', stripeKey, '--print-secret']).trim();
  must('Stripe CLI gerou o segredo de entrega local', /^whsec_/.test(secret), mask(secret));
  await startBackend(backendEnv({ STRIPE_SECRET_KEY: stripeKey, STRIPE_WEBHOOK_SECRET: secret, CLERK_SECRET_KEY: clerkKey }),
    writePreload(dir, prices));
  step('backend local no ar com Stripe TEST e Clerk development', true, API);
  await checkWebhookSurface(secret);

  const listen = startBg(cli, ['listen', '--api-key', stripeKey, '--forward-to', `${API}/api/stripe/webhook`,
    '--events', 'checkout.session.completed,customer.subscription.created,customer.subscription.updated,invoice.payment_succeeded,invoice.payment_failed,payment_intent.payment_failed']);
  for (let i = 0; i < 30 && !/Ready!/.test(listen.output()); i++) await sleep(1000);
  must('stripe listen pronto', /Ready!/.test(listen.output()));

  // Clerk -> autenticacao
  const { token } = await clerkSession();
  const me = await apiCall(token, 'GET', '/api/auth/me');
  must('Clerk development autentica no backend (/api/auth/me)', me.status === 200, `HTTP ${me.status}`);
  const bad = await fetch(`${API}/api/auth/me`, { headers: { authorization: 'Bearer invalido.e2e.token' } });
  step('token invalido recusado', bad.status === 401, `HTTP ${bad.status}`);
  const before = await apiCall(token, 'GET', '/api/ai/usage');
  step('antes da compra o plano e free', before.json?.plan === 'free', before.json?.plan);
  const userId = psql(`select id from "User" order by "createdAt" desc limit 1`);

  // Checkout
  const co = await apiCall(token, 'POST', '/api/stripe/create-checkout-session',
    { planType: 'starter', billingCycle: 'monthly', currency: 'usd', source: 'pricing' });
  must('checkout criado', (co.status === 201 || co.status === 200) && /^cs_test_/.test(co.json?.sessionId || ''),
    `HTTP ${co.status} ${co.json?.sessionId || JSON.stringify(co.json).slice(0, 200)}`);
  const items = await stripeApi('GET', `/checkout/sessions/${co.json.sessionId}/line_items`);
  must('checkout usa o preco mensal de TESTE', items.data[0]?.price?.id === prices.monthly, items.data[0]?.price?.id);

  // Pagamento
  await payCheckout(co.json.url);
  step('pagamento ficticio enviado na pagina do Checkout (4242)', true);

  // Stripe confirma
  let session;
  for (let i = 0; i < 30; i++) {
    session = await stripeApi('GET', `/checkout/sessions/${co.json.sessionId}`);
    if (session.status === 'complete' && session.payment_status === 'paid') break;
    await sleep(2000);
  }
  must('sessao Stripe complete/paid', session.status === 'complete' && session.payment_status === 'paid',
    `${session.status}/${session.payment_status}`);
  must('sessao em modo teste', session.livemode === false);
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  cleanups.push(async () => { if (!KEEP && subId) await stripeApi('DELETE', `/subscriptions/${subId}`).catch(() => {}); });
  const sub = await stripeApi('GET', `/subscriptions/${subId}`);
  step('assinatura ativa na Stripe', sub.status === 'active', `${sub.id} ${sub.status}`);

  // Webhook real recebido e processado. Lido no banco ANTES do /usage: o /usage
  // tem caminho de reserva (lazy sync) que creditaria os ticks sem webhook.
  const needed = ['checkout.session.completed', 'customer.subscription.created', 'invoice.payment_succeeded'];
  let events = '';
  for (let i = 0; i < 45; i++) {
    events = psql(`select string_agg(type || ':' || status, ',' order by type) from "StripeWebhookEvent"`);
    if (needed.every((t) => events.includes(`${t}:processed`))) break;
    await sleep(2000);
  }
  for (const t of needed) step(`webhook ${t} recebido e processado`, events.includes(`${t}:processed`), events);
  step('nenhum webhook com falha', !events.includes(':failed'), events);

  const dbSub = psql(`select status, "priceId", ("currentPeriodStart" is not null) from "Subscription" where "stripeId" = '${subId}'`);
  step('assinatura ativa no banco local com o preco de teste', dbSub === `active|${prices.monthly}|t`, dbSub);
  const ticks = psql(`select balance from "UserTicks" where "userId" = '${userId}'`);
  step('200 ticks creditados', ticks === '200', ticks);
  const tx = psql(`select count(*), max(metadata->>'source') from "TickTransaction" where "userId" = '${userId}' and "stripePaymentIntentId" like 'allowance:${subId}:%'`);
  step('credito veio do webhook da fatura (nao do lazy sync)', tx === '1|invoice_webhook', tx);

  // API reconhece o Starter
  const usage = await apiCall(token, 'GET', '/api/ai/usage');
  step('/api/ai/usage reconhece Starter', usage.json?.plan === 'starter' && usage.json?.billingCycle === 'monthly' &&
    usage.json?.tickBalance === 200, JSON.stringify({ plan: usage.json?.plan, billingCycle: usage.json?.billingCycle, tickBalance: usage.json?.tickBalance }));
  const subApi = await apiCall(token, 'GET', '/api/stripe/subscription');
  step('/api/stripe/subscription responde', subApi.status === 200, `HTTP ${subApi.status}`);

  // Idempotencia: o MESMO evento da fatura entregue de novo nao muda nada.
  const invoiceEvt = (await stripeApi('GET', `/events?type=invoice.payment_succeeded&limit=10`)).data
    .find((e) => {
      const inv = e.data.object;
      return (inv.subscription || inv.parent?.subscription_details?.subscription) === subId;
    });
  must('evento invoice.payment_succeeded encontrado na Stripe', Boolean(invoiceEvt), invoiceEvt?.id);
  const payload = JSON.stringify(invoiceEvt);
  const again = await postWebhook(payload, signStripe(payload, secret));
  const againBody = await again.json().catch(() => ({}));
  step('reentrega do mesmo evento ignorada (duplicate)', againBody.duplicate === true, JSON.stringify(againBody));
  await apiCall(token, 'GET', '/api/ai/usage');
  const ticksAfter = psql(`select balance from "UserTicks" where "userId" = '${userId}'`);
  const txAfter = psql(`select count(*) from "TickTransaction" where "userId" = '${userId}' and "stripePaymentIntentId" like 'allowance:${subId}:%'`);
  step('saldo continua 200 e um credito so depois da reentrega e do /usage', ticksAfter === '200' && txAfter === '1', `${ticksAfter} / ${txAfter}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const workDir = mkdtempSync(path.join(tmpdir(), 'tk-e2e-run-'));
cleanups.push(() => rmSync(workDir, { recursive: true, force: true }));
try {
  guards();
  run(path.join(BACKEND, 'node_modules/.bin/nest'), ['build'], { cwd: BACKEND });
  step('backend compilado (dist)', true);
  startInfra();
  if (OFFLINE) await offline(workDir);
  else await full(workDir);
} catch (error) {
  step('execucao', false, error instanceof Error ? error.message.slice(0, 1500) : String(error));
} finally {
  for (const c of cleanups.reverse()) {
    try { await c(); } catch { /* limpeza nunca derruba o relatorio */ }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n[e2e-payment] ${failed ? 'REPROVADO' : 'APROVADO'}: ${passed}/${results.length} etapas${OFFLINE ? ' (modo offline: NAO valida o fluxo de pagamento)' : ''}`);
  process.exit(failed ? 1 : 0);
}
