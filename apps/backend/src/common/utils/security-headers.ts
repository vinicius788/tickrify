import type { HelmetOptions } from 'helmet';
import { isProductionRuntime } from './runtime-env';

export function buildHelmetConfig(): HelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: isProductionRuntime()
      ? {
          maxAge: 31_536_000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    frameguard: { action: 'deny' },
    noSniff: true,
  };
}

