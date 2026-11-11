import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Matches } from 'class-validator';
import { WATCH_ASSET_RULES } from '../watch-assets';

export class SaveWatchAssetsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(WATCH_ASSET_RULES.maxAssets.subscriber)
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9./+-]{2,20}$/, { each: true })
  symbols!: string[];

  @IsIn(WATCH_ASSET_RULES.timeframes as unknown as string[])
  timeframe!: string;
}
