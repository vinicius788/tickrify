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
      // Rede de segurança apenas: o AuthGuard roda antes deste handler em
      // TODA requisição autenticada (incluindo esta) e já faz o
      // find-then-create de verdade — é lá que mora a criação real do
      // usuário e o disparo do e-mail de boas-vindas (ver auth.guard.ts,
      // 14/09/2026). Se ainda assim chegarmos aqui sem dbUser, algo bem
      // incomum aconteceu; criamos sem reenviar boas-vindas para não duplicar.
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
