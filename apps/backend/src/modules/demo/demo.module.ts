import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { AiModule } from '../ai/ai.module';

/**
 * Demo anônima (sem cadastro) — Fase 0 da estratégia de ativação.
 * Reusa o motor de análise (AIAdapter) e o montador do prompt (buildAnalysisPrompt).
 */
@Module({
  imports: [AiModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
