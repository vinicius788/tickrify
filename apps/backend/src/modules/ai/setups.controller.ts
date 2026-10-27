import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { SetupsService } from './setups.service';
import { SetupAlertsService } from './setup-alerts.service';
import { getFreeQuota } from '../../common/free-quota';
import { flagBool } from '../../common/flags/feature-flags';
import { SETUP_ALERT_EMAIL_FLAG } from '../mail/setup-alert-email';
import { PrismaService } from '../database/prisma.service';
import {
  ANALYSIS_ID_PATTERN,
  CreateSetupAlertDto,
  FollowSetupDto,
  ListSetupAlertsQueryDto,
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
 *
 * Alertas de nivel (`/setups/alerts*`, setup-alerts.service.ts): mesma trava;
 * a lista e a unica que responde para conta travada, com `paused` e o ativo
 * (o paywall `alerts` cita o ativo real), sem nenhum alerta.
 */
@Controller('setups')
export class SetupsController {
  constructor(
    private readonly setups: SetupsService,
    private readonly ai: AiService,
    private readonly alerts: SetupAlertsService,
    private readonly prisma: PrismaService,
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

  // Rotas dos alertas antes de `:id` (a ordem de declaracao decide no Nest).
  @Get('alerts')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listAlerts(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSetupAlertsQueryDto) {
    const userId = this.requireId(user);
    const emailEnabled = flagBool(SETUP_ALERT_EMAIL_FLAG);
    if (await this.ai.isFreeLocked(userId)) {
      return { paused: true, pausedSymbol: await this.alerts.pausedSymbol(userId), items: [], unseen: 0, emailEnabled };
    }
    return { paused: false, pausedSymbol: null, ...(await this.alerts.list(userId, { setupId: query.setupId ?? null })), emailEnabled };
  }

  @Get('alerts/options/:analysisId')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async alertOptions(@CurrentUser() user: AuthenticatedUser, @Param('analysisId') analysisId: string) {
    if (!ANALYSIS_ID_PATTERN.test(analysisId)) throw new NotFoundException({ code: 'analysis_not_found' });
    const userId = await this.unlocked(user);
    const options = await this.alerts.options(userId, analysisId, await this.ai.hasPaidAccess(userId));
    return { ...options, emailEnabled: flagBool(SETUP_ALERT_EMAIL_FLAG) };
  }

  @Post('alerts')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async createAlert(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateSetupAlertDto) {
    const userId = await this.unlocked(user);
    const isSubscriber = await this.ai.hasPaidAccess(userId);
    const trialDay = isSubscriber ? null : (await getFreeQuota(this.prisma, userId)).trial?.dayIndex ?? null;
    return this.alerts.create({ id: userId, clerkUserId: user.clerkUserId }, body, { isSubscriber, trialDay });
  }

  @Post('alerts/:alertId/cancel')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async cancelAlert(@CurrentUser() user: AuthenticatedUser, @Param('alertId') alertId: string) {
    if (!SETUP_ID_PATTERN.test(alertId)) throw new NotFoundException({ code: 'alert_not_found' });
    const userId = await this.unlocked(user);
    return this.alerts.cancel(userId, alertId);
  }

  @Post('alerts/:alertId/seen')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async seenAlert(@CurrentUser() user: AuthenticatedUser, @Param('alertId') alertId: string) {
    if (!SETUP_ID_PATTERN.test(alertId)) throw new NotFoundException({ code: 'alert_not_found' });
    const userId = await this.unlocked(user);
    return this.alerts.markSeen(userId, alertId);
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
    const result = await this.setups.setStatus({ id: userId, clerkUserId: user.clerkUserId }, id, body.status);
    await this.alerts.cancelForSetup(userId, id);
    return result;
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
