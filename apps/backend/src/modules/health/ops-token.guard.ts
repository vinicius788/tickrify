import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

@Injectable()
export class OpsTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const expected = String(process.env.INTERNAL_OPS_TOKEN || '').trim();

    if (!expected) {
      return false;
    }

    const headerValue = request?.headers?.['x-ops-token'];
    const provided =
      typeof headerValue === 'string'
        ? headerValue
        : Array.isArray(headerValue)
          ? String(headerValue[0] || '')
          : '';

    return provided === expected;
  }
}

