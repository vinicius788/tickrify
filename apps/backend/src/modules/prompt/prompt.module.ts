import { Module } from '@nestjs/common';
import { PromptController } from './prompt.controller';
import { PromptService } from './prompt.service';
import { PromptBuilderService } from './prompt-builder.service';

@Module({
  controllers: [PromptController],
  providers: [PromptService, PromptBuilderService],
  exports: [PromptService, PromptBuilderService],
})
export class PromptModule {}

