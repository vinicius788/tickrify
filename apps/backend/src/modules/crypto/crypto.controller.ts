import { Body, Controller, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CryptoService } from './crypto.service';
import { CreateCryptoCheckoutDto } from './dto/create-crypto-checkout.dto';

type AuthenticatedUser = { id?: string; clerkUserId: string };

/** Passe pre-pago pago em cripto (NOWPayments). */
@Controller('crypto')
export class CryptoController {
  constructor(private readonly crypto: CryptoService) {}

  /** Abre a cobranca e devolve o link da pagina de pagamento do NOWPayments. */
  @Post('checkout')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async checkout(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateCryptoCheckoutDto) {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    const { url } = await this.crypto.createCheckout(user.id, body.pass);
    return { url };
  }

  /** Status de um pagamento da propria conta (a tela de volta consulta ate o passe ligar). */
  @Get('payment/:id')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async paymentStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user?.id) throw new NotFoundException('Account not found. Please sign in again.');
    if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new NotFoundException({ code: 'not_found' });
    return this.crypto.getPaymentStatus(user.id, id);
  }

  /**
   * Aviso do NOWPayments. @Public() obrigatorio: quem chama e o provedor, sem
   * sessao. A autenticacao e a assinatura HMAC-SHA512 do corpo (`x-nowpayments-sig`),
   * e o passe so libera depois de reler o pagamento na API deles. O corpo e lido
   * cru do request (sem DTO): o ValidationPipe com `forbidNonWhitelisted`
   * recusaria campos novos do provedor e a assinatura cobre o corpo inteiro.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Headers('x-nowpayments-sig') signature: string | undefined, @Req() request: { body?: unknown }) {
    return this.crypto.handleIpn(request.body, signature);
  }
}
