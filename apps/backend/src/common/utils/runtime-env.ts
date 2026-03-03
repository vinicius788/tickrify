function normalizeRuntimeValue(value?: string): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function getNodeEnv(): string {
  return normalizeRuntimeValue(process.env.NODE_ENV) || 'development';
}

export function getAppEnv(): string {
  return normalizeRuntimeValue(process.env.APP_ENV);
}

/**
 * Fail-closed strategy:
 * If either NODE_ENV or APP_ENV is "production", runtime is treated as production.
 */
export function isProductionRuntime(): boolean {
  const nodeEnv = getNodeEnv();
  const appEnv = getAppEnv();
  return nodeEnv === 'production' || appEnv === 'production';
}

