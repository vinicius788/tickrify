import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * Chat com o fundador (12/10/2026). Decorator em TODO campo (ValidationPipe com
 * `forbidNonWhitelisted`). A conversa e sempre a do token: nenhum DTO do
 * usuario aceita id de conversa ou de usuario.
 */
export const CHAT_BODY_MAX = 2000;
export const CHAT_ID_PATTERN = /^[a-z0-9-]{10,40}$/i;

export class SendChatMessageDto {
  @IsString()
  @MaxLength(CHAT_BODY_MAX)
  body!: string;
}

export class ChatMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Id da mensagem mais antiga ja recebida: a pagina seguinte vem antes dela. */
  @IsOptional()
  @IsString()
  @Matches(CHAT_ID_PATTERN)
  cursor?: string;
}

export class AdminChatStatusDto {
  @IsIn(['open', 'closed'])
  status!: 'open' | 'closed';
}

/** "Start conversation": o fundador puxa assunto com um usuario pelo e-mail. */
export class AdminStartChatDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(CHAT_BODY_MAX)
  body!: string;
}
