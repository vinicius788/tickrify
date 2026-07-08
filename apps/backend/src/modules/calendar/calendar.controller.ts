import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EconomicCalendarService } from './calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: EconomicCalendarService) {}

  /**
   * Public endpoint — no auth required.
   * Returns high/medium impact economic events for the given symbol
   * within the next 24 hours (or a custom window).
   *
   * GET /api/calendar/events?symbol=XAUUSD
   * GET /api/calendar/events?symbol=EURUSD&hours=48
   */
  @Get('events')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getEvents(
    @Query('symbol') symbol = 'XAUUSD',
    @Query('hours') hours = '24',
  ) {
    const windowHours = Math.min(Math.max(parseInt(hours) || 24, 1), 168);
    const events = await this.calendarService.getEventsForSymbol(symbol, new Date(), windowHours);
    return { symbol: symbol.toUpperCase(), events };
  }
}
