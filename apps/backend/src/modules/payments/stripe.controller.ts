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
import { BillingCycle, Currency, isChargeCurrency } from '../../config/stripe.config';
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
    const billingCycle: BillingCycle =
      body.billingCycle === 'yearly' || body.billingCycle === 'weekly' ? body.billingCycle : 'monthly';

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
    // A moeda de COBRANCA (13/11/2026) e outra coisa: escolhe uma das
    // `currency_options` do MESMO price USD, conferida no servico. Nao abre
    // caminho para price legado nenhum.
    const localCurrency = isChargeCurrency(body.localCurrency) ? body.localCurrency : 'usd';

    const coupon = body.coupon === 'EARLY35' ? body.coupon : undefined;

    return this.stripeService.createCheckoutSession(
      user.clerkUserId,
      planType,
      billingCycle,
      currency,
      coupon,
      body.source,
      adsContextFrom(body, req),
      body.affiliateCode && body.affiliateKind
        ? { code: body.affiliateCode, kind: body.affiliateKind, clickId: body.affiliateClickId ?? null }
        : undefined,
      body.offerCode,
      localCurrency,
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

  /** Portal da Stripe (cartao, faturas, cancelar). 403 para quem nao tem assinatura. */
  @Post('create-customer-portal')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async createCustomerPortal(@CurrentUser() user: AuthenticatedUser, @Body() body?: { intent?: string }) {
    return this.stripeService.createCustomerPortal(user.clerkUserId, body?.intent === 'upgrade');
  }

  /** Assinatura para a tela de Configuracoes (status, valor, proxima cobranca, fim do acesso). */
  @Get('subscription')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async getUserSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.stripeService.getUserSubscription(user.clerkUserId);
  }

  /** Desfaz o cancelamento agendado, enquanto o periodo pago nao terminou. */
  @Post('subscription/reactivate')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async reactivateSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.stripeService.reactivateSubscription(user.clerkUserId);
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
  /**
   * Oferta Founding Trader para a vitrine. Publica porque a /pricing e a home
   * mostram (ou escondem) a oferta para quem nao esta logado. Nao expoe nada
   * alem de "existe, qual codigo, quantos por cento".
   */
  @Public()
  @Get('offer')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getOffer() {
    return this.stripeService.getFoundingOffer();
  }

  /**
   * Oferta Founding Member de UM link pessoal. Publica porque quem abre o link
   * pode estar sem login. O codigo tem 8 caracteres sorteados (~1 trilhao de
   * combinacoes) e a rota so devolve "ativa, preco, vagas, validade".
   */
  /**
   * Precos do plano em cada moeda de cobranca, lidos da Stripe (13/11/2026).
   * Publica porque a /pricing e a home mostram o preco para quem nao esta
   * logado. Valores em unidade normal (29, 27, 4500).
   */
  @Public()
  @Get('prices')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getPrices() {
    return this.stripeService.getPublicPrices();
  }

  @Public()
  @Get('founder-offer')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getFounderOffer(@Query('code') code?: string) {
    return this.stripeService.getFounderOffer(typeof code === 'string' ? code.trim().toUpperCase() : '');
  }

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
