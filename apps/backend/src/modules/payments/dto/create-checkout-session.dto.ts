import { IsEnum, IsOptional } from 'class-validator';
import { BillingCycle, PlanType } from '../../../config/stripe.config';

enum PlanTypeDto {
  STARTER = 'starter',
  PRO = 'pro',
  ELITE = 'elite',
}

enum BillingCycleDto {
  MONTHLY = 'monthly',
}

export class CreateCheckoutSessionDto {
  @IsOptional()
  @IsEnum(PlanTypeDto)
  planType?: PlanType;

  @IsOptional()
  @IsEnum(BillingCycleDto)
  billingCycle?: BillingCycle;
}
