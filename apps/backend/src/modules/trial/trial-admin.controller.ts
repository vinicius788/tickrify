import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { flagBool } from '../../common/flags/feature-flags';
import { TrialService } from '../ai/trial.service';
import { GrantTrialReactivationDto } from './trial-admin.dto';

/**
 * Reativacao com o trial de 3 dias (13/10/2026): quem esgotou a regra antiga
 * (3 planos gratis) e nunca assinou. GET so conta; POST concede o trial com
 * `confirm: 'GRANT'` e a chave TRIAL_REACTIVATION ligada. Nenhum e-mail sai
 * daqui. Guardas na CLASSE, igual aos outros controllers de admin.
 */
@Controller('admin/trial/reactivation')
@UseGuards(AuthGuard, AdminGuard)
export class TrialAdminController {
  constructor(private readonly trial: TrialService) {}

  @Get()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async preview() {
    const candidates = await this.trial.reactivationCandidates();
    return {
      enabled: flagBool('TRIAL_REACTIVATION'),
      count: candidates.length,
      sample: candidates.slice(0, 5).map((c) => c.email),
    };
  }

  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async grant(@Body() _body: GrantTrialReactivationDto) {
    if (!flagBool('TRIAL_REACTIVATION')) {
      throw new BadRequestException('Ligue a chave TRIAL_REACTIVATION no /admin antes de conceder.');
    }
    const candidates = await this.trial.reactivationCandidates();
    const granted = await this.trial.grantReactivation(candidates.map((c) => c.id));
    return { granted, of: candidates.length };
  }
}
