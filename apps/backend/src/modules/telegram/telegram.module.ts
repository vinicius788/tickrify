import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

/** Alerta de nivel pelo Telegram (10/11/2026). O envio roda no worker (telegram-alert.ts). */
@Module({
  imports: [AuthModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
