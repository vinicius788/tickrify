import { IsEnum, IsOptional } from 'class-validator';
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
}
