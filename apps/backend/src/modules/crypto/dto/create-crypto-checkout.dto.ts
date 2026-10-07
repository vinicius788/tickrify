import { IsIn } from 'class-validator';
import type { CryptoPassKind } from '../crypto-pass';

/** So o tipo do passe. Preco e duracao saem do servidor (`CRYPTO_PASSES`), nunca do corpo. */
export class CreateCryptoCheckoutDto {
  @IsIn(['week', 'month'])
  pass!: CryptoPassKind;
}
