import { __resetCrypto1mForTests, fetchCrypto1m } from './candles';

const START = Date.parse('2026-11-09T12:00:00Z');
const END = START + 3 * 60_000;
const kline = (ms: number) => [ms, '100', '110', '95', '105', '1', ms + 59_999];

function mockFetch(respond: (url: string) => { ok: boolean; body?: unknown }) {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    urls.push(String(url));
    const { ok, body } = respond(String(url));
    return { ok, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return urls;
}

describe('fetchCrypto1m', () => {
  const realFetch = global.fetch;
  beforeEach(() => __resetCrypto1mForTests());
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('Binance responde: um pedido so, de 1m, com a vela em formacao', async () => {
    const urls = mockFetch(() => ({ ok: true, body: [kline(START), kline(START + 60_000)] }));
    const candles = await fetchCrypto1m('BTCUSDT', START, END);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m');
    expect(urls[0]).toContain(`startTime=${START}`);
    expect(candles).toEqual([[START, 100, 110, 95, 105], [START + 60_000, 100, 110, 95, 105]]);
  });

  it('api.binance.com recusou (IP dos EUA): cai no vision e nas voltas seguintes vai direto a ele', async () => {
    const urls = mockFetch((url) => (url.includes('api.binance.com') ? { ok: false } : { ok: true, body: [kline(START)] }));
    await expect(fetchCrypto1m('BTCUSDT', START, END)).resolves.toHaveLength(1);
    expect(urls).toHaveLength(2);
    await fetchCrypto1m('ETHUSDT', START, END);
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain('data-api.binance.vision');
  });

  it('Binance fora: OKX, que traz a mais nova primeiro', async () => {
    const okxRow = (ms: number) => [String(ms), '1', '2', '0.5', '1.5', '1', '1', '1', '0'];
    const urls = mockFetch((url) => (url.includes('okx.com') ? { ok: true, body: { data: [okxRow(START + 60_000), okxRow(START)] } } : { ok: false }));
    const candles = await fetchCrypto1m('SOLUSDT', START, END);
    expect(urls[urls.length - 1]).toContain('instId=SOL-USDT&bar=1m');
    expect(candles?.map((c) => c[0])).toEqual([START, START + 60_000]);
  });

  it('nenhuma fonte ou ativo que nao e cripto: null, sem inventar preco', async () => {
    mockFetch(() => ({ ok: false }));
    await expect(fetchCrypto1m('BTCUSDT', START, END)).resolves.toBeNull();
    const urls = mockFetch(() => ({ ok: true, body: [] }));
    await expect(fetchCrypto1m('XAUUSD', START, END)).resolves.toBeNull();
    expect(urls).toHaveLength(0);
  });
});
