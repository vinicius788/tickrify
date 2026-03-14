import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { StripeService } from '../payments/stripe.service';
import { CreateTicksCheckoutDto } from './dto/create-ticks-checkout.dto';
import { TICK_PACKAGES } from './tick-packages';
import { TicksService } from './ticks.service';

type AuthUser = {
  id?: string;
  clerkUserId?: string;
  email?: string | null;
};

@Controller('ticks')
@UseGuards(AuthGuard)
export class TicksController {
  constructor(
    private readonly ticksService: TicksService,
    private readonly stripeService: StripeService,
  ) {}

  @Get('balance')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async getBalance(@CurrentUser() user: AuthUser) {
    if (!user?.id) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    const balance = await this.ticksService.getBalance(user.id);
    return { balance, currency: 'ticks' as const };
  }

  @Get('packages')
  @Throttle({ default: { limit: 80, ttl: 60_000 } })
  getPackages() {
    return TICK_PACKAGES;
  }

  @Get('history')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async getHistory(@CurrentUser() user: AuthUser) {
    if (!user?.id) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    return this.ticksService.getHistory(user.id);
  }

  @Post('checkout')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async createCheckout(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateTicksCheckoutDto,
  ) {
    if (!user?.id) {
      throw new UnauthorizedException('Authenticated user not found');
    }

    if (!user.email) {
      throw new BadRequestException('Usuário sem e-mail para checkout Stripe');
    }

    const pkg = TICK_PACKAGES.find((item) => item.id === body.packageId);
    if (!pkg) {
      throw new BadRequestException('Pacote de Ticks inválido');
    }

    const session = await this.stripeService.createTicksCheckout({
      userId: user.id,
      userEmail: user.email,
      packageId: pkg.id,
      packageName: pkg.name,
      ticks: pkg.ticks,
      priceInCents: pkg.priceInCents,
    });

    return { url: session.url };
  }
}
