import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ip = this.resolveIp(req);
    const userId = this.extractUserIdFromRequest(req);
    return userId ? `${userId}:${ip}` : ip;
  }

  protected getRequestResponse(context: ExecutionContext) {
    const http = context.switchToHttp();
    return { req: http.getRequest(), res: http.getResponse() };
  }

  private resolveIp(req: Record<string, any>): string {
    const ips = req.ips;
    if (Array.isArray(ips) && ips.length > 0) {
      const forwardedIp = String(ips[0] || '').trim();
      if (forwardedIp) {
        return forwardedIp;
      }
    }

    return String(req.ip || req.socket?.remoteAddress || 'unknown');
  }

  private extractUserIdFromRequest(req: Record<string, any>): string | null {
    const userId = req.user?.id;
    if (!userId) {
      return null;
    }
    return String(userId).trim() || null;
  }
}
