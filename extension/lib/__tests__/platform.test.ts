import { describe, expect, it } from 'vitest';
import { detectPlatform, readPageMeta } from '../platform';

describe('detectPlatform', () => {
  it('reconhece o grafico do TradingView', () => {
    expect(detectPlatform('https://www.tradingview.com/chart/aB3xY9/?symbol=FX%3AEURJPY')).toBe('tradingview');
    expect(detectPlatform('https://br.tradingview.com/chart/')).toBe('tradingview');
  });

  it('qualquer outra pagina e "other" (inclusive TradingView fora do grafico)', () => {
    expect(detectPlatform('https://www.tradingview.com/symbols/BTCUSD/')).toBe('other');
    expect(detectPlatform('https://www.binance.com/en/trade/BTC_USDT')).toBe('other');
    expect(detectPlatform('https://evil.com/tradingview.com/chart/')).toBe('other');
    expect(detectPlatform('not a url')).toBe('other');
  });
});

describe('readPageMeta', () => {
  it('TradingView: simbolo da URL e tempo grafico do cabecalho', () => {
    expect(
      readPageMeta({
        url: 'https://www.tradingview.com/chart/aB3xY9/?symbol=FX%3AEURJPY',
        title: 'EURJPY 179.391 ▲ +0.21% Unnamed',
        timeframeText: '5m',
      }),
    ).toEqual({ symbol: 'FX:EURJPY', timeframe: '5m' });
  });

  it('TradingView sem symbol na URL: usa o titulo', () => {
    expect(readPageMeta({ url: 'https://www.tradingview.com/chart/', title: 'BTCUSDT 83,670 ▲ +1.8%', timeframeText: '1h' })).toEqual({
      symbol: 'BTCUSDT',
      timeframe: '1h',
    });
  });

  it('tempo grafico em formatos do TradingView vira o formato curto', () => {
    const base = { url: 'https://www.tradingview.com/chart/?symbol=X', title: '' };
    expect(readPageMeta({ ...base, timeframeText: '15' }).timeframe).toBe('15m');
    expect(readPageMeta({ ...base, timeframeText: '240' }).timeframe).toBe('4h');
    expect(readPageMeta({ ...base, timeframeText: 'D' }).timeframe).toBe('1D');
    expect(readPageMeta({ ...base, timeframeText: '1W' }).timeframe).toBe('1W');
    expect(readPageMeta({ ...base, timeframeText: 'whatever' }).timeframe).toBeUndefined();
  });

  it('corretora: simbolo do titulo da aba quando parece um par', () => {
    expect(readPageMeta({ url: 'https://www.binance.com/en/trade/BTC_USDT', title: '83,670.00 | BTCUSDT | Binance Spot' })).toEqual({
      symbol: 'BTCUSDT',
    });
    expect(readPageMeta({ url: 'https://example.com', title: 'My dashboard' })).toEqual({});
  });

  it('corretora: par separado por espaco, barra, traco ou _ (titulo e URL reais da Binance, 06/10)', () => {
    expect(
      readPageMeta({ url: 'https://www.binance.com/en/trade/BTC_USDT?type=spot', title: '85,495.52 | BTC USDT | Bitcoin to USDT - Binance Spot' }),
    ).toEqual({ symbol: 'BTCUSDT' });
    expect(readPageMeta({ url: 'https://www.bybit.com/trade/spot/ETH/USDT', title: 'Trade' })).toEqual({ symbol: 'ETHUSDT' });
    expect(readPageMeta({ url: 'https://www.okx.com/trade-spot/sol-usdt', title: 'OKX' })).toEqual({ symbol: 'SOLUSDT' });
    expect(readPageMeta({ url: 'https://x.com/', title: 'EUR/USD 1.0912 | Broker' })).toEqual({ symbol: 'EURUSD' });
  });

  it('nunca devolve algo que o backend recusaria', () => {
    const meta = readPageMeta({ url: 'https://www.tradingview.com/chart/?symbol=%3Cscript%3E', title: '' });
    expect(meta.symbol).toBeUndefined();
  });
});
