import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';
import { MailService } from '../mail/mail.service';

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
      }
    }

    return dbUser;
  }
}
