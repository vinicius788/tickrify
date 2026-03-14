import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AIAdapter } from './ai.adapter';
import { TicksModule } from '../ticks/ticks.module';

@Module({
  imports: [TicksModule],
  controllers: [AiController],
  providers: [AiService, AIAdapter],
  exports: [AIAdapter],
})
export class AiModule {}
