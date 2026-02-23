import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AIAdapter } from './ai.adapter';
import { AnalyzeChartController } from './analyze-chart.controller';

@Module({
  controllers: [AiController, AnalyzeChartController],
  providers: [AiService, AIAdapter],
  exports: [AIAdapter],
})
export class AiModule {}
