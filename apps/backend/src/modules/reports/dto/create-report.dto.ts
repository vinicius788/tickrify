import { IsIn, IsOptional, IsString, MaxLength, MinLength, IsObject } from 'class-validator';

export class CreateReportDto {
  /**
   * O que o usuário digitou. Mínimo de 5 para não virar depósito de cliques
   * acidentais; máximo de 2000 porque o campo é caixa de texto, não anexo.
   */
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  analysisId?: string;

  /**
   * Contexto capturado pelo navegador. Objeto livre de propósito — o formato
   * vai mudar conforme aprendermos o que ajuda a reproduzir, e travar o schema
   * aqui só criaria trabalho de migração. O SERVIDOR sanitiza antes de gravar
   * (ver ReportsService.sanitizarContexto): tamanho, profundidade e chaves são
   * limitados lá, porque `forbidNonWhitelisted` não alcança dentro de um Json.
   */
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  /** `feedback` = quadrinho de opiniao do painel; ausente = relato de problema. */
  @IsOptional()
  @IsIn(['problem', 'feedback'])
  kind?: 'problem' | 'feedback';
}
