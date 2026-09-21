import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { TicksService } from './ticks.service';

type AuthUser = {
  id?: string;
  clerkUserId?: string;
  email?: string | null;
};

// So o saldo. Pacotes avulsos (listar, comprar, historico) sairam em 21/09/2026:
// nenhuma tela os chamava desde que o modal de compra foi removido, e com o
// saldo mensal fixo em 200 um pacote comprado seria apagado na virada do mes.
@Controller('ticks')
@UseGuards(AuthGuard)
export class TicksController {
  constructor(private readonly ticksService: TicksService) {}

  @Get('balance')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async getBalance(@CurrentUser() user: AuthUser) {
    if (!user?.id) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const balance = await this.ticksService.getBalance(user.id);
    return { balance, currency: 'ticks' as const };
  }
}
