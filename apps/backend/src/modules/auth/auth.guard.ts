import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      const claims = await this.verifyAuthToken(token);
      const clerkUserId = String(claims?.sub || '').trim();

      if (!clerkUserId) {
        throw new UnauthorizedException('Invalid authentication token');
      }

      const email = this.extractEmailFromClaims(claims);
      let user = await this.prisma.user.upsert({
        where: { clerkUserId },
        create: {
          clerkUserId,
          email: email || undefined,
          role: 'user',
        },
        update: {
          ...(email ? { email } : {}),
        },
      });

      if (this.shouldBootstrapAdmin(user.role, email)) {
        user = await this.promoteUserToAdmin(user.id, clerkUserId, email);
      }

      request.user = {
        id: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        role: user.role,
      };

      return true;
    } catch (error) {
      throw new UnauthorizedException(
        error instanceof Error ? error.message : 'Invalid authentication token',
      );
    }
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  private async verifyAuthToken(token: string): Promise<Record<string, any>> {
    try {
      return await this.verifyClerkToken(token);
    } catch (clerkError) {
      const legacyClaims = this.verifyLegacyToken(token);
      if (legacyClaims) {
        return legacyClaims;
      }

      throw clerkError;
    }
  }

  private async verifyClerkToken(token: string): Promise<Record<string, any>> {
    const options: Record<string, any> = {};

    if (process.env.CLERK_SECRET_KEY) {
      options.secretKey = process.env.CLERK_SECRET_KEY;
    }

    if (process.env.CLERK_JWT_KEY) {
      options.jwtKey = process.env.CLERK_JWT_KEY;
    }

    if (process.env.CLERK_AUDIENCE) {
      options.audience = process.env.CLERK_AUDIENCE;
    }

    if (process.env.CLERK_AUTHORIZED_PARTIES) {
      options.authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES.split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }

    const claims = (await verifyToken(token, options)) as Record<string, any>;

    if (process.env.CLERK_ISSUER) {
      const issuer = String(claims?.iss || '');
      if (issuer !== process.env.CLERK_ISSUER) {
        throw new UnauthorizedException('Invalid token issuer');
      }
    }

    return claims;
  }

  private verifyLegacyToken(token: string): Record<string, any> | null {
    const fallbackEnabled = process.env.ALLOW_LEGACY_AUTH_FALLBACK === 'true';
    if (!fallbackEnabled) {
      return null;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const subject = String(payload?.sub || payload?.user_id || '').trim();
      if (!subject) {
        return null;
      }

      return {
        sub: subject,
        email: payload?.email,
      };
    } catch {
      return null;
    }
  }

  private extractEmailFromClaims(claims: Record<string, any>): string | null {
    const possibleEmail = claims?.email || claims?.email_address || claims?.primary_email_address;
    if (!possibleEmail) {
      return null;
    }

    return String(possibleEmail).trim() || null;
  }

  private shouldBootstrapAdmin(currentRole: string, email: string | null): boolean {
    if (!this.isProductionEnvironment()) {
      return false;
    }

    if (!email) {
      return false;
    }

    if (String(currentRole || '').toLowerCase() === 'admin') {
      return false;
    }

    const allowlist = this.getBootstrapAdminEmails();
    return allowlist.has(email.trim().toLowerCase());
  }

  private getBootstrapAdminEmails(): Set<string> {
    return new Set(
      String(process.env.BOOTSTRAP_ADMIN_EMAILS || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private isProductionEnvironment(): boolean {
    const runtime = String(process.env.APP_ENV || process.env.NODE_ENV || 'development')
      .trim()
      .toLowerCase();
    return runtime === 'production';
  }

  private async promoteUserToAdmin(userId: string, clerkUserId: string, email: string) {
    return this.prisma.$transaction(async (tx) => {
      const promotedUser = await tx.user.update({
        where: { id: userId },
        data: {
          role: 'admin',
          email,
        },
      });

      await tx.adminAudit.create({
        data: {
          actorUserId: promotedUser.id,
          targetUserId: promotedUser.id,
          targetEmail: email,
          action: 'bootstrap_admin_from_allowlist',
          details: {
            source: 'BOOTSTRAP_ADMIN_EMAILS',
            clerkUserId,
          },
        },
      });

      return promotedUser;
    });
  }
}
