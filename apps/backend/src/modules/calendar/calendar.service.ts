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

export interface CalendarQueryResult {
  events: EconomicEvent[];
  /**
   * true quando a busca na fonte (ForexFactory) falhou nesta tentativa —
   * o array pode estar vazio, servido de cache velho, ou os dois. Quem
   * consome isto NUNCA deve tratar degraded=true como "sem notícia
   * confirmada"; é "não sabemos", que é uma coisa diferente.
   */
  degraded: boolean;
}

export interface CalendarFeedStatus {
  status: 'ok' | 'degraded' | 'unavailable' | 'unknown';
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  cachedEvents: number;
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

  // Diagnóstico exposto via getFeedStatus() (consumido pelo /health) — nunca
  // usado para decidir nada de produto, só para o operador enxergar quando a
  // fonte externa está fora do ar. Achado em 25/08/2026: sem isso a falha era
  // 100% silenciosa — o cache gravava vazio e a tela mostrava "sem eventos"
  // como se fosse dado real.
  private lastSuccessAt: number | null = null;
  private lastAttemptAt: number | null = null;
  private lastAttemptFailed = false;

  private async fetchFfCalendar(): Promise<{ data: FfEvent[]; degraded: boolean }> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.CACHE_TTL_MS) {
      return { data: this.cache.data, degraded: false };
    }

    this.lastAttemptAt = now;
    const results: FfEvent[] = [];
    let anySucceeded = false;

    for (const url of FF_URLS) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          this.logger.warn(`Calendar fetch ${url} -> HTTP ${res.status} ${res.statusText}`);
          continue;
        }
        const text = await res.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          // Fonte bloqueando por IP/rate-limit costuma devolver HTML (challenge
          // page) com status 200 — .json() direto mascarava isso como erro
          // genérico de rede. Logar os primeiros bytes ajuda a distinguir
          // bloqueio de indisponibilidade real.
          this.logger.warn(
            `Calendar fetch ${url} devolveu corpo não-JSON (${text.length} bytes): "${text.slice(0, 120).replace(/\s+/g, ' ')}"`,
          );
          continue;
        }
        if (!Array.isArray(data)) {
          this.logger.warn(`Calendar fetch ${url} devolveu JSON que não é array`);
          continue;
        }
        results.push(...(data as FfEvent[]));
        anySucceeded = true;
      } catch (err) {
        this.logger.warn(`Calendar fetch ${url} falhou: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (anySucceeded) {
      this.cache = { data: results, fetchedAt: now };
      this.lastSuccessAt = now;
      this.lastAttemptFailed = false;
      return { data: results, degraded: false };
    }

    // Todas as fontes falharam nesta tentativa. Bug real encontrado em
    // 25/08/2026: a versão anterior gravava `this.cache = { data: [], ... }`
    // aqui mesmo em falha total — um array vazio ficava servido por 1h
    // como se fosse "nenhum evento agendado", quando na verdade era "não
    // conseguimos checar". NUNCA sobrescrever o cache num ciclo sem sucesso.
    this.lastAttemptFailed = true;
    const cacheAgeMin = this.cache ? Math.round((now - this.cache.fetchedAt) / 60_000) : null;
    this.logger.error(
      `Calendar: as ${FF_URLS.length} fontes falharam nesta tentativa. ` +
        (this.cache
          ? `Servindo cache de ${cacheAgeMin}min atrás (degraded=true).`
          : 'Sem cache anterior — devolvendo vazio (degraded=true).'),
    );
    return { data: this.cache?.data ?? [], degraded: true };
  }

  /** Parse event date — ForexFactory now returns full ISO timestamps in the date field */
  private parseEventDate(dateStr: string, timeStr?: string): Date | null {
    try {
      // New FF format: date is already a full ISO timestamp e.g. "2026-06-02T10:00:00-04:00"
      if (dateStr && dateStr.includes('T')) {
        const d = new Date(dateStr);
        return Number.isFinite(d.getTime()) ? d : null;
      }

      // Legacy format: separate date "2026-06-05" + time "8:30am"
      if (!timeStr || timeStr === 'All Day' || timeStr === 'Tentative') {
        return new Date(`${dateStr}T12:00:00-05:00`);
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
  ): Promise<CalendarQueryResult> {
    const currencies = getCurrenciesForSymbol(symbol);
    const { data: allEvents, degraded } = await this.fetchFfCalendar();

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

    return { events, degraded };
  }

  /** Estado do feed para /health — nunca lança, best-effort. */
  getFeedStatus(): CalendarFeedStatus {
    const status: CalendarFeedStatus['status'] = this.lastAttemptFailed
      ? this.cache
        ? 'degraded'
        : 'unavailable'
      : this.lastSuccessAt
        ? 'ok'
        : 'unknown';
    return {
      status,
      lastSuccessAt: this.lastSuccessAt ? new Date(this.lastSuccessAt).toISOString() : null,
      lastAttemptAt: this.lastAttemptAt ? new Date(this.lastAttemptAt).toISOString() : null,
      cachedEvents: this.cache?.data.length ?? 0,
    };
  }
}
