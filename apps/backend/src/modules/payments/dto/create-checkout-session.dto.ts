import { IsBoolean, IsEnum, IsIn, IsOptional, Matches } from 'class-validator';
import { BillingCycle, CHARGE_CURRENCIES, ChargeCurrency, Currency, PlanType } from '../../../config/stripe.config';

enum PlanTypeDto {
  STARTER = 'starter',
  PRO = 'pro',
  ELITE = 'elite',
}

enum BillingCycleDto {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  WEEKLY = 'weekly',
}

enum CurrencyDto {
  BRL = 'brl',
  USD = 'usd',
  EUR = 'eur',
}

export class CreateCheckoutSessionDto {
  @IsOptional()
  @IsEnum(PlanTypeDto)
  planType?: PlanType;

  @IsOptional()
  @IsEnum(BillingCycleDto)
  billingCycle?: BillingCycle;

  @IsOptional()
  @IsEnum(CurrencyDto)
  currency?: Currency;

  /**
   * Moeda em que a pessoa VIU o preco (lista fechada). Nao escolhe price ID:
   * o servidor segue no price USD e so cobra nesta moeda se o price tiver a
   * opcao cadastrada na Stripe, no valor do dolar pelo cambio.
   */
  @IsOptional()
  @IsIn([...CHARGE_CURRENCIES])
  localCurrency?: ChargeCurrency;

  /**
   * De onde veio o clique (card da /pricing ou paywall do painel). Lista
   * fechada: vai para a metadata da sessao e da assinatura na Stripe.
   */
  @IsOptional()
  @IsIn(['pricing', 'locked_value', 'last_free_result', 'upgrade_modal'])
  source?: 'pricing' | 'locked_value' | 'last_free_result' | 'upgrade_modal';

  /**
   * Meta (anuncios). So vem preenchido quando o navegador aceitou cookies de
   * marketing. Formatos validados aqui E de novo no meta-capi antes de sair.
   */
  @IsOptional()
  @IsBoolean()
  adsConsent?: boolean;

  @IsOptional()
  @Matches(/^fb\.\d\.\d{10,13}\.\d{3,20}$/)
  fbp?: string;

  @IsOptional()
  @Matches(/^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/)
  fbc?: string;

  /**
   * Link ou cupom de afiliado guardado no navegador. So identifica QUEM
   * indicou: o servidor confere o codigo, a janela de 30 dias do clique e o
   * self-referral, e decide o desconto sozinho.
   */
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{4,20}$/)
  affiliateCode?: string;

  /**
   * Link pessoal da oferta Founding Member (FND-XXXXXXXX). So identifica o
   * codigo: o servidor confere na Stripe se esta ativo, e so vale no mensal.
   */
  @IsOptional()
  @Matches(/^FND-[A-Z0-9]{8}$/)
  offerCode?: string;

  @IsOptional()
  @IsIn(['link', 'coupon'])
  affiliateKind?: 'link' | 'coupon';

  @IsOptional()
  @Matches(/^[a-z0-9]{20,40}$/)
  affiliateClickId?: string;
}
