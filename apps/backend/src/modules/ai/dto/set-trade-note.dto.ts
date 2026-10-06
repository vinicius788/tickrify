import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Anotacao do trader num trade (Diario, 05/10/2026): nota livre, setup,
 * emocao e erros. Setup, emocao e erros sao listas FECHADAS; a nota e texto
 * livre que so o proprio trader le. Nada disto vai para o prompt da IA nem
 * para o PostHog (regra do perfil de estrategia: texto livre do usuario no
 * prompt e injecao). As listas tem copia em `apps/frontend/src/lib/trade-note.ts`.
 *
 * Decorator em TODO campo (ValidationPipe com `forbidNonWhitelisted`).
 */
export const TRADE_SETUPS = ['breakout', 'pullback', 'reversal', 'range', 'trend', 'news', 'other'] as const;
export const TRADE_EMOTIONS = ['calm', 'confident', 'anxious', 'fomo', 'frustrated'] as const;
export const TRADE_MISTAKES = ['early_exit', 'moved_stop', 'late_entry', 'oversized', 'no_stop', 'revenge', 'overtrading'] as const;
export const TRADE_NOTE_MAX = 1000;

export class SetTradeNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(TRADE_NOTE_MAX)
  note?: string | null;

  @IsOptional()
  @IsIn([...TRADE_SETUPS])
  setup?: string | null;

  @IsOptional()
  @IsIn([...TRADE_EMOTIONS])
  emotion?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRADE_MISTAKES.length)
  @IsIn([...TRADE_MISTAKES], { each: true })
  mistakes?: string[] | null;
}
