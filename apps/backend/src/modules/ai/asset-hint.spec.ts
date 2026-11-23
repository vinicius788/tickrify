import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { AIAdapter, applyAssetHint } from './ai.adapter';
import { buildClientContext } from './ai.service';
import { loadAssetHint } from './watch-assets';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

const hint = { symbol: 'XAUUSD', timeframe: '5m' };
const read = (symbol: string, timeframe: string) => ({ extracted: { symbol, timeframe, lastPrice: 4100 }, failure: null } as const);
const failed = { extracted: null, failure: 'symbol_unreadable' } as const;

describe('dica de ativo: so preenche o que a imagem nao mostrou', () => {
  it('sem dica, a leitura passa igual', () => {
    expect(applyAssetHint(read('BTCUSDT', '15m'), null)).toEqual({ ...read('BTCUSDT', '15m'), hinted: undefined });
    expect(applyAssetHint(failed, undefined)).toEqual({ ...failed, hinted: undefined });
  });

  it('o que a imagem mostra nunca e trocado pela dica', () => {
    const out = applyAssetHint(read('BTCUSDT', '15m'), hint);
    expect(out.extracted).toEqual({ symbol: 'BTCUSDT', timeframe: '15m', lastPrice: 4100 });
    expect(out.hinted).toBeUndefined();
  });

  it('leitura falhou (ilegivel ou tempo esgotado): ativo e tempo grafico vem da dica, sem preco lido', () => {
    expect(applyAssetHint(failed, hint)).toEqual({ extracted: { symbol: 'XAUUSD', timeframe: '5m', lastPrice: null }, failure: null, hinted: 'both' });
    expect(applyAssetHint({ extracted: null, failure: 'symbol_timeout' }, hint).hinted).toBe('both');
  });

  it('ativo vazio com tempo lido: so o ativo vem da dica', () => {
    const out = applyAssetHint(read('  ', '1h'), hint);
    expect(out.extracted).toEqual({ symbol: 'XAUUSD', timeframe: '1h', lastPrice: 4100 });
    expect(out.hinted).toBe('symbol');
  });

  it('ativo lido com tempo ilegivel: so o tempo grafico vem da dica', () => {
    const out = applyAssetHint(read('BTCUSDT', 'auto'), hint);
    expect(out.extracted).toEqual({ symbol: 'BTCUSDT', timeframe: '5m', lastPrice: 4100 });
    expect(out.hinted).toBe('timeframe');
  });

  it('dica sem tempo grafico nao inventa um', () => {
    const out = applyAssetHint(read('BTCUSDT', 'auto'), { symbol: 'XAUUSD', timeframe: null });
    expect(out.extracted?.timeframe).toBe('auto');
    expect(out.hinted).toBeUndefined();
  });
});

describe('dica de ativo no adapter: as velas do ativo indicado entram quando a leitura falha', () => {
  const make = (extract: () => Promise<unknown>) => {
    const adapter: any = new AIAdapter();
    adapter.extractSymbol = jest.fn(extract);
    adapter.buildCandleBlocks = jest.fn(async (e: { symbol: string; timeframe: string }) => ({
      sym: e.symbol, interval: e.timeframe, isCrypto: false, assetClass: 'metal', candleBlock: 'REAL DATA', staleReason: null, staleBlock: null,
      candleCoverage: 'injected', stats: { v: 1, symbol: e.symbol, interval: e.timeframe, coverage: 'injected', numbers: null },
    }));
    adapter.buildFxEnrichment = jest.fn(async () => null);
    adapter.buildCryptoEnrichment = jest.fn(async () => null);
    return adapter;
  };

  it('leitura ilegivel sem dica: sem velas, como sempre', async () => {
    const adapter = make(async () => null);
    const out = await adapter.buildQuickGrounding('img');
    expect(out.candles).toBe('symbol_unreadable');
    expect(adapter.buildCandleBlocks).not.toHaveBeenCalled();
  });

  it('leitura ilegivel com dica: busca as velas do ativo indicado e marca a origem', async () => {
    const adapter = make(async () => null);
    const out = await adapter.buildQuickGrounding('img', hint);
    expect(adapter.buildCandleBlocks).toHaveBeenCalledWith({ symbol: 'XAUUSD', timeframe: '5m', lastPrice: null });
    expect(out.candles).toBe('injected');
    expect(out.stats).toMatchObject({ symbol: 'XAUUSD', interval: '5m', hinted: 'both' });
  });

  it('leitura boa com dica de outro ativo: vale a imagem e nada e marcado', async () => {
    const adapter = make(async () => ({ symbol: 'BTCUSDT', timeframe: '15m', lastPrice: 74000 }));
    const out = await adapter.buildQuickGrounding('img', hint);
    expect(adapter.buildCandleBlocks).toHaveBeenCalledWith({ symbol: 'BTCUSDT', timeframe: '15m', lastPrice: 74000 });
    expect(out.stats.hinted).toBeUndefined();
  });
});

