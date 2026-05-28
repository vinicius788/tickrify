import { IsIn, IsString } from 'class-validator';
import { TICK_PACKAGES } from '../tick-packages';

const VALID_PACKAGE_IDS = TICK_PACKAGES.map((pkg) => pkg.id);

export class CreateTicksCheckoutDto {
  @IsString()
  @IsIn(VALID_PACKAGE_IDS)
  packageId!: string;
}
