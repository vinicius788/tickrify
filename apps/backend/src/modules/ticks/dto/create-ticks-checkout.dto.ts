import { IsIn, IsOptional, IsString } from 'class-validator';
import { Currency } from '../../../config/stripe.config';
import { TICK_PACKAGES } from '../tick-packages';

const VALID_PACKAGE_IDS = TICK_PACKAGES.map((pkg) => pkg.id);

export class CreateTicksCheckoutDto {
  @IsString()
  @IsIn(VALID_PACKAGE_IDS)
  packageId!: string;

  @IsOptional()
  @IsIn(['brl', 'usd', 'eur'])
  currency?: Currency;
}