describe('dica de ativo: do corpo do pedido ao banco', () => {
  it('painel web com ativo valido grava a dica normalizada; sem fonte de preco, nada', () => {
    expect(buildClientContext({ hintSymbol: 'XAUUSDm', hintTimeframe: '5m' })).toEqual({ source: 'web', hintSymbol: 'XAUUSD', hintTimeframe: '5m' });
    expect(buildClientContext({ source: 'web', hintSymbol: 'btcusd' })).toEqual({ source: 'web', hintSymbol: 'BTCUSDT' });
    expect(buildClientContext({ hintSymbol: 'NAS100', hintTimeframe: '5m' })).toBeNull();
    expect(buildClientContext({ hintTimeframe: '5m' })).toBeNull();
  });

  it('a extensao continua como era: a dica nao entra no contexto dela', () => {
    expect(buildClientContext({ source: 'extension', chartSymbol: 'OANDA:XAUUSD', hintSymbol: 'XAUUSD' })).toEqual({ source: 'extension', chartSymbol: 'OANDA:XAUUSD' });
  });

  it('relida do banco: valida de novo o ativo e o tempo grafico; erro de banco vira sem dica', async () => {
    const prisma = (rows: unknown) => ({ $queryRaw: jest.fn(async () => rows) }) as any;
    expect(await loadAssetHint(prisma([{ symbol: 'XAUUSD', timeframe: '5m' }]), 'a1')).toEqual({ symbol: 'XAUUSD', timeframe: '5m' });
    expect(await loadAssetHint(prisma([{ symbol: 'XAUUSD', timeframe: '7m' }]), 'a1')).toEqual({ symbol: 'XAUUSD', timeframe: null });
    expect(await loadAssetHint(prisma([{ symbol: 'NAS100', timeframe: '5m' }]), 'a1')).toBeNull();
    expect(await loadAssetHint(prisma([]), 'a1')).toBeNull();
    expect(await loadAssetHint({ $queryRaw: jest.fn(async () => { throw new Error('coluna'); }) } as any, 'a1')).toBeNull();
  });
});

describe('CreateAnalysisDto: dica contra o ValidationPipe real', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: CreateAnalysisDto });

  it('aceita a dica e o pedido sem ela', async () => {
    await expect(run({ hintSymbol: 'XAUUSD', hintTimeframe: '5m' })).resolves.toMatchObject({ hintSymbol: 'XAUUSD' });
    await expect(run({})).resolves.toBeDefined();
  });

  it('recusa texto estranho e tempo grafico fora da lista', async () => {
    await expect(run({ hintSymbol: '<b>x</b>' })).rejects.toBeDefined();
    await expect(run({ hintSymbol: 'XAUUSD', hintTimeframe: '2m' })).rejects.toBeDefined();
  });
});

describe('calendario na analise rapida (fixo)', () => {
  const flags = jest.requireActual('../../common/flags/feature-flags') as typeof import('../../common/flags/feature-flags');
  const make = (opts: { stale?: boolean } = {}) => {
    const adapter: any = new AIAdapter();
    adapter.extractSymbol = jest.fn(async () => ({ symbol: 'XAUUSD', timeframe: '5m', lastPrice: 4100 }));
    adapter.buildCandleBlocks = jest.fn(async (e: { symbol: string; timeframe: string }) => ({
      sym: e.symbol, interval: e.timeframe, isCrypto: false, assetClass: 'metal', candleBlock: 'REAL DATA',
      staleReason: opts.stale ? 'old print' : null, staleBlock: opts.stale ? 'STALE' : null,
      candleCoverage: 'injected', stats: { v: 1, symbol: e.symbol, interval: e.timeframe, coverage: 'injected', numbers: null },
    }));
    adapter.buildFxEnrichment = jest.fn(async () => null);
    adapter.buildCalendarEnrichment = jest.fn(async () => ({ block: '# REAL DATA: ECONOMIC CALENDAR', status: 'events_injected' }));
    return adapter;
  };
  const withFlag = (on: boolean) =>
    jest.spyOn(flags, 'flagBool').mockImplementation((key: string) => (key === 'ENABLE_MARKET_ENRICHMENT' ? on : true));
  afterEach(() => jest.restoreAllMocks());

  it('contexto de mercado desligado: nem busca o calendario e o bloco so tem as velas', async () => {
    withFlag(false);
    const adapter = make();
    const out = await adapter.buildQuickGrounding('img');
    expect(adapter.buildCalendarEnrichment).not.toHaveBeenCalled();
    expect(out.block).toBe('REAL DATA');
    expect(out.calendar).toBe('not_attempted');
  });

  it('o bloco do calendario entra depois das velas e a cobertura diz o que foi entregue', async () => {
    withFlag(true);
    const adapter = make();
    const out = await adapter.buildQuickGrounding('img');
    expect(adapter.buildCalendarEnrichment).toHaveBeenCalledWith('XAUUSD');
    expect(out.block).toBe('REAL DATA\n\n# REAL DATA: ECONOMIC CALENDAR');
    expect(out.calendar).toBe('events_injected');
  });

  it('com print velho: os eventos de agora ficam fora', async () => {
    withFlag(true);
    const out = await make({ stale: true }).buildQuickGrounding('img');
    expect(out.block).toBe('REAL DATA\n\nSTALE');
    expect(out.calendar).toBe('not_attempted');
  });

  it('ligada com a fonte fora do ar: nenhum bloco, e a cobertura registra a falha', async () => {
    withFlag(true);
    const adapter = make();
    adapter.buildCalendarEnrichment = jest.fn(async () => ({ block: null, status: 'source_degraded' }));
    const out = await adapter.buildQuickGrounding('img');
    expect(out.block).toBe('REAL DATA');
    expect(out.calendar).toBe('source_degraded');
  });
});
