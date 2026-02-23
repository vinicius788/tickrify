import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/decorators/user.decorator';
import { PrismaService } from '../database/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService) {}

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
    }

    return dbUser;
  }
}
