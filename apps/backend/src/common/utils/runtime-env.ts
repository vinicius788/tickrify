function normalizeRuntimeValue(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

const KNOWN_NON_PROD = new Set(['development', 'dev', 'test', 'local']);

export function getNodeEnv(): string {
  return normalizeRuntimeValue(process.env.NODE_ENV);
}

export function getAppEnv(): string {
  return normalizeRuntimeValue(process.env.APP_ENV);
}

/**
 * Fail-closed strategy:
 * Only explicit known non-prod envs are treated as non-production.
 * Missing/unknown env values are treated as production.
 */
export function isProductionRuntime(): boolean {
  const runtimeEnv = getAppEnv() || getNodeEnv();
  if (!runtimeEnv) {
    return true;
  }
  return !KNOWN_NON_PROD.has(runtimeEnv);
}
