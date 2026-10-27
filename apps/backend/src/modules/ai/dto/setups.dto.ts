import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, Min } from 'class-validator';
import { ALERT_LABELS, type AlertLabel } from '../setup-alerts.service';

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

/** Alerta de nivel (27/10/2026). Nivel editado pela pessoa chega como `custom`. */
export class CreateSetupAlertDto {
  @IsString()
  @Matches(ANALYSIS_ID_PATTERN)
  analysisId!: string;

  @IsIn(ALERT_LABELS)
  label!: AlertLabel;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(1e9)
  level!: number;
}

export class ListSetupAlertsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(SETUP_ID_PATTERN)
  setupId?: string;
}
