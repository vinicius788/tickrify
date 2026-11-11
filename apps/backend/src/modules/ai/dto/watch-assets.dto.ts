import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsString, Matches } from 'class-validator';
import { WATCH_ASSET_RULES } from '../watch-assets';

export const WATCH_SYMBOL_PATTERN = /^[A-Za-z0-9./+-]{2,20}$/;

export class SetWatchAssetAlertDto {
  @IsBoolean()
  on!: boolean;
}

export class SaveWatchAssetsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(WATCH_ASSET_RULES.maxAssets.subscriber)
  @IsString({ each: true })
  @Matches(WATCH_SYMBOL_PATTERN, { each: true })
  symbols!: string[];

  @IsIn(WATCH_ASSET_RULES.timeframes as unknown as string[])
  timeframe!: string;
}
