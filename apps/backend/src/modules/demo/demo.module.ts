import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { AiModule } from '../ai/ai.module';
import { PromptModule } from '../prompt/prompt.module';

/**
 * Demo anônima (sem cadastro) — Fase 0 da estratégia de ativação.
 * Reusa o motor de análise (AIAdapter) e o prompt server-side (PromptBuilder).
 */
@Module({
  imports: [AiModule, PromptModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
