import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetFlagDto {
  /**
   * Valor cru, sempre string. A conversão e a validação por tipo acontecem no
   * FeatureFlagsService, contra a definição da flag no registro — e não aqui,
   * porque o tipo depende da chave e o DTO não a conhece.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  value!: string;
}
