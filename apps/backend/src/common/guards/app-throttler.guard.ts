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
    // Express resolves req.ip according to trust proxy (one Render ingress hop
    // in main.ts). Never override that trust boundary with a client header.
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
