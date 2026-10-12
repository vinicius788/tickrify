import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { SetupsController } from './setups.controller';
import { SetupsService } from './setups.service';
import { AIAdapter } from './ai.adapter';
import { TicksModule } from '../ticks/ticks.module';
import { PromptModule } from '../prompt/prompt.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [TicksModule, PromptModule, PaymentsModule],
  controllers: [AiController, SetupsController],
  providers: [AiService, AIAdapter, SetupsService],
  exports: [AIAdapter],
})
export class AiModule {}
