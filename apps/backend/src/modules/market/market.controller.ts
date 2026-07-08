import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  /**
   * Public endpoint — no auth required.
   * Live crypto market context (funding rate, open interest, long/short, Fear & Greed).
   * For non-crypto symbols returns isCrypto=false with null metrics.
   *
   * GET /api/market/context?symbol=BTCUSD
   */
  @Get('context')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getContext(@Query('symbol') symbol = '') {
    return this.marketService.getContext(symbol);
  }
}
