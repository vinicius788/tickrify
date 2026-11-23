import { IsString, Length, Matches } from 'class-validator';

/** Busca do inspetor e da aba Usuario (`?q=`): id, e-mail ou ativo. Decorator em TODO campo. */
export class AdminSearchQueryDto {
  @IsString()
  @Length(2, 100)
  q!: string;
}

/** Id (cuid) na rota: so letras, numeros, hifen e sublinhado, nunca texto livre. */
export class AdminIdParamDto {
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_-]+$/)
  id!: string;
}
