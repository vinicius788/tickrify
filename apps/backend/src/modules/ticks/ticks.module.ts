import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PaymentsModule } from '../payments/payments.module';
import { TicksController } from './ticks.controller';
import { TicksService } from './ticks.service';

@Module({
  imports: [DatabaseModule, PaymentsModule],
  controllers: [TicksController],
  providers: [TicksService],
  exports: [TicksService],
})
export class TicksModule {}
