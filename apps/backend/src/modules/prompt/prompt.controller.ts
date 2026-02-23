import { Controller, Post, Get, Body, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PromptService } from './prompt.service';
import { Throttle } from '@nestjs/throttler';

@Controller('prompts')
export class PromptController {
  constructor(private promptService: PromptService) {}

  @Post('config')
  @UseGuards(AuthGuard, AdminGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createConfig(
    @CurrentUser() user: { id: string; clerkUserId: string },
    @Body() body: { prompt: string; setActive?: boolean },
  ) {
    return this.promptService.createPromptConfig(body.prompt, body.setActive ?? true, {
      id: user.id,
      clerkUserId: user.clerkUserId,
    });
  }

  @Get('latest')
  @UseGuards(AuthGuard, AdminGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getLatest() {
    return this.promptService.getLatestPrompt();
  }

  @Get('list')
  @UseGuards(AuthGuard, AdminGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async listPrompts() {
    return this.promptService.listPrompts();
  }

  @Get(':version')
  @UseGuards(AuthGuard, AdminGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getByVersion(@Param('version', ParseIntPipe) version: number) {
    return this.promptService.getPromptByVersion(version);
  }

  @Post(':version/activate')
  @UseGuards(AuthGuard, AdminGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activatePrompt(
    @CurrentUser() user: { id: string; clerkUserId: string },
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.promptService.activatePrompt(version, {
      id: user.id,
      clerkUserId: user.clerkUserId,
    });
  }
}
