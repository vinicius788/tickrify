import { Module } from '@nestjs/common';
import { PromptController } from './prompt.controller';
import { PromptService } from './prompt.service';
import { PromptSyncService } from './prompt-sync.service';

@Module({
  controllers: [PromptController],
  providers: [PromptService, PromptSyncService],
  exports: [PromptService],
})
export class PromptModule {}

