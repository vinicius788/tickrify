import { Module } from '@nestjs/common';
import { PromptController } from './prompt.controller';
import { PromptService } from './prompt.service';
import { PromptBuilderService } from './prompt-builder.service';
import { PromptSyncService } from './prompt-sync.service';

@Module({
  controllers: [PromptController],
  providers: [PromptService, PromptBuilderService, PromptSyncService],
  exports: [PromptService, PromptBuilderService],
})
export class PromptModule {}

