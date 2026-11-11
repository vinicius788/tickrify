import { Body, Controller, Get, NotFoundException, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { WatchAssetsService } from './watch-assets.service';
import { SaveWatchAssetsDto } from './dto/watch-assets.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/** Lista de ativos e niveis do dia. So a propria conta; gratis esgotado responde 402. */
@Controller('watch-assets')
export class WatchAssetsController {
  constructor(private readonly assets: WatchAssetsService, private readonly ai: AiService) {}

  @Get()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async view(@CurrentUser() user: AuthenticatedUser) {
    const userId = await this.unlocked(user);
    return this.assets.view(userId, await this.ai.hasPaidAccess(userId));
  }

  @Put()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async save(@CurrentUser() user: AuthenticatedUser, @Body() body: SaveWatchAssetsDto) {
    const userId = await this.unlocked(user);
    return this.assets.save({ id: userId, clerkUserId: user.clerkUserId }, body, await this.ai.hasPaidAccess(userId));
  }

  private async unlocked(user: AuthenticatedUser): Promise<string> {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    if (await this.ai.isFreeLocked(user.id)) throw this.ai.freeLockedError();
    return user.id;
  }
}
