import { IsIn, IsNumber, IsOptional } from 'class-validator';

export class SetOutcomeDto {
  @IsOptional()
  @IsIn(['tp1', 'tp2', 'stop', 'breakeven', 'open', 'no_fill'])
  outcome?: string | null;

  @IsOptional()
  @IsNumber()
  pnlPercent?: number | null;

  @IsOptional()
  @IsNumber()
  pnlAmount?: number | null;
}
