import { Module } from '@nestjs/common';
import { EconomicCalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';

@Module({
  controllers: [CalendarController],
  providers: [EconomicCalendarService],
  exports: [EconomicCalendarService],
})
export class CalendarModule {}
