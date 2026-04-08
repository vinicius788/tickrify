import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AIAdapter } from './ai.adapter';
import { TicksModule } from '../ticks/ticks.module';
import { PromptModule } from '../prompt/prompt.module';

@Module({
  imports: [TicksModule, PromptModule],
  controllers: [AiController],
  providers: [AiService, AIAdapter],
  exports: [AIAdapter],
})
export class AiModule {}
