import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { SupportController } from './support.controller';
import { SupportAdminController } from './support-admin.controller';
import { SupportService } from './support.service';

/** Chat com o fundador (12/10/2026). O AiModule entra so pelo `isFreeLocked` dos eventos. */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService],
})
export class SupportModule {}
