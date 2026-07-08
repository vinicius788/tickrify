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

interface DerivMetrics {
  fundingRatePercent: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  longShortRatio: number | null;
  longAccountPercent: number | null;
  shortAccountPercent: number | null;
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
    const { isCrypto, binanceSymbol, base: baseAsset } = normalizeToBinancePerp(symbol);
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

    // OKX é acessível de servidores nos EUA (onde o Render roda). Binance costuma
    // bloquear IPs dos EUA, então OKX é a fonte primária e Binance o fallback.
    const [okxDerivs, fng] = await Promise.all([
      this.fetchDerivsOkx(baseAsset || ''),
      this.getFearGreed(),
    ]);

    let derivs = okxDerivs;
    const okxEmpty =
      derivs.fundingRatePercent === null &&
      derivs.openInterest === null &&
      derivs.longShortRatio === null;
    if (okxEmpty) {
      derivs = await this.fetchDerivsBinance(binanceSymbol);
    }

    base.fundingRatePercent = derivs.fundingRatePercent;
    base.nextFundingTime = derivs.nextFundingTime;
    base.openInterest = derivs.openInterest;
    base.longShortRatio = derivs.longShortRatio;
    base.longAccountPercent = derivs.longAccountPercent;
    base.shortAccountPercent = derivs.shortAccountPercent;
    if (fng) {
      base.fearGreedValue = fng.value;
      base.fearGreedClassification = fng.classification;
    }

    this.cache.set(binanceSymbol, { data: base, fetchedAt: Date.now() });
    return base;
  }

  /** Derivativos via OKX (funding, OI, long/short). Nunca lança; nulls em falha. */
  private async fetchDerivsOkx(base: string): Promise<DerivMetrics> {
    const out: DerivMetrics = {
      fundingRatePercent: null,
      nextFundingTime: null,
      openInterest: null,
      longShortRatio: null,
      longAccountPercent: null,
      shortAccountPercent: null,
    };
    if (!base) {
      return out;
    }

    const inst = `${base}-USDT-SWAP`;
    const [fr, oi, lsr] = await Promise.all([
      this.safeJson<{ data?: Array<{ fundingRate?: string; nextFundingTime?: string }> }>(
        `https://www.okx.com/api/v5/public/funding-rate?instId=${inst}`,
      ),
      this.safeJson<{ data?: Array<{ oiCcy?: string; oi?: string }> }>(
        `https://www.okx.com/api/v5/public/open-interest?instId=${inst}`,
      ),
      this.safeJson<{ data?: Array<[string, string]> }>(
        `https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${base}&period=5m`,
      ),
    ]);

    const rate = Number(fr?.data?.[0]?.fundingRate);
    if (Number.isFinite(rate)) {
      out.fundingRatePercent = Math.round(rate * 100 * 10_000) / 10_000;
    }
    const nft = Number(fr?.data?.[0]?.nextFundingTime);
    if (Number.isFinite(nft) && nft > 0) {
      out.nextFundingTime = nft;
    }
    const oiv = Number(oi?.data?.[0]?.oiCcy);
    if (Number.isFinite(oiv)) {
      out.openInterest = oiv;
    }
    const ratio = Number(lsr?.data?.[0]?.[1]);
    if (Number.isFinite(ratio) && ratio > 0) {
      out.longShortRatio = Math.round(ratio * 100) / 100;
      out.longAccountPercent = Math.round((ratio / (1 + ratio)) * 1000) / 10;
      out.shortAccountPercent = Math.round((1 / (1 + ratio)) * 1000) / 10;
    }
    return out;
  }

  /** Derivativos via Binance (fallback). Nunca lança; nulls em falha. */
  private async fetchDerivsBinance(binanceSymbol: string | null): Promise<DerivMetrics> {
    const out: DerivMetrics = {
      fundingRatePercent: null,
      nextFundingTime: null,
      openInterest: null,
      longShortRatio: null,
      longAccountPercent: null,
      shortAccountPercent: null,
    };
    if (!binanceSymbol) {
      return out;
    }

    const [premium, oi, lsr] = await Promise.all([
      this.safeJson<{ lastFundingRate?: string; nextFundingTime?: number }>(
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binanceSymbol}`,
      ),
      this.safeJson<{ openInterest?: string }>(
        `https://fapi.binance.com/fapi/v1/openInterest?symbol=${binanceSymbol}`,
      ),
      this.safeJson<Array<{ longShortRatio?: string; longAccount?: string; shortAccount?: string }>>(
        `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${binanceSymbol}&period=5m&limit=1`,
      ),
    ]);

    const rate = Number(premium?.lastFundingRate);
    if (Number.isFinite(rate)) {
      out.fundingRatePercent = Math.round(rate * 100 * 10_000) / 10_000;
    }
    if (premium?.nextFundingTime != null && Number.isFinite(Number(premium.nextFundingTime))) {
      out.nextFundingTime = Number(premium.nextFundingTime);
    }
    const oiv = Number(oi?.openInterest);
    if (Number.isFinite(oiv)) {
      out.openInterest = oiv;
    }
    const lsrEntry = Array.isArray(lsr) ? lsr[0] : null;
    const ratio = Number(lsrEntry?.longShortRatio);
    if (Number.isFinite(ratio)) {
      out.longShortRatio = Math.round(ratio * 100) / 100;
    }
    const la = Number(lsrEntry?.longAccount);
    const sa = Number(lsrEntry?.shortAccount);
    if (Number.isFinite(la)) out.longAccountPercent = Math.round(la * 1000) / 10;
    if (Number.isFinite(sa)) out.shortAccountPercent = Math.round(sa * 1000) / 10;
    return out;
  }
}
