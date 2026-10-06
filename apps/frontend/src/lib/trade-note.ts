/**
 * Anotacao do trader num trade (Diario, 05/10/2026): nota livre, setup,
 * emocao e erros. As listas sao COPIA das do servidor
 * (`apps/backend/src/modules/ai/dto/set-trade-note.dto.ts`), que recusa valor
 * fora delas: mudar uma lista e mudar as duas no mesmo commit. A nota so o
 * proprio trader le; nunca vai para a IA nem para o PostHog.
 */
export const TRADE_SETUPS = ['breakout', 'pullback', 'reversal', 'range', 'trend', 'news', 'other'] as const;
export const TRADE_EMOTIONS = ['calm', 'confident', 'anxious', 'fomo', 'frustrated'] as const;
export const TRADE_MISTAKES = ['early_exit', 'moved_stop', 'late_entry', 'oversized', 'no_stop', 'revenge', 'overtrading'] as const;
export const TRADE_NOTE_MAX = 1000;

export type TradeSetup = (typeof TRADE_SETUPS)[number];
export type TradeEmotion = (typeof TRADE_EMOTIONS)[number];
export type TradeMistake = (typeof TRADE_MISTAKES)[number];

export interface TradeNote {
  note: string | null;
  setup: string | null;
  emotion: string | null;
  mistakes: string[];
}

export const isEmptyTradeNote = (n: TradeNote | null | undefined): boolean =>
  !n || (!n.note && !n.setup && !n.emotion && n.mistakes.length === 0);
