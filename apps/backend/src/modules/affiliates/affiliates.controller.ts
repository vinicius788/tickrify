import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AffiliatesService } from './affiliates.service';
import { ClaimAffiliateDto, RequestPayoutDto, TrackAffiliateDto } from './dto/affiliates.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/**
 * Programa de afiliados: pagina publica, clique no link e painel do afiliado.
 * Nenhuma rota aqui recebe valor em dinheiro: saldo e saque sao calculados no
 * servidor a partir das comissoes gravadas pelo webhook da Stripe.
 */
@Controller('affiliates')
export class AffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  /** Regras publicas (so a taxa padrao; taxa especial de parceiro nunca sai). */
  @Public()
  @Get('program')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getProgram() {
    return this.affiliates.getProgram();
  }

  /**
   * Visitante chegou com ?ref= (grava o clique e devolve o id que ancora os 30
   * dias) ou digitou um cupom antes do login (so valida).
   */
  @Public()
  @Post('track')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async track(@Body() body: TrackAffiliateDto) {
    if (body.kind === 'coupon') return { valid: await this.affiliates.isCouponValid(body.code) };
    return this.affiliates.recordClick(body.code, body.landingPath);
  }

  /** Vincula a conta logada ao afiliado do link/cupom guardado no navegador. */
  @Post('claim')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async claim(@CurrentUser() user: AuthenticatedUser, @Body() body: ClaimAffiliateDto) {
    return this.affiliates.claim(this.requireId(user), { code: body.code, kind: body.kind, clickId: body.clickId });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliates.getDashboard(this.requireId(user));
  }

  @Post('join')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async join(@CurrentUser() user: AuthenticatedUser) {
    await this.affiliates.join(this.requireId(user));
    return this.affiliates.getDashboard(this.requireId(user));
  }

  @Post('payouts')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestPayout(@CurrentUser() user: AuthenticatedUser, @Body() body: RequestPayoutDto) {
    const payout = await this.affiliates.requestPayout(this.requireId(user), body.method);
    return { id: payout.id, amountCents: payout.amountCents, status: payout.status };
  }

  private requireId(user: AuthenticatedUser): string {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    return user.id;
  }
}
