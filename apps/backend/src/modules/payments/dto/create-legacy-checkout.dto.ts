import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

enum CheckoutModeDto {
  PAYMENT = 'payment',
  SUBSCRIPTION = 'subscription',
}

export class CreateLegacyCheckoutDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  priceId!: string;

  @IsEnum(CheckoutModeDto)
  mode!: CheckoutModeDto;
}
