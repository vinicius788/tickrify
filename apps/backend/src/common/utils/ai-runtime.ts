import { getAppEnv, isProductionRuntime } from './runtime-env';

const INVALID_OPENAI_KEYS = new Set([
  '',
  'YOUR_OPENAI_API_KEY_HERE',
  'OPENAI_API_KEY_PLACEHOLDER',
  'DUMMY_OPENAI_KEY',
]);

export function hasValidOpenAiKey(): boolean {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key || INVALID_OPENAI_KEYS.has(key)) {
    return false;
  }

  return key.length >= 20;
}

export function isDemoModeEnabled(): boolean {
  return String(process.env.DEMO_MODE || '').trim().toLowerCase() === 'true';
}

export function canUseDemoFallback(): boolean {
  if (isProductionRuntime()) {
    return false;
  }

  const appEnv = getAppEnv();
  return appEnv === 'dev' || appEnv === 'development' || isDemoModeEnabled();
}

