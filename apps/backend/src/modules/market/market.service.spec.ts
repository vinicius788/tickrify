import { normalizeToBinancePerp } from './market.service';

describe('normalizeToBinancePerp', () => {
  it('maps common crypto symbols to Binance perp format', () => {
    expect(normalizeToBinancePerp('BTCUSD')).toEqual({ isCrypto: true, binanceSymbol: 'BTCUSDT', base: 'BTC' });
    expect(normalizeToBinancePerp('BTCUSDT')).toEqual({ isCrypto: true, binanceSymbol: 'BTCUSDT', base: 'BTC' });
    expect(normalizeToBinancePerp('BTC')).toEqual({ isCrypto: true, binanceSymbol: 'BTCUSDT', base: 'BTC' });
    expect(normalizeToBinancePerp('ETH/USDT')).toEqual({ isCrypto: true, binanceSymbol: 'ETHUSDT', base: 'ETH' });
    expect(normalizeToBinancePerp('sol-usd')).toEqual({ isCrypto: true, binanceSymbol: 'SOLUSDT', base: 'SOL' });
  });

  it('treats forex and metals as non-crypto (no Binance call)', () => {
    expect(normalizeToBinancePerp('XAUUSD')).toEqual({ isCrypto: false, binanceSymbol: null, base: null });
    expect(normalizeToBinancePerp('EURUSD')).toEqual({ isCrypto: false, binanceSymbol: null, base: null });
    expect(normalizeToBinancePerp('USDJPY')).toEqual({ isCrypto: false, binanceSymbol: null, base: null });
  });

  it('handles empty / junk input safely', () => {
    expect(normalizeToBinancePerp('')).toEqual({ isCrypto: false, binanceSymbol: null, base: null });
    expect(normalizeToBinancePerp('   ')).toEqual({ isCrypto: false, binanceSymbol: null, base: null });
    expect(normalizeToBinancePerp('UNKNOWN')).toEqual({ isCrypto: false, binanceSymbol: null, base: null });
  });
});
