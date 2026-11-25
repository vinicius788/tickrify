import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * "Ask about this analysis": so o texto da pergunta. O servico confere de novo
 * o tamanho depois de limpar os espacos. Decorator em TODO campo
 * (ValidationPipe com `forbidNonWhitelisted`).
 */
export class AskQuestionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question!: string;
}
