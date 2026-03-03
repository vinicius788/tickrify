#!/usr/bin/env node

const baseUrlArg = process.argv[2];
const rawBaseUrl = String(baseUrlArg || process.env.SMOKE_API_BASE_URL || '').trim();

if (!rawBaseUrl) {
  console.error(
    'Missing API base URL. Usage: node scripts/smoke-api.mjs https://api.tickrify.com',
  );
  process.exit(1);
}

const baseUrl = rawBaseUrl.replace(/\/+$/, '');

async function fetchJson(path) {
  const target = `${baseUrl}${path}`;
  const response = await fetch(target, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const bodyText = await response.text();

  if (response.status !== 200) {
    throw new Error(`${target} returned status ${response.status}. Body: ${bodyText.slice(0, 300)}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`${target} did not return JSON. content-type=${contentType}`);
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new Error(`${target} returned invalid JSON.`);
  }

  if (String(payload?.status || '').toLowerCase() !== 'ok') {
    throw new Error(`${target} returned status=${payload?.status ?? 'unknown'}.`);
  }

  return {
    payload,
    headers: response.headers,
  };
}

async function main() {
  const live = await fetchJson('/api/health/live');
  const requestId = String(live.headers.get('x-request-id') || '').trim();
  if (!requestId) {
    throw new Error('/api/health/live did not return x-request-id header.');
  }
  console.log(`[smoke] OK /api/health/live (x-request-id=${requestId})`);

  const ready = await fetchJson('/api/health/ready');
  const critical = ['auth', 'storage', 'ai'];
  for (const key of critical) {
    const item = ready.payload?.[key];
    if (!item || typeof item !== 'object') {
      throw new Error(`/api/health/ready missing ${key} readiness block.`);
    }
    if (item.required === true && item.ready !== true) {
      throw new Error(`/api/health/ready ${key} is required but not ready.`);
    }
  }
  console.log('[smoke] OK /api/health/ready (critical dependencies validated)');

  console.log('[smoke] API health checks passed.');
}

main().catch((error) => {
  console.error('[smoke] FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
