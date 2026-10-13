import { Body, Controller, Get, Param, Post, Put, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UploadedFile as UploadedFileType } from '../../common/interfaces/multer';
import { PrismaService } from '../database/prisma.service';
import { AiService } from './ai.service';
import { TradesService } from './trades.service';
import { TrialService } from './trial.service';
import { CheckTradeDto, MarkTradeDto, MatchTradeDto } from './dto/trade.dto';

const IMAGE_UPLOAD = FileInterceptor('image', { limits: { fileSize: 10 * 1024 * 1024, fieldSize: 20 * 1024 * 1024 } });

/**
 * Estado da operacao e modo gerenciamento (13/10/2026). So a operacao da
 * propria pessoa. Marcar e checar seguem a trava do gratis esgotado (402);
 * ver o estado continua aberto no modo leitura. Guarda na CLASSE.
 */
@Controller('trades')
@UseGuards(AuthGuard)
export class TradesController {
  constructor(
    private readonly trades: TradesService,
    private readonly ai: AiService,
    private readonly trial: TrialService,
    private readonly prisma: PrismaService,
  ) {}

  private async userId(user: { id?: string; clerkUserId: string }): Promise<string> {
    if (user.id) return user.id;
    const row = await this.prisma.user.findUnique({ where: { clerkUserId: user.clerkUserId }, select: { id: true } });
    if (!row) throw new UnauthorizedException('Authenticated user not found');
    return row.id;
  }

  @Get('open')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async open(@CurrentUser() user: { id?: string; clerkUserId: string }) {
    return { trades: await this.trades.listOpen(await this.userId(user)) };
  }

  @Post('match')
  @UseInterceptors(IMAGE_UPLOAD)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async match(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @UploadedFile() file: UploadedFileType,
    @Body() body: MatchTradeDto,
  ) {
    return this.trades.matchOpen(await this.userId(user), file, body.base64Image);
  }

  @Get(':analysisId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async view(@CurrentUser() user: { id?: string; clerkUserId: string }, @Param('analysisId') analysisId: string) {
    return this.trades.view(await this.userId(user), analysisId);
  }

  @Put(':analysisId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async mark(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('analysisId') analysisId: string,
    @Body() body: MarkTradeDto,
  ) {
    const id = await this.userId(user);
    if (await this.ai.isFreeLocked(id)) throw this.ai.freeLockedError();
    return this.trades.mark(id, analysisId, body);
  }

  @Post(':analysisId/check')
  @UseInterceptors(IMAGE_UPLOAD)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async check(
    @CurrentUser() user: { id?: string; clerkUserId: string },
    @Param('analysisId') analysisId: string,
    @UploadedFile() file: UploadedFileType,
    @Body() body: CheckTradeDto,
  ) {
    const id = await this.userId(user);
    if (await this.ai.isFreeLocked(id)) throw this.ai.freeLockedError();
    const paid = await this.ai.hasPaidAccess(id);
    const currentPrice = body.currentPrice ? Number(body.currentPrice.replace(',', '.')) : null;
    return this.trades.check(
      id,
      analysisId,
      { imageFile: file, base64Image: body.base64Image, currentPrice, language: body.userLanguage ?? null },
      paid,
      (quota) => (quota.trial ? this.trial.blockedError(quota.trial) : this.ai.freeLockedError()),
    );
  }
}
