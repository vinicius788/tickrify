import { canonicalFxPair } from '../src/common/utils/analysis-normalizer';
import { normalizeToBinancePerp } from '../src/modules/market/market.service';

/**
 * Spread tipico de conta de varejo, em preco: ouro 0,30; prata 0,03; forex
 * 1,2 pip nos majors e 2 pips nos cruzados; BTC e ETH 0,02% do preco; outras
 * cripto 0,05%.
 */
export function spreadOf(symbol: string, price: number): number {
  const fx = canonicalFxPair(symbol);
  if (fx === 'XAUUSD') return 0.3;
  if (fx === 'XAGUSD') return 0.03;
  if (fx) {
    const major = ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY'].includes(fx);
    return (fx.endsWith('JPY') ? 0.01 : 0.0001) * (major ? 1.2 : 2);
  }
  const base = normalizeToBinancePerp(symbol).base;
  return price * (base === 'BTC' || base === 'ETH' ? 0.0002 : 0.0005);
}

export function netReturn(symbol: string, price: number, stop: number, tp1: number, outcome: 'WIN' | 'LOSS' | 'TIMEOUT'): number {
  const risk = Math.abs(price - stop);
  const gross = outcome === 'WIN' ? Math.abs(tp1 - price) / risk : outcome === 'LOSS' ? -1 : 0;
  return gross - spreadOf(symbol, price) / risk;
}
