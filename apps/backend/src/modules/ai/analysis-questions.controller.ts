import { Body, Controller, Get, Param, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../database/prisma.service';
import { AnalysisQuestionsService } from './analysis-questions.service';
import { AskQuestionDto } from './dto/ask-question.dto';

/** "Ask about this analysis": historico e pergunta nova, so do dono da analise. */
@Controller('ai')
export class AnalysisQuestionsController {
  constructor(
    private readonly questions: AnalysisQuestionsService,
    private readonly prisma: PrismaService,
  ) {}

  private async caller(user: { id?: string; clerkUserId: string }) {
    const id = user.id ?? (await this.prisma.user.findUnique({ where: { clerkUserId: user.clerkUserId }, select: { id: true } }))?.id;
    if (!id) throw new UnauthorizedException('Authenticated user not found');
    return { id, clerkUserId: user.clerkUserId };
  }

  @Get('analysis/:id/questions')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(@CurrentUser() user: { id?: string; clerkUserId: string }, @Param('id') id: string) {
    const caller = await this.caller(user);
    return this.questions.list(caller.id, id);
  }

  @Post('analysis/:id/questions')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async ask(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('id') id: string,
    @Body() body: AskQuestionDto,
  ) {
    return this.questions.ask(await this.caller(user), id, body.question);
  }
}
