import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAnalysisDto {
  @IsOptional()
  @IsString()
  @MaxLength(14_000_000)
  base64Image?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  promptOverride?: string;
}
