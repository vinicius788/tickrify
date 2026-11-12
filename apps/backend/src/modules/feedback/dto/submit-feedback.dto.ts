import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { FEEDBACK_RULES } from '../../../common/feedback-bonus';

/** Onde o pedido apareceu: inicio do painel, abaixo do resultado ou tela de limite. */
export const FEEDBACK_SOURCES = ['home', 'result', 'limit'] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

export class SubmitFeedbackDto {
  @IsString()
  @MinLength(FEEDBACK_RULES.minLength)
  @MaxLength(2000)
  message!: string;

  @IsIn(FEEDBACK_SOURCES as unknown as string[])
  source!: FeedbackSource;
}
