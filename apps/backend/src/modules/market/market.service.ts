import { Injectable, Logger } from '@nestjs/common';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketContext {
  symbol: string;
  isCrypto: boolean;
  binanceSymbol: string | null;
  /** Funding rate as a percentage, e.g. 0.01 means 0.01%. */
  fundingRatePercent: number | null;
  nextFundingTime: number | null;
  /** Open interest in base-asset units (contracts). */
  openInterest: number | null;
  /** Long/short account ratio (>1 = more longs). */
  longShortRatio: number | null;
  longAccountPercent: number | null;
  shortAccountPercent: number | null;
  fearGreedValue: number | null;
  fearGreedClassification: string | null;
  fetchedAt: number;
}

interface CacheEntry {
  data: MarketContext;
  fetchedAt: number;
}

// Bases consideradas cripto (com derivativos perp na Binance). Forex/ouro ficam de fora.
const CRYPTO_BASES = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'MATIC',
  'DOT', 'LTC', 'TRX', 'SHIB', 'ATOM', 'UNI', 'APT', 'ARB', 'OP', 'SUI',
  'PEPE', 'NEAR', 'FIL', 'INJ', 'TIA', 'SEI', 'RNDR', 'BCH', 'ETC', 'XLM',
  'ICP', 'HBAR', 'IMX', 'AAVE', 'MKR', 'WIF', 'TON', 'FET', 'RUNE', 'ALGO',
]);

const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'PERP', 'USD'];

/** Normaliza um símbolo para o formato de perp da Binance e detecta se é cripto. Pura/testável. */
export function normalizeToBinancePerp(symbol: string): {
  isCrypto: boolean;
  binanceSymbol: string | null;
  base: string | null;
} {
  const clean = String(symbol || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!clean) {
    return { isCrypto: false, binanceSymbol: null, base: null };
  }

  let base = clean;
  for (const q of QUOTE_SUFFIXES) {
    if (clean.endsWith(q) && clean.length > q.length) {
      base = clean.slice(0, clean.length - q.length);
      break;
    }
  }

  if (!CRYPTO_BASES.has(base)) {
    return { isCrypto: false, binanceSymbol: null, base: null };
  }

  return { isCrypto: true, binanceSymbol: `${base}USDT`, base };
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 30_000;

  // Fear & Greed muda no máximo 1x/dia — cache mais longo.
  private fngCache: { value: number; classification: string; fetchedAt: number } | null = null;
  private readonly FNG_TTL_MS = 5 * 60_000;

  /** Faz um GET JSON com timeout curto; nunca lança — retorna null em qualquer falha. */
  private async safeJson<T>(url: string, timeoutMs = 3_000): Promise<T | null> {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'tickrify/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`market fetch failed (${url}): ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  private async getFearGreed(): Promise<{ value: number; classification: string } | null> {
    const now = Date.now();
    if (this.fngCache && now - this.fngCache.fetchedAt < this.FNG_TTL_MS) {
      return { value: this.fngCache.value, classification: this.fngCache.classification };
    }

    const data = await this.safeJson<{ data?: Array<{ value?: string; value_classification?: string }> }>(
      'https://api.alternative.me/fng/?limit=1',
    );
    const entry = data?.data?.[0];
    if (!entry) {
      return null;
    }

    const value = Number(entry.value);
    const classification = String(entry.value_classification || '').trim();
    if (!Number.isFinite(value)) {
      return null;
    }

    this.fngCache = { value, classification, fetchedAt: now };
    return { value, classification };
  }

  /**
   * Retorna o contexto de mercado ao vivo para o símbolo.
   * SEMPRE resolve (nunca lança). Para não-cripto, retorna isCrypto=false e métricas nulas.
   */
  async getContext(symbol: string): Promise<MarketContext> {
    const { isCrypto, binanceSymbol } = normalizeToBinancePerp(symbol);
    const base: MarketContext = {
      symbol: String(symbol || '').toUpperCase(),
      isCrypto,
      binanceSymbol,
      fundingRatePercent: null,
      nextFundingTime: null,
      openInterest: null,
      longShortRatio: null,
      longAccountPercent: null,
      shortAccountPercent: null,
      fearGreedValue: null,
      fearGreedClassification: null,
      fetchedAt: Date.now(),
    };

    if (!isCrypto || !binanceSymbol) {
      // Não-cripto (forex, ouro, ações): sem métricas de derivativos cripto.
      // O Fear & Greed é um índice do mercado cripto, então não se aplica aqui.
      return base;
    }

    const cached = this.cache.get(binanceSymbol);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const [premium, oi, lsr, fng] = await Promise.all([
      this.safeJson<{ lastFundingRate?: string; nextFundingTime?: number }>(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`,
      ),
      this.safeJson<{ openInterest?: string }>(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSymbol}`,
      ),
      this.safeJson<Array<{ longShortRatio?: string; longAccount?: string; shortAccount?: string }>>(
        `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${binanceSymbol}&period=5m&limit=1`,
      ),
      this.getFearGreed(),
    ]);

    if (premium?.lastFundingRate != null) {
      const rate = Number(premium.lastFundingRate);
      if (Number.isFinite(rate)) {
        base.fundingRatePercent = Math.round(rate * 100 * 10_000) / 10_000; // % com 4 casas
      }
    }
    if (premium?.nextFundingTime != null && Number.isFinite(Number(premium.nextFundingTime))) {
      base.nextFundingTime = Number(premium.nextFundingTime);
    }
    if (oi?.openInterest != null) {
      const v = Number(oi.openInterest);
      if (Number.isFinite(v)) {
        base.openInterest = v;
      }
    }
    const lsrEntry = Array.isArray(lsr) ? lsr[0] : null;
    if (lsrEntry?.longShortRatio != null) {
      const v = Number(lsrEntry.longShortRatio);
      if (Number.isFinite(v)) {
        base.longShortRatio = Math.round(v * 100) / 100;
      }
      const la = Number(lsrEntry.longAccount);
      const sa = Number(lsrEntry.shortAccount);
      if (Number.isFinite(la)) base.longAccountPercent = Math.round(la * 1000) / 10;
      if (Number.isFinite(sa)) base.shortAccountPercent = Math.round(sa * 1000) / 10;
    }
    if (fng) {
      base.fearGreedValue = fng.value;
      base.fearGreedClassification = fng.classification;
    }

    this.cache.set(binanceSymbol, { data: base, fetchedAt: Date.now() });
    return base;
  }
}
