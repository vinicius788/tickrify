import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SupportService } from './support.service';
import { AdminChatStatusDto, AdminStartChatDto, CHAT_ID_PATTERN, ChatMessagesQueryDto, SendChatMessageDto } from './dto/support.dto';

/** Chat no /admin. Guardas na CLASSE (role vem do banco, AuthGuard). */
@Controller('admin/support')
@UseGuards(AuthGuard, AdminGuard)
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get('threads')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list() {
    return this.support.adminListThreads();
  }

  @Post('threads')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  start(@Body() body: AdminStartChatDto) {
    return this.support.adminStartConversation(body.email, body.body);
  }

  @Get('threads/:id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  get(@Param('id') id: string, @Query() query: ChatMessagesQueryDto) {
    return this.support.adminGetThread(this.checkId(id), query.cursor ?? null, query.limit ?? 100);
  }

  @Post('threads/:id/messages')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  reply(@Param('id') id: string, @Body() body: SendChatMessageDto) {
    return this.support.adminReply(this.checkId(id), body.body);
  }

  @Patch('threads/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setStatus(@Param('id') id: string, @Body() body: AdminChatStatusDto) {
    return this.support.adminSetStatus(this.checkId(id), body.status);
  }

  private checkId(id: string): string {
    if (!CHAT_ID_PATTERN.test(id)) throw new NotFoundException({ code: 'thread_not_found' });
    return id;
  }
}
