import { Controller, Get, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PromptService } from './prompt.service';
import { Throttle } from '@nestjs/throttler';

/**
 * So leitura: o prompt da analise e sempre o do codigo (buildAnalysisPrompt).
 * Criar ou ativar versao pela API saiu em 27/10/2026; o PromptSyncService
 * registra a versao do codigo no boot.
 */
@Controller('prompts')
export class PromptController {
  constructor(private promptService: PromptService) {}

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
}
