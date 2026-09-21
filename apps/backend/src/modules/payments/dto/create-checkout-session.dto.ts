import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { BillingCycle, Currency, PlanType } from '../../../config/stripe.config';

enum PlanTypeDto {
  STARTER = 'starter',
  PRO = 'pro',
  ELITE = 'elite',
}

enum BillingCycleDto {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
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
   * Cupom pré-aplicado no checkout (whitelist — nunca aceitar cupom arbitrário
   * do cliente). Usado pelo paywall "Unlock analysis" para chegar no Stripe com
   * o EARLY35 já aplicado, sem o usuário precisar digitar nada.
   */
  @IsOptional()
  @IsIn(['EARLY35'])
  coupon?: string;

  /**
   * De onde veio o clique (card da /pricing ou paywall do painel). Lista
   * fechada: vai para a metadata da sessao e da assinatura na Stripe.
   */
  @IsOptional()
  @IsIn(['pricing', 'locked_value'])
  source?: 'pricing' | 'locked_value';
}
