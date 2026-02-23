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

async function assertJsonHealth(path) {
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

  console.log(`[smoke] OK ${path}`);
}

async function main() {
  await assertJsonHealth('/api/health/live');
  await assertJsonHealth('/api/health/ready');
  console.log('[smoke] API health checks passed.');
}

main().catch((error) => {
  console.error('[smoke] FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
