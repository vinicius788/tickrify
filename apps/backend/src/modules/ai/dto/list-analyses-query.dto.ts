import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListAnalysesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * Id da ULTIMA analise ja recebida. A pagina seguinte comeca depois dela.
   *
   * Cursor e nao offset de proposito: a lista e ordenada por data decrescente,
   * entao uma analise nova entrando no topo empurra tudo para baixo e um offset
   * passaria a repetir ou pular linhas. O cursor e imune a isso.
   *
   * Decorators sao OBRIGATORIOS: o ValidationPipe global roda com
   * `forbidNonWhitelisted`, e campo sem decorator faz o pipe rejeitar a
   * requisicao inteira (ver a secao do SetStrategyDto no CLAUDE.md).
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}
