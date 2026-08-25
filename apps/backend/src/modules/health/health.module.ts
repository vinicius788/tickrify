import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { OpsTokenGuard } from './ops-token.guard';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [CalendarModule],
  controllers: [HealthController],
  providers: [OpsTokenGuard],
})
export class HealthModule {}
