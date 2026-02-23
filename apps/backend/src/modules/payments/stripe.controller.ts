import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StripeService } from './stripe.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthGuard } from '../auth/auth.guard';
import { BillingCycle } from '../../config/stripe.config';
import { Throttle } from '@nestjs/throttler';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Criar sessão de checkout
   */
  @Post('create-checkout-session')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async createCheckoutSession(
    @CurrentUser() user: any,
    @Body() body: CreateCheckoutSessionDto,
  ) {
    const planType = 'pro' as const;
    const billingCycle: BillingCycle = body.billingCycle === 'annual' ? 'annual' : 'monthly';

    return this.stripeService.createCheckoutSession(user.clerkUserId, planType, billingCycle);
  }

  /**
   * Criar portal do cliente
   */
  @Post('create-customer-portal')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async createCustomerPortal(@CurrentUser() user: any) {
    return this.stripeService.createCustomerPortal(user.clerkUserId);
  }

  /**
   * Cancelar assinatura
   */
  @Post('cancel-subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async cancelSubscription(@CurrentUser() user: any) {
    return this.stripeService.cancelSubscription(user.clerkUserId);
  }

  /**
   * Reativar assinatura
   */
  @Post('reactivate-subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async reactivateSubscription(@CurrentUser() user: any) {
    return this.stripeService.reactivateSubscription(user.clerkUserId);
  }

  /**
   * Obter assinatura do usuário
   */
  @Get('subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getUserSubscription(@CurrentUser() user: any) {
    return this.stripeService.getUserSubscription(user.clerkUserId);
  }

  /**
   * Webhook do Stripe
   * Retorna 2xx apenas quando o evento é processado com sucesso.
   * Em erro, o Stripe pode reenviar automaticamente.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }

    return this.stripeService.handleWebhookEvent(signature, rawBody);
  }
}
