import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePromptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  prompt!: string;

  @IsOptional()
  @IsBoolean()
  setActive?: boolean;
}
