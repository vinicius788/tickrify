import { getAppEnv, isProductionRuntime } from './runtime-env';
import { flagBool } from '../flags/feature-flags';

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
  // Passa pela loja de apps (banco → env → padrão). Sem override no banco o
  // resultado é idêntico ao `process.env.DEMO_MODE === 'true'` de antes.
  return flagBool('DEMO_MODE');
}

export function canUseDemoFallback(): boolean {
  if (isProductionRuntime()) {
    return false;
  }

  const appEnv = getAppEnv();
  return appEnv === 'dev' || appEnv === 'development' || isDemoModeEnabled();
}

