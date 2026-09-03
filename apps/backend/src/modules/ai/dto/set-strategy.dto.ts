import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Corpo da rota PUT /api/ai/strategy.
 *
 * ⚠️ POR QUE OS DECORATORS SAO OBRIGATORIOS AQUI, e nao decoracao:
 * o `ValidationPipe` global (main.ts) roda com `whitelist: true` E
 * `forbidNonWhitelisted: true`. Propriedade sem decorator de validacao NAO
 * EXISTE para o pipe: ele rejeita a requisicao inteira com
 * "property X should not exist". A primeira versao deste DTO declarava os
 * campos como propriedades TypeScript puras e o salvar quebrava 100% das
 * vezes, com a tela montada e o backend correto.
 *
 * A validacao REAL de conteudo continua sendo o `sanitizeStrategyProfile`,
 * que trabalha por whitelist fechada. Este DTO so garante a FORMA (array de
 * string, numero, string) para o pipe deixar passar. NUNCA confie nele como
 * fronteira de seguranca: ele aceita qualquer string dentro dos arrays, e e o
 * sanitize que descarta o que nao esta na whitelist.
 */
export class SetStrategyDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  timeframes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sessions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  instruments?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  setups?: string[];

  @IsOptional()
  @IsString()
  direction?: string;

  @IsOptional()
  @IsNumber()
  minRiskReward?: number;
}
