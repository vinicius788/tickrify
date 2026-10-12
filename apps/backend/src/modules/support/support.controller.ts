import { Body, Controller, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupportService } from './support.service';
import { ChatMessagesQueryDto, SendChatMessageDto } from './dto/support.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string; email?: string | null };

/**
 * Chat da pessoa com o fundador. So a PROPRIA conversa: o id vem do token,
 * nunca do corpo ou da URL. Sem trava do gratis de proposito (ver o service).
 */
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Conversa e respostas nao lidas (o contador do botao pergunta isto a cada 60 s). */
  @Get('thread')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  thread(@CurrentUser() user: AuthenticatedUser) {
    return this.support.getThreadForUser(this.requireId(user));
  }

  @Get('messages')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  messages(@CurrentUser() user: AuthenticatedUser, @Query() query: ChatMessagesQueryDto) {
    return this.support.listMessagesForUser(this.requireId(user), query.cursor ?? null, query.limit ?? 50);
  }

  @Post('messages')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(@CurrentUser() user: AuthenticatedUser, @Body() body: SendChatMessageDto) {
    return this.support.sendUserMessage({ id: this.requireId(user), clerkUserId: user.clerkUserId, email: user.email ?? null }, body.body);
  }

  @Post('read')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  read(@CurrentUser() user: AuthenticatedUser) {
    return this.support.markReadByUser(this.requireId(user));
  }

  private requireId(user: AuthenticatedUser): string {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    return user.id;
  }
}
