import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { TrialAdminController } from './trial-admin.controller';

/** Admin do trial de 3 dias. O TrialService mora no AiModule (a analise usa). */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [TrialAdminController],
})
export class TrialModule {}
