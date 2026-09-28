import { Injectable, CanActivate, ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { PrismaService } from '../database/prisma.service';
import { isProductionRuntime } from '../../common/utils/runtime-env';
import { MailService } from '../mail/mail.service';
import { fetchClerkProfile } from '../../common/utils/clerk-email';
import { captureServer } from '../../common/analytics/posthog';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Memoização por requisição (12/08/2026). O AuthGuard agora roda DUAS vezes
    // na maioria das rotas: uma como GlobalAuthGuard (APP_GUARD) e outra pelo
    // `@UseGuards(AuthGuard)` que continua no controller como defesa em
    // profundidade. Sem isto, toda requisição autenticada faria dois
    // `verifyToken` e dois `user.upsert` no Postgres — custo real no Render free
    // + Supabase. Com isto, a redundância sai de graça.
    if (request.__tickrifyAuthUser) {
      request.user = request.__tickrifyAuthUser;
      return true;
    }

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
      const selectFields = { id: true, clerkUserId: true, email: true, role: true } as const;
      let user: { id: string; clerkUserId: string; email: string | null; role: string } | null = null;
      let isNewUser = false;

      // Antes disto usávamos prisma.user.upsert(), que não diz se criou ou só
      // atualizou. Resultado real (14/09/2026): o AuthGuard roda em TODA rota
      // autenticada, e o frontend dispara várias chamadas em paralelo no load
      // do dashboard (usage, ticks, activity...) — quase sempre uma delas
      // ganha a corrida e cria o usuário aqui ANTES de /api/auth/me rodar. Como
      // só o AuthController.getMe() disparava o e-mail de boas-vindas (no
      // bloco `if (!dbUser)`), esse bloco nunca era o responsável pela
      // criação de fato e o e-mail nunca saía — silenciosamente, sem log,
      // sem erro. Find-then-create (com fallback de corrida via P2002) deixa
      // explícito quem criou, e é daqui que o e-mail deve sair.
      const existing = await this.prisma.user.findUnique({ where: { clerkUserId }, select: selectFields });

      if (existing) {
        user =
          email && email !== existing.email
            ? await this.prisma.user.update({
                where: { clerkUserId },
                data: { email },
                select: selectFields,
              })
            : existing;
      } else {
        try {
          user = await this.prisma.user.create({
            data: {
              clerkUserId,
              email: email || undefined,
              role: 'user',
            },
            select: selectFields,
          });
          isNewUser = true;
        } catch (error: unknown) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code || '')
              : '';

          if (code === 'P2002') {
            // Perdeu a corrida de criação para outra requisição em paralelo —
            // não é usuário novo aos nossos olhos, não reenvia boas-vindas.
            user = await this.prisma.user.findUnique({ where: { clerkUserId }, select: selectFields });
          } else {
            throw error;
          }
        }
      }

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (isNewUser) {
        // `signup_completed` e SO do backend desde 21/09/2026. O do navegador
        // dependia de "conta com menos de 60s" e do aceite de cookies: medido
        // de 16 a 21/09, 45 eventos em 41 pessoas contra 45 cadastros reais
        // aqui (duplicava uns, perdia outros). Aqui a linha do usuario acabou
        // de nascer, entao e exatamente um por conta; a chave garante isso
        // mesmo em corrida. `$set_once` grava a data no perfil.
        try {
          captureServer(
            clerkUserId,
            'signup_completed',
            { source: 'auth_guard', $set_once: { signed_up_at: new Date().toISOString() } },
            { dedupeKey: `signup_completed:${clerkUserId}` },
          );
        } catch {
          /* analytics nunca pode quebrar auth */
        }

        // Usuário novo → e-mail de boas-vindas (fire-and-forget; nunca quebra a resposta).
        // So este ramo dispara: `isNewUser` so vale para quem CRIOU a linha
        // (quem perde a corrida P2002 ou apenas faz login nao passa aqui).
        // NAO usar await: Clerk (ate 5s) e Resend nunca entram no caminho da
        // autenticacao. O metodo captura todo erro sozinho.
        void this.welcomeNewUser(user.id, clerkUserId, user.email);
      }

      if (email && this.shouldBootstrapAdmin(user.role, email)) {
        user = await this.promoteUserToAdmin(user.id, clerkUserId, email);
      }

      request.user = {
        id: user.id,
        clerkUserId: user.clerkUserId,
        email: user.email,
        role: user.role,
      };
      request.__tickrifyAuthUser = request.user;

      return true;
    } catch (error) {
      throw new UnauthorizedException(
        error instanceof Error ? error.message : 'Invalid authentication token',
      );
    }
  }

  /**
   * Boas-vindas do usuario recem-criado. Consulta o Clerk (primeiro nome e, se
   * o token nao trouxe, o e-mail, que entao e persistido). Fire-and-forget:
   * roda fora do caminho da resposta e nunca propaga erro (e-mail jamais pode
   * quebrar o fluxo de auth). Falha do Clerk so tira o nome, nao o e-mail.
   */
  private async welcomeNewUser(
    userId: string,
    clerkUserId: string,
    knownEmail: string | null,
  ): Promise<void> {
    try {
      const profile = await fetchClerkProfile(clerkUserId);
      const email = knownEmail || profile.email;
      if (!email) return;

      if (!knownEmail) {
        await this.prisma.user.update({ where: { id: userId }, data: { email } });
      }

      await this.mail.sendWelcome(email, profile.firstName);
    } catch (err) {
      // Nunca propaga: e-mail e best-effort. Loga so a mensagem (sem token nem e-mail).
      this.logger.warn(`[welcome] Falha ao preparar boas-vindas (userId=${userId}): ${err instanceof Error ? err.message : 'erro desconhecido'}`);
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
    return this.verifyClerkToken(token);
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

  private extractEmailFromClaims(claims: Record<string, any>): string | null {
    const possibleEmail = claims?.email || claims?.email_address || claims?.primary_email_address;
    if (!possibleEmail) {
      return null;
    }

    return String(possibleEmail).trim() || null;
  }

  private shouldBootstrapAdmin(currentRole: string, email: string | null): boolean {
    if (!isProductionRuntime()) {
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
