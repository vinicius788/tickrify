import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { SetupsService } from './setups.service';
import {
  ANALYSIS_ID_PATTERN,
  FollowSetupDto,
  ListSetupsQueryDto,
  SETUP_ID_PATTERN,
  SetSetupStatusDto,
  SetupVersionsQueryDto,
} from './dto/setups.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/**
 * Setups acompanhados (ver setups.service.ts). Nenhuma rota publica. Gratis
 * esgotado: tudo responde 402 `free_quota_exhausted`, menos a pagina do setup,
 * que mostra so as versoes entre as analises que continuam abertas (e 402 se
 * nenhuma estiver). Atualizar e a rota normal de analise (`POST ai/analyze`
 * com `setupId`), que ja passa pela cota.
 */
@Controller('setups')
export class SetupsController {
  constructor(
    private readonly setups: SetupsService,
    private readonly ai: AiService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSetupsQueryDto) {
    const userId = await this.unlocked(user);
    return this.setups.list(userId, query.cursor ?? null, query.limit ?? 20);
  }

  @Post()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async follow(@CurrentUser() user: AuthenticatedUser, @Body() body: FollowSetupDto) {
    const userId = await this.unlocked(user);
    return this.setups.follow({ id: userId, clerkUserId: user.clerkUserId }, body.analysisId);
  }

  // Antes de `:id`: a tela do resultado pergunta se a analise ja e de um setup.
  @Get('by-analysis/:analysisId')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async forAnalysis(@CurrentUser() user: AuthenticatedUser, @Param('analysisId') analysisId: string) {
    if (!ANALYSIS_ID_PATTERN.test(analysisId)) throw new NotFoundException({ code: 'analysis_not_found' });
    const userId = await this.unlocked(user);
    return this.setups.findForAnalysis(userId, analysisId);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query() query: SetupVersionsQueryDto) {
    if (!SETUP_ID_PATTERN.test(id)) throw new NotFoundException({ code: 'setup_not_found' });
    const userId = this.requireId(user);
    const readableIds = await this.ai.readableAnalysisIds(userId);
    const page = await this.setups.get(userId, id, { cursor: query.cursor ?? null, limit: query.limit, readableIds });
    if (readableIds && !query.cursor && page.versions.length === 0) throw this.ai.freeLockedError();
    return page;
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: SetSetupStatusDto) {
    if (!SETUP_ID_PATTERN.test(id)) throw new NotFoundException({ code: 'setup_not_found' });
    const userId = await this.unlocked(user);
    return this.setups.setStatus({ id: userId, clerkUserId: user.clerkUserId }, id, body.status);
  }

  private requireId(user: AuthenticatedUser): string {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    return user.id;
  }

  /** Mesma trava das outras rotas de operacao (regra 4.0): sem 402 no servidor nao e trava. */
  private async unlocked(user: AuthenticatedUser): Promise<string> {
    const userId = this.requireId(user);
    if (await this.ai.isFreeLocked(userId)) throw this.ai.freeLockedError();
    return userId;
  }
}
