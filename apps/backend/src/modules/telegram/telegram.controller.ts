import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { TelegramService } from './telegram.service';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/** Ligacao da conta ao bot. O id vem do token; o webhook so entra com o segredo do Telegram. */
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('status')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.telegram.status(this.requireId(user));
  }

  @Post('link')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  link(@CurrentUser() user: AuthenticatedUser) {
    return this.telegram.createLink(this.requireId(user));
  }

  @Delete('link')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  unlink(@CurrentUser() user: AuthenticatedUser) {
    return this.telegram.unlink({ id: this.requireId(user), clerkUserId: user.clerkUserId });
  }

  /** Chamado pelo Telegram. Sempre 200 depois do segredo: erro nosso nao vira reenvio em loop. */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() body: unknown) {
    if (!this.telegram.isValidWebhookSecret(secret)) throw new ForbiddenException();
    await this.telegram.handleUpdate((body ?? {}) as Record<string, unknown>).catch(() => undefined);
    return { ok: true };
  }

  private requireId(user: AuthenticatedUser): string {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    return user.id;
  }
}
