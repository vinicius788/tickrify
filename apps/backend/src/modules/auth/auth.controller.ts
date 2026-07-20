import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';
import { fetchClerkEmail } from '../../common/utils/clerk-email';

@Controller('auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@CurrentUser() user: { id?: string; clerkUserId: string; email?: string | null }) {
    let dbUser = await this.prisma.user.findUnique({
      where: user.id ? { id: user.id } : { clerkUserId: user.clerkUserId },
      include: {
        subscriptions: true,
        analyses: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      },
    });

    if (!dbUser) {
      dbUser = await this.prisma.user.create({
        data: {
          clerkUserId: user.clerkUserId,
          email: user.email || undefined,
        },
        include: {
          subscriptions: true,
          analyses: true
        },
      });

      // Usuário novo → e-mail de boas-vindas (fire-and-forget; nunca quebra a resposta).
      if (dbUser.email) {
        void this.mail.sendWelcome(dbUser.email).catch(() => undefined);
      } else {
        // O session token do Clerk não inclui e-mail por padrão → busca na API
        // do Clerk, persiste (backfill) e só então envia as boas-vindas.
        void this.backfillEmailAndWelcome(dbUser.id, user.clerkUserId, true);
      }
    } else if (!dbUser.email) {
      // Conta existente sem e-mail (criada antes do backfill existir) →
      // preenche silenciosamente, sem reenviar boas-vindas.
      void this.backfillEmailAndWelcome(dbUser.id, user.clerkUserId, false);
    }

    return dbUser;
  }

  /**
   * Busca o e-mail na API do Clerk e persiste no User. Fire-and-forget:
   * roda fora do caminho da resposta e nunca propaga erro (e-mail jamais
   * pode quebrar o fluxo de auth).
   */
  private async backfillEmailAndWelcome(
    userId: string,
    clerkUserId: string,
    isNewUser: boolean,
  ): Promise<void> {
    try {
      const email = await fetchClerkEmail(clerkUserId);
      if (!email) return;

      await this.prisma.user.update({ where: { id: userId }, data: { email } });

      if (isNewUser) {
        await this.mail.sendWelcome(email);
      }
    } catch {
      // best-effort — sem log barulhento; o MailService já loga falha de envio
    }
  }
}
