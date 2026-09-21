import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TicksController } from './ticks.controller';
import { TicksService } from './ticks.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TicksController],
  providers: [TicksService],
  exports: [TicksService],
})
export class TicksModule {}
