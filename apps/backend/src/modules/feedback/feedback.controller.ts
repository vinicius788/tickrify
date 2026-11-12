import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/**
 * Opiniao que vale analises. NAO passa pelo `isFreeLocked` de proposito: a
 * tela de limite e justamente onde o pedido aparece com destaque.
 */
@Controller('feedback')
@UseGuards(AuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() body: SubmitFeedbackDto) {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    return this.feedback.submit({ id: user.id, clerkUserId: user.clerkUserId }, body);
  }
}

/** Lista das opinioes no /admin. Guardas na CLASSE, como os outros admins. */
@Controller('admin/feedback')
@UseGuards(AuthGuard, AdminGuard)
export class FeedbackAdminController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  list() {
    return this.feedback.adminList();
  }
}
