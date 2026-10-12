import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Setups acompanhados (12/10/2026). Decorator em TODO campo: o ValidationPipe
 * roda com `forbidNonWhitelisted`, e campo sem decorator derruba o corpo inteiro.
 * Ids so com formato estreito (cuid da analise, uuid do setup).
 */
export const ANALYSIS_ID_PATTERN = /^[a-z0-9]{10,40}$/i;
export const SETUP_ID_PATTERN = /^[a-z0-9-]{10,40}$/i;

export class FollowSetupDto {
  @IsString()
  @Matches(ANALYSIS_ID_PATTERN)
  analysisId!: string;
}

/** Voltar a acompanhar e pelo `POST /setups` (idempotente); aqui so se larga. */
export class SetSetupStatusDto {
  @IsIn(['untracked', 'archived'])
  status!: 'untracked' | 'archived';
}

export class ListSetupsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Id do ultimo setup ja recebido. */
  @IsOptional()
  @IsString()
  @Matches(SETUP_ID_PATTERN)
  cursor?: string;
}

export class SetupVersionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Id da ultima versao (analise) ja recebida. */
  @IsOptional()
  @IsString()
  @Matches(ANALYSIS_ID_PATTERN)
  cursor?: string;
}
