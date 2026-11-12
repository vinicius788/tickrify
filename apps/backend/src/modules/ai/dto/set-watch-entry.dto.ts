import { IsIn, IsNumber, IsPositive, Max } from 'class-validator';
import { WATCH_ENTRY_PLANS, type WatchEntryPlan } from '../watch-entry';

export class SetWatchEntryDto {
  @IsIn(WATCH_ENTRY_PLANS as unknown as string[])
  plan!: WatchEntryPlan;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(1e12)
  entry!: number;
}
