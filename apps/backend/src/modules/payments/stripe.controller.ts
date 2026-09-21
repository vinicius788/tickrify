import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
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
import { Public } from '../../common/decorators/public.decorator';
import { BillingCycle, Currency } from '../../config/stripe.config';
import { Throttle } from '@nestjs/throttler';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import type { MetaAdsContext } from '../../common/analytics/meta-capi';

type RequestLike = { ip?: string; headers?: Record<string, string | string[] | undefined> };

/** IP e user agent da propria requisicao (trust proxy=1 no main.ts). So vao ao Meta com aceite. */
function adsContextFrom(body: CreateCheckoutSessionDto, req: RequestLike): MetaAdsContext {
  const consent = body.adsConsent === true;
  const ua = req.headers?.['user-agent'];
  return {
    consent,
    fbp: consent ? body.fbp ?? null : null,
    fbc: consent ? body.fbc ?? null : null,
    ip: consent ? req.ip ?? null : null,
    userAgent: consent ? (Array.isArray(ua) ? ua[0] : ua) ?? null : null,
  };
}

type AuthenticatedUser = {
  id?: string;
  clerkUserId: string;
  email?: string | null;
  role?: string;
};

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
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCheckoutSessionDto,
    @Req() req: RequestLike,
  ) {
    // Default = `starter`, o ÚNICO plano da vitrine. Era `pro` (LEGADO, 150
    // ticks): requisição sem planType vendia o plano errado pelo mesmo preço.
    const planType = (body.planType && ['starter', 'pro', 'elite'].includes(body.planType))
      ? body.planType
      : 'starter' as const;
    const billingCycle: BillingCycle = body.billingCycle === 'yearly' ? 'yearly' : 'monthly';

    // MOEDA ÚNICA: USD, sempre, ignorando o que o cliente mandar (29/07/2026).
    //
    // Isto é fronteira de SEGURANÇA, não preferência. Enquanto o corpo da
    // requisição escolhia a moeda, um POST com `currency:'brl'` resolvia para o
    // price BRL do starter — congelado em R$ 57 desde jun/2026, quando o plano
    // custava US$ 12. Ou seja: dava para assinar o plano de US$ 29 por ~US$ 10
    // trocando uma string. Os price IDs BRL/EUR seguem em stripe.config.ts só
    // para assinaturas LEGADAS resolverem os ticks certos; nenhum checkout novo
    // chega neles.
    const currency: Currency = 'usd';

    const coupon = body.coupon === 'EARLY35' ? body.coupon : undefined;

    return this.stripeService.createCheckoutSession(
      user.clerkUserId,
      planType,
      billingCycle,
      currency,
      coupon,
      body.source,
      adsContextFrom(body, req),
    );
  }

  /**
   * Retorno da Stripe. Com `session_id` (success_url): confirma NO SERVIDOR se
   * a sessao e desta pessoa e se foi paga, e so entao o navegador dispara o
   * Purchase do pixel, com o valor real. Com `outcome=canceled` (cancel_url):
   * so registra que a pessoa voltou sem pagar.
   */
  @Get('checkout-status')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async getCheckoutStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Query('session_id') sessionId?: string,
    @Query('outcome') outcome?: string,
  ) {
    const safeId = typeof sessionId === 'string' && /^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId) ? sessionId : null;
    return this.stripeService.getCheckoutStatus(
      user.clerkUserId,
      safeId,
      outcome === 'canceled' ? 'canceled' : 'success',
    );
  }

  /**
   * Criar portal do cliente
   */
  @Post('create-customer-portal')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async createCustomerPortal(@CurrentUser() user: AuthenticatedUser) {
    return this.stripeService.createCustomerPortal(user.clerkUserId);
  }

  /**
   * Cancelar assinatura
   */
  @Post('cancel-subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async cancelSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.stripeService.cancelSubscription(user.clerkUserId);
  }

  /**
   * Reativar assinatura
   */
  @Post('reactivate-subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async reactivateSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.stripeService.reactivateSubscription(user.clerkUserId);
  }

  /**
   * Obter assinatura do usuário
   */
  @Get('subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getUserSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.stripeService.getUserSubscription(user.clerkUserId);
  }

  /**
   * Webhook do Stripe
   * Retorna 2xx apenas quando o evento é processado com sucesso.
   * Em erro, o Stripe pode reenviar automaticamente.
   *
   * @Public() obrigatório: quem chama é o Stripe, que não tem sessão do Clerk.
   * A autenticação aqui é a assinatura HMAC do corpo, verificada em
   * handleWebhookEvent — rota aberta, corpo autenticado. Sem assinatura válida
   * o serviço rejeita antes de tocar o banco.
   */
  @Public()
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
