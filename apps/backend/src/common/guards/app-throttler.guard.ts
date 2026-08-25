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
    // 1º) CF-Connecting-IP — o IP real do visitante segundo a Cloudflare.
    //
    // POR QUE ELE VEM PRIMEIRO (item 11, 19/08/2026):
    // `X-Forwarded-For` é uma lista que QUALQUER CLIENTE pode começar. Pegar o
    // primeiro elemento significa confiar num valor que o próprio atacante
    // escreve — basta mandar `X-Forwarded-For: 1.2.3.4` com um IP diferente a
    // cada requisição para o rate limit virar decoração. A Cloudflare SOBRESCREVE
    // o CF-Connecting-IP com o IP da conexão TCP real; ele não é falsificável
    // de fora.
    //
    // ⚠️ ISSO SÓ VALE COM A ORIGEM TRAVADA. Se alguém alcançar o Render
    // diretamente, pulando a Cloudflare, pode forjar este cabeçalho e ficaria
    // PIOR que antes. O passo "travar a origem" do runbook do Cloudflare
    // (regra de firewall aceitando só as faixas da Cloudflare) não é opcional —
    // é o que torna esta linha confiável.
    //
    // Hoje, sem Cloudflare na frente, o cabeçalho não existe e a resolução cai
    // exatamente no comportamento anterior. Mudança aditiva, risco zero agora.
    const cloudflareIp = String(req.headers?.['cf-connecting-ip'] || '').trim();
    if (cloudflareIp) {
      return cloudflareIp;
    }

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
