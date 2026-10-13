import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { SetupsController } from './setups.controller';
import { SetupsService } from './setups.service';
import { TrialService } from './trial.service';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';
import { AIAdapter } from './ai.adapter';
import { TicksModule } from '../ticks/ticks.module';
import { PromptModule } from '../prompt/prompt.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [TicksModule, PromptModule, PaymentsModule],
  controllers: [AiController, SetupsController, TradesController],
  providers: [AiService, AIAdapter, SetupsService, TrialService, TradesService],
  exports: [AIAdapter, AiService, TrialService],
})
export class AiModule {}
