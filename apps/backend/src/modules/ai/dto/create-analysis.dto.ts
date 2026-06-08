import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AnalysisType } from '../../ticks/tick-packages';

export class CreateAnalysisDto {
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  base64Image?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  promptOverride?: string;

  @IsOptional()
  @IsIn(['quick', 'deep'])
  analysisType?: AnalysisType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  userLanguage?: string;

  // Gráficos de timeframe maior (top-down) — opcionais.
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  htfBase64Image1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  htfBase64Image2?: string;
}
