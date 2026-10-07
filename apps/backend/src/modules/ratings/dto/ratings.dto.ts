import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** Motivos de nota baixa: lista FECHADA (o texto livre vai so no comentario). */
export const RATING_REASONS = ['levels_off', 'too_many_waits', 'hard_to_understand', 'too_slow', 'wrong_symbol', 'other'] as const;

export class CreateRatingDto {
  @IsString()
  @Matches(/^[a-z0-9]{10,40}$/i)
  analysisId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}

export class UpdateRatingDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(RATING_REASONS.length)
  @IsIn(RATING_REASONS as unknown as string[], { each: true })
  reasons?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @IsOptional()
  @IsBoolean()
  quoteConsent?: boolean;

  /** Como aparecer no site (ex.: "Mattia, Italy"). Opcional; o admin pode ajustar. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string;
}

export class PublishRatingDto {
  @IsBoolean()
  published!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  country?: string;
}
