import { Injectable, Logger } from '@nestjs/common';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EconomicEvent {
  title: string;
  country: string; // currency code: USD, EUR, GBP…
  date: string;    // ISO date YYYY-MM-DD
  time: string;    // "8:30am" or "All Day" or "Tentative"
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast?: string;
  previous?: string;
  /** Minutes until event (negative = already happened) */
  minutesUntil?: number;
}

interface FfEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: string;
  forecast?: string;
  previous?: string;
}

// ─── Symbol → currencies ─────────────────────────────────────────────────────

const SYMBOL_CURRENCIES: Record<string, string[]> = {
  // Forex majors
  EURUSD: ['EUR', 'USD'],
  GBPUSD: ['GBP', 'USD'],
  USDJPY: ['USD', 'JPY'],
  USDCHF: ['USD', 'CHF'],
  AUDUSD: ['AUD', 'USD'],
  NZDUSD: ['NZD', 'USD'],
  USDCAD: ['USD', 'CAD'],
  // Forex crosses
  EURGBP: ['EUR', 'GBP'],
  EURJPY: ['EUR', 'JPY'],
  GBPJPY: ['GBP', 'JPY'],
  AUDJPY: ['AUD', 'JPY'],
  EURAUD: ['EUR', 'AUD'],
  EURCHF: ['EUR', 'CHF'],
  GBPCHF: ['GBP', 'CHF'],
  // Metals / commodities
  XAUUSD: ['USD'],
  XAGUSD: ['USD'],
  USOIL:  ['USD'],
  UKOIL:  ['USD'],
  WTI:    ['USD'],
  // Indices
  US30:   ['USD'],
  US500:  ['USD'],
  NAS100: ['USD'],
  SPX500: ['USD'],
  GER40:  ['EUR'],
  UK100:  ['GBP'],
  JP225:  ['JPY'],
  // Crypto (most relevant = USD events)
  BTCUSDT: ['USD'],
  ETHUSDT: ['USD'],
  SOLUSDT: ['USD'],
  BTCUSD:  ['USD'],
  ETHUSD:  ['USD'],
};

function getCurrenciesForSymbol(symbol: string): string[] {
  const upper = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  if (SYMBOL_CURRENCIES[upper]) return SYMBOL_CURRENCIES[upper];
  // Fallback: try first 3 and last 3 chars
  if (upper.length >= 6) return [upper.slice(0, 3), upper.slice(3, 6)];
  return ['USD'];
}

// ─── ForexFactory fetch ───────────────────────────────────────────────────────

const FF_URLS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
];

interface CacheEntry {
  data: FfEvent[];
  fetchedAt: number;
}

@Injectable()
export class EconomicCalendarService {
  private readonly logger = new Logger(EconomicCalendarService.name);
  private cache: CacheEntry | null = null;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  private async fetchFfCalendar(): Promise<FfEvent[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.CACHE_TTL_MS) {
      return this.cache.data;
    }

    const results: FfEvent[] = [];
    for (const url of FF_URLS) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          const data = await res.json() as FfEvent[];
          results.push(...data);
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch ${url}: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.cache = { data: results, fetchedAt: now };
    return results;
  }

  /** Parse "8:30am" + date string → Date in UTC (assuming ET = UTC-5 for simplicity) */
  private parseEventDate(dateStr: string, timeStr: string): Date | null {
    try {
      // dateStr: "2026-06-05", timeStr: "8:30am" or "12:00pm" or "All Day" or "Tentative"
      if (!timeStr || timeStr === 'All Day' || timeStr === 'Tentative') {
        return new Date(`${dateStr}T12:00:00-05:00`); // noon ET as approximation
      }
      const match = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
      if (!match) return new Date(`${dateStr}T12:00:00-05:00`);
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const period = match[3].toLowerCase();
      if (period === 'pm' && hours !== 12) hours += 12;
      if (period === 'am' && hours === 12) hours = 0;
      return new Date(`${dateStr}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00-05:00`);
    } catch {
      return null;
    }
  }

  /**
   * Returns upcoming economic events relevant to the given symbol,
   * within the next 24 hours from the reference time.
   */
  async getEventsForSymbol(
    symbol: string,
    referenceTime: Date = new Date(),
    windowHours = 24,
  ): Promise<EconomicEvent[]> {
    const currencies = getCurrenciesForSymbol(symbol);
    const allEvents = await this.fetchFfCalendar();

    const windowMs = windowHours * 60 * 60 * 1000;
    const refMs = referenceTime.getTime();

    const events: EconomicEvent[] = allEvents
      .filter((e) => {
        // Only High and Medium impact
        const imp = e.impact?.toLowerCase();
        return imp === 'high' || imp === 'medium';
      })
      .filter((e) => currencies.includes(e.country?.toUpperCase()))
      .map((e) => {
        const eventDate = this.parseEventDate(e.date, e.time);
        const minutesUntil = eventDate
          ? Math.round((eventDate.getTime() - refMs) / 60_000)
          : null;
        return {
          title: e.title,
          country: (e.country || '').toUpperCase(),
          date: e.date,
          time: e.time,
          impact: (e.impact as EconomicEvent['impact']) || 'Medium',
          forecast: e.forecast,
          previous: e.previous,
          minutesUntil: minutesUntil ?? undefined,
        };
      })
      .filter((e) => {
        if (e.minutesUntil === undefined) return false;
        // Show events from -30min (just happened) to +windowHours
        return e.minutesUntil >= -30 && e.minutesUntil <= windowMs / 60_000;
      })
      .sort((a, b) => (a.minutesUntil ?? 0) - (b.minutesUntil ?? 0));

    return events;
  }
}
