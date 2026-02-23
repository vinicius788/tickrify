import { IsEnum, IsOptional } from 'class-validator';
import { BillingCycle } from '../../../config/stripe.config';

enum PlanTypeDto {
  PRO = 'pro',
}

enum BillingCycleDto {
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
}

export class CreateCheckoutSessionDto {
  @IsOptional()
  @IsEnum(PlanTypeDto)
  planType?: PlanTypeDto;

  @IsOptional()
  @IsEnum(BillingCycleDto)
  billingCycle?: BillingCycle;
}
