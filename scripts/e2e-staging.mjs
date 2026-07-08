#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

const apiBase = String(args[0] || process.env.E2E_API_URL || process.env.SMOKE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const opsToken = String(
  process.env.E2E_OPS_TOKEN || process.env.OPS_TOKEN || process.env.INTERNAL_OPS_TOKEN || '',
).trim();
const validAuthToken = String(
  process.env.E2E_CLERK_VALID_TOKEN || process.env.SMOKE_AUTH_TOKEN || '',
).trim();
const invalidAuthToken = String(process.env.E2E_CLERK_INVALID_TOKEN || 'invalid.token.for.e2e').trim();
const imagePath = String(process.env.E2E_IMAGE_PATH || '').trim();
const checkoutBillingCycle = String(process.env.E2E_BILLING_CYCLE || 'monthly').trim() === 'annual'
  ? 'annual'
  : 'monthly';
const stripeTriggerEnabled = String(process.env.E2E_STRIPE_TRIGGER_ENABLED || 'true').trim().toLowerCase() !== 'false';
const stripeTriggerCommand = String(
  process.env.E2E_STRIPE_TRIGGER_CMD || 'stripe trigger customer.subscription.updated',
).trim();
const stripeWebhookWaitMs = Number(process.env.E2E_STRIPE_WEBHOOK_WAIT_MS || 15000);
const analysisTimeoutMs = Number(process.env.E2E_ANALYSIS_TIMEOUT_MS || 120000);

function fail(message, extra) {
  console.error(`\n[e2e-staging] FAIL: ${message}`);
  if (extra) {
    console.error(extra);
  }
  process.exit(1);
}

function logStep(step, message) {
  console.log(`\n[e2e-staging] [${step}] ${message}`);
}

if (!apiBase) {
  fail('Missing API base URL. Use: node scripts/e2e-staging.mjs <API_URL> or set E2E_API_URL.');
}

if (!opsToken) {
  fail('Missing OPS token. Set E2E_OPS_TOKEN or OPS_TOKEN for /api/health/ready checks.');
}

if (!validAuthToken) {
  fail('Missing valid auth token. Set E2E_CLERK_VALID_TOKEN (or SMOKE_AUTH_TOKEN).');
}

if (!imagePath) {
  fail('Missing E2E_IMAGE_PATH. Provide a real local image file for /api/ai/analyze.');
}

function buildUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiBase}${normalizedPath}`;
}

async function request(pathname, options = {}) {
  const response = await fetch(buildUrl(pathname), options);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();

  let json = null;
  if (contentType.includes('application/json') && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    response,
    status: response.status,
    contentType,
    text,
    json,
    headers: response.headers,
  };
}

function assertStatus(result, expectedStatuses, contextLabel) {
  if (expectedStatuses.includes(result.status)) {
    return;
  }

  const bodyPreview = String(result.text || '').slice(0, 600);
  throw new Error(
    `${contextLabel} returned HTTP ${result.status}. Expected: ${expectedStatuses.join(', ')}. Body: ${bodyPreview}`,
  );
}

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
  };
}

async function readUsage(token) {
  const usageResult = await request('/api/ai/usage', {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(token),
    },
  });

  assertStatus(usageResult, [200], 'GET /api/ai/usage');
  if (!usageResult.json || typeof usageResult.json !== 'object') {
    throw new Error('GET /api/ai/usage returned non-JSON payload.');
  }

  return usageResult.json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStripeTrigger() {
  if (!stripeTriggerEnabled) {
    console.log('[e2e-staging] Stripe trigger disabled by E2E_STRIPE_TRIGGER_ENABLED=false.');
    return;
  }

  const [command, ...commandArgs] = stripeTriggerCommand.split(' ').filter(Boolean);
  if (!command) {
    throw new Error('Invalid E2E_STRIPE_TRIGGER_CMD.');
  }

  console.log(`[e2e-staging] Running: ${stripeTriggerCommand}`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        const output = `${stdout}\n${stderr}`.trim();
        const maxOutput = output.slice(0, 1500);
        console.log('[e2e-staging] stripe trigger completed.');
        if (maxOutput) {
          console.log(maxOutput);
        }
        resolve(undefined);
        return;
      }

      reject(
        new Error(
          `stripe trigger exited with code ${code}.\nstdout:\n${stdout.slice(0, 1200)}\nstderr:\n${stderr.slice(0, 1200)}`,
        ),
      );
    });
  });
}

async function main() {
  logStep('1/6', 'Health check completo (/api/health/live + /api/health/ready com token)');

  const live = await request('/api/health/live', {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  assertStatus(live, [200], 'GET /api/health/live');
  if (String(live.json?.status || '').toLowerCase() !== 'ok') {
    throw new Error('/api/health/live did not return status=ok');
  }

  const ready = await request('/api/health/ready', {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-ops-token': opsToken,
    },
  });
  assertStatus(ready, [200], 'GET /api/health/ready');
  if (String(ready.json?.status || '').toLowerCase() !== 'ok') {
    throw new Error('/api/health/ready did not return status=ok');
  }

  logStep('2/6', 'Autenticação Clerk em /api/auth/me com token válido e inválido');

  const authValid = await request('/api/auth/me', {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(validAuthToken),
    },
  });
  assertStatus(authValid, [200], 'GET /api/auth/me (valid token)');

  const authInvalid = await request('/api/auth/me', {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(invalidAuthToken),
    },
  });
  assertStatus(authInvalid, [401], 'GET /api/auth/me (invalid token)');

  logStep('3/6', 'Upload real em /api/ai/analyze e polling até completed (timeout 120s)');

  const usageBefore = await readUsage(validAuthToken);

  const buffer = await readFile(imagePath);
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType =
    extension === '.png'
      ? 'image/png'
      : extension === '.webp'
        ? 'image/webp'
        : 'image/jpeg';

  const analyzeForm = new FormData();
  analyzeForm.append('image', new Blob([buffer], { type: mimeType }), path.basename(imagePath));

  const analyze = await request('/api/ai/analyze', {
    method: 'POST',
    headers: {
      ...authHeaders(validAuthToken),
    },
    body: analyzeForm,
  });
  assertStatus(analyze, [200, 201], 'POST /api/ai/analyze');

  const analysisId = String(analyze.json?.id || '').trim();
  if (!analysisId) {
    throw new Error('POST /api/ai/analyze did not return analysis id.');
  }

  const startedAt = Date.now();
  let analysisStatus = String(analyze.json?.status || 'pending').toLowerCase();
  let analysisPayload = analyze.json;

  while (analysisStatus === 'pending' || analysisStatus === 'processing') {
    if (Date.now() - startedAt > analysisTimeoutMs) {
      throw new Error(`Analysis polling timeout after ${analysisTimeoutMs}ms for id=${analysisId}`);
    }

    await sleep(5000);

    const poll = await request(`/api/ai/analysis/${analysisId}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...authHeaders(validAuthToken),
      },
    });
    assertStatus(poll, [200], 'GET /api/ai/analysis/:id');

    analysisPayload = poll.json;
    analysisStatus = String(poll.json?.status || '').toLowerCase();
    console.log(`[e2e-staging] analysis ${analysisId} status=${analysisStatus}`);
  }

  if (analysisStatus !== 'completed') {
    const reasoning = String(analysisPayload?.reasoning || 'No reasoning');
    throw new Error(`Analysis ended with status=${analysisStatus}. reason=${reasoning}`);
  }

  logStep('4/6', 'Verificação de consumo de AnalysisUsage');

  const usageAfter = await readUsage(validAuthToken);
  const beforeUsed = Number(usageBefore.used ?? 0);
  const afterUsed = Number(usageAfter.used ?? 0);
  const isUnlimited = Boolean(usageBefore.isUnlimited);

  if (!isUnlimited) {
    if (afterUsed !== beforeUsed + 1) {
      throw new Error(
        `Expected usage.used to increment by 1 (before=${beforeUsed}, after=${afterUsed}).`,
      );
    }
    console.log(
      `[e2e-staging] Usage increment verified (before=${beforeUsed}, after=${afterUsed}).`,
    );
  } else {
    console.log('[e2e-staging] Usage decrement check skipped: unlimited plan.');
  }

  logStep('5/6', 'Criação de sessão Stripe checkout e validação de redirecionamento');

  const checkout = await request('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...authHeaders(validAuthToken),
    },
    body: JSON.stringify({
      planType: 'pro',
      billingCycle: checkoutBillingCycle,
    }),
  });
  assertStatus(checkout, [200, 201], 'POST /api/stripe/create-checkout-session');

  const checkoutUrl = String(checkout.json?.url || '').trim();
  const sessionId = String(checkout.json?.sessionId || '').trim();

  if (!checkoutUrl || !sessionId) {
    throw new Error('Stripe checkout session response missing url/sessionId.');
  }

  let parsedCheckoutUrl;
  try {
    parsedCheckoutUrl = new URL(checkoutUrl);
  } catch {
    throw new Error(`Stripe checkout URL is invalid: ${checkoutUrl}`);
  }

  if (!parsedCheckoutUrl.protocol.startsWith('http')) {
    throw new Error(`Stripe checkout URL has invalid protocol: ${checkoutUrl}`);
  }

  logStep('6/6', 'Disparo webhook Stripe simulado e confirmação básica de processamento');

  const subscriptionBefore = await request('/api/stripe/subscription', {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(validAuthToken),
    },
  });
  assertStatus(subscriptionBefore, [200], 'GET /api/stripe/subscription (before trigger)');

  await runStripeTrigger();
  await sleep(Math.max(1000, stripeWebhookWaitMs));

  const subscriptionAfter = await request('/api/stripe/subscription', {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(validAuthToken),
    },
  });
  assertStatus(subscriptionAfter, [200], 'GET /api/stripe/subscription (after trigger)');

  console.log('[e2e-staging] Stripe webhook trigger executed and subscription endpoint remained healthy.');
  console.log('\n[e2e-staging] PASS: all staging critical steps completed successfully.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
