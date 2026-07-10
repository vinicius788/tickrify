import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload da análise-demo anônima (sem cadastro).
 * Vai como multipart/form-data (mesmo padrão do /ai/analyze): o gráfico pode
 * vir como arquivo (`image`) ou como campo base64 (`base64Image`).
 */
export class DemoAnalyzeDto {
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  base64Image?: string;

  /**
   * Fingerprint de device gerado no front. NUNCA é persistido cru — o backend
   * armazena apenas hash com salt secreto (LGPD/GDPR).
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  fingerprint!: string;

  /** Token do desafio anti-bot (Cloudflare Turnstile). */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  userLanguage?: string;
}

export class DemoStatusDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  fingerprint!: string;
}
