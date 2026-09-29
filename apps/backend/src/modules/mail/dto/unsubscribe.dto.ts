import { IsString, MaxLength } from 'class-validator';

/** Link de descadastro dos e-mails de ciclo de vida: id do usuario + HMAC. */
export class UnsubscribeQueryDto {
  @IsString()
  @MaxLength(64)
  u!: string;

  @IsString()
  @MaxLength(64)
  t!: string;
}
