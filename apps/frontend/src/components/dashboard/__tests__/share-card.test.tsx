import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIAnalysisResponse, TradeView } from '@/lib/api';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import {
  ANIMATION_MS,
  SHARE_FORMAT_ORDER,
  buildReadCard,
  buildReadShareText,
  buildTradeCard,
  buildTradeShareText,
  cardText,
  formatCardDate,
  hasPriceLevel,
  heroText,
  hideAmountState,
  pickRead,
  readSentences,
  renderShareFrame,
  wrapExact,
  type ReadShareData,
  type ShareAssets,
  type ShareCardModel,
  type TradeShareData,
} from '@/lib/share-card';

const getTrade = vi.fn<(id: string) => Promise<TradeView>>();
let analyses: AIAnalysisResponse[] = [];

vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: { id: 'user_1' } }) }));
vi.mock('@/hooks/useAnalyses', () => ({
  useAnalyses: () => ({ analyses, loading: false, hasMore: false, loadingMore: false, loadMore: vi.fn(), refetch: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useAPIClient: () => ({ setOutcome: vi.fn(), setFavorite: vi.fn(), getTrade }),
}));

/**
 * O card sai da tela e circula sozinho. O que falha em silencio e travado aqui:
 * frase cortada ou vazando (Canvas nao da erro), preco de entrada/stop/alvo
 * entrando no card de leitura (vira sinal) e valor inventado no card de trade.
 */

/** 10px por caractere: nao depende de fonte nem de DOM. */
const measure = (text: string) => text.length * 10;

const read: ReadShareData = {
  symbol: 'BTCUSDT',
  timeframe: '4H',
  scenario: 'BULLISH',
  action: 'BUY',
  state: 'ENTER_NOW',
  read: 'Buyers reclaimed the 4H order block with volume. Entry at 67,250 with stop at 66,800. Momentum favors continuation.',
  readIsEnglish: true,
  trendStrength: 'moderate',
  date: new Date('2026-11-03T14:28:00Z'),
};

const trade: TradeShareData = {
  symbol: 'XAUUSD',
  side: 'buy',
  verdict: 'TP1',
  pnlAmount: 1292,
  pnlPercent: null,
  entryPrice: null,
  closedAt: new Date('2026-11-02T18:05:00Z'),
};

function modelText(model: ShareCardModel): string {
  return [model.date, model.symbol, model.tag, model.hero, model.status, model.secondary, ...model.read, model.footerUrl, ...model.footerLines, ...model.stats.flatMap((s) => [s.label, s.value])]
    .filter(Boolean)
    .join(' | ');
}

describe('texto do card', () => {
  it('tira travessao e emoji', () => {
    expect(cardText('Strong trend — buyers in control 🚀')).toBe('Strong trend, buyers in control');
  });

  it('reconhece frase com preco ou nivel', () => {
    expect(hasPriceLevel('Entry at 67,250 with stop at 66,800.')).toBe(true);
    expect(hasPriceLevel('Price is testing 1.0850 resistance.')).toBe(true);
    expect(hasPriceLevel('Wait for TP1 at 3 ATR.')).toBe(true);
    expect(hasPriceLevel('Buyers reclaimed the 4H order block.')).toBe(false);
  });

  it('separa frases inteiras e descarta as que citam preco', () => {
    expect(readSentences(read.read)).toEqual([
      'Buyers reclaimed the 4H order block with volume.',
      'Momentum favors continuation.',
    ]);
    // O ponto decimal nao quebra a frase no meio.
    expect(readSentences('Price sits near 1.0850 support. Trend is up.')).toEqual(['Trend is up.']);
  });

  it('nunca trunca: frase que nao cabe devolve null', () => {
    expect(wrapExact(measure, 'alpha beta gamma', 100, 2)).toEqual(['alpha beta', 'gamma']);
    expect(wrapExact(measure, 'alpha beta gamma delta epsilon zeta', 100, 2)).toBeNull();
    expect(wrapExact(measure, 'supercalifragilistic', 100, 2)).toBeNull();
  });

  it('cai para a proxima frase quando a primeira nao cabe em 2 linhas', () => {
    const picked = pickRead(() => measure, ['one two three four five six seven eight nine ten', 'short one.'], 20, 100, 2);
    expect(picked?.lines).toEqual(['short one.']);
  });

  it('data em UTC', () => {
    expect(formatCardDate(new Date('2026-11-03T02:07:00-03:00'))).toBe('03 NOV 2026  05:07 UTC');
    expect(formatCardDate(null)).toBeNull();
  });
});

describe('card de leitura', () => {
  it('setup comprador: fundo bull e BULLISH', () => {
    const model = buildReadCard(read);
    expect(model.theme).toBe('bull');
    expect(model.hero).toBe('BULLISH');
    expect(model.status).toBe('Setup identified');
    expect(model.tag).toBe('4H');
  });

  it('setup vendedor: fundo bear e BEARISH', () => {
    const model = buildReadCard({ ...read, scenario: 'BEARISH', action: 'SELL' });
    expect(model.theme).toBe('bear');
    expect(model.hero).toBe('BEARISH');
  });

  it('WATCH com cenario comprador continua no fundo watch, com o cenario como linha secundaria', () => {
    const model = buildReadCard({ ...read, action: 'HOLD', state: 'WATCH' });
    expect(model.theme).toBe('watch');
    expect(model.hero).toBe('WATCH');
    expect(model.secondary).toBe('Scenario: Bullish');
  });

  it('sem trade: NEUTRAL no fundo watch', () => {
    const model = buildReadCard({ ...read, scenario: 'NEUTRAL', action: 'WAIT', state: 'NO_TRADE' });
    expect(model.theme).toBe('watch');
    expect(model.hero).toBe('NEUTRAL');
    expect(model.secondary).toBeNull();
  });

  it('nunca leva entrada, stop ou alvo', () => {
    const text = modelText(buildReadCard(read));
    for (const level of ['67,250', '66,800', '67250', '66800']) expect(text).not.toContain(level);
  });

  it('leitura fora do ingles usa so a frase montada com a forca da tendencia e o estado', () => {
    const model = buildReadCard({ ...read, read: 'Compradores retomaram o order block.', readIsEnglish: false });
    expect(model.read).toEqual(['Moderate trend. The plan passed the risk checks.']);
  });

  it('toda frase da IA com preco: cai na frase montada, sem repetir a direcao', () => {
    const model = buildReadCard({ ...read, action: 'HOLD', state: 'WATCH', read: 'Watch 77800-77820 for rejection. Close below 77820 turns it into a trade.' });
    expect(model.read).toEqual(['Moderate trend. Price is not at the level yet.']);
    expect(buildReadCard({ ...read, scenario: 'NEUTRAL', action: 'WAIT', state: 'NO_TRADE', read: '' }).read).toEqual([
      'No clear direction. No setup worth the risk on this chart.',
    ]);
    expect(buildReadCard({ ...read, trendStrength: null, read: '' }).read).toEqual(['The plan passed the risk checks.']);
  });

  it('texto do post sem numero de performance', () => {
    const text = buildReadShareText(read).toLowerCase();
    expect(text).toContain('read bullish and outlined a buy at market');
    expect(text).toContain('not a signal');
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(text).not.toMatch(/win rate|guarantee|profit/);
  });
});

describe('card de trade', () => {
  it('lucro: fundo bull e valor com sinal', () => {
    const model = buildTradeCard(trade, false);
    expect(model.theme).toBe('bull');
    expect(model.hero).toBe('+1,292.00');
    expect(model.tag).toBe('LONG');
    expect(model.date).toBe('02 NOV 2026  18:05 UTC');
  });

  it('perda: fundo bear', () => {
    const model = buildTradeCard({ ...trade, verdict: 'SL', side: 'sell', pnlAmount: -471 }, false);
    expect(model.theme).toBe('bear');
    expect(model.hero).toBe('−471.00');
    expect(model.tag).toBe('SHORT');
  });

  it('zero: fundo watch', () => {
    expect(buildTradeCard({ ...trade, pnlAmount: 0 }, false).theme).toBe('watch');
  });

  it('valor grande cabe no formato do numero', () => {
    expect(buildTradeCard({ ...trade, pnlAmount: 1234567.891 }, false).hero).toBe('+1,234,567.89');
  });

  it('so mostra entrada quando o trader digitou; nada estimado', () => {
    expect(buildTradeCard(trade, false).stats).toEqual([]);
    expect(buildTradeCard({ ...trade, entryPrice: 4180.5 }, false).stats).toEqual([{ label: 'Entry', value: '4,180.50' }]);
  });

  it('esconder valor: troca pelo % quando existe; sem retorno, fica desligado', () => {
    expect(hideAmountState(trade)).toBe('no_return');
    expect(buildTradeCard(trade, true).hero).toBe('+1,292.00');
    const withPercent = { ...trade, pnlPercent: 2.4 };
    expect(hideAmountState(withPercent)).toBe('available');
    const hidden = buildTradeCard(withPercent, true);
    expect(hidden.hero).toBe('+2.40%');
    expect(modelText(hidden)).not.toContain('1,292');
    expect(hideAmountState({ ...trade, pnlAmount: null })).toBe('no_amount');
  });

  it('o valor sobe de 0 ate o final na animacao, com o sinal do valor final; o quadro final e exato', () => {
    const model = buildTradeCard({ ...trade, pnlAmount: -471 }, false);
    expect(heroText(model, 0)).toBe('\u22120.00');
    const mid = Number(heroText(model, 1100).replace(/[^\d.]/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(471);
    expect(heroText(model, ANIMATION_MS)).toBe('\u2212471.00');
    expect(heroText(buildReadCard(read), 0)).toBe('BULLISH');
    expect(heroText(buildTradeCard({ ...trade, pnlAmount: 0 }, false), 0)).toBe('0.00');
  });

  it('sem valor registrado: mostra o resultado marcado', () => {
    const model = buildTradeCard({ ...trade, pnlAmount: null, verdict: 'SL' }, false);
    expect(model.hero).toBe('STOP HIT');
    expect(model.theme).toBe('bear');
  });

  it('texto do post sem o valor e sem atribuir o lucro ao Tickrify', () => {
    const text = buildTradeShareText(trade);
    expect(text).not.toContain('1,292');
    expect(text.toLowerCase()).not.toMatch(/made me|thanks to|profit/);
  });
});

describe('renderShareFrame', () => {
  function mockContext(written: string[]): CanvasRenderingContext2D {
    const noop = () => {};
    const gradient = { addColorStop: noop };
    return {
      setTransform: noop,
      fillRect: noop,
      fillText: (value: string) => written.push(value),
      measureText: (value: string) => ({ width: value.length * 20 }),
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      save: noop,
      restore: noop,
      beginPath: noop,
      rect: noop,
      clip: noop,
      translate: noop,
      scale: noop,
      drawImage: noop,
    } as unknown as CanvasRenderingContext2D;
  }
  const assets = { background: {}, logo: {} } as unknown as ShareAssets;

  it.each(SHARE_FORMAT_ORDER)('desenha os 4 estados e os 3 resultados no formato %s sem preco na leitura', (format) => {
    const reads = [
      buildReadCard(read),
      buildReadCard({ ...read, action: 'SELL', scenario: 'BEARISH' }),
      buildReadCard({ ...read, action: 'HOLD', state: 'WATCH' }),
      buildReadCard({ ...read, action: 'WAIT', state: 'NO_TRADE', scenario: 'NEUTRAL' }),
    ];
    for (const model of reads) {
      const written: string[] = [];
      renderShareFrame(mockContext(written), model, format, assets, ANIMATION_MS, 2);
      const text = written.join('');
      expect(text).toContain(model.hero);
      expect(text).not.toMatch(/67,?250|66,?800/);
      expect(text).toContain('Illustrative candles');
    }
    for (const amount of [1292, -471, 0]) {
      const written: string[] = [];
      const model = buildTradeCard({ ...trade, pnlAmount: amount, symbol: 'VERYLONGSYMBOLNAME.PRO' }, false);
      renderShareFrame(mockContext(written), model, format, assets, 0, 2);
      renderShareFrame(mockContext(written), model, format, assets, ANIMATION_MS, 2);
      expect(written).toContain(model.hero);
    }
  });
});

describe('My Trades: compartilhar resultado', () => {
  afterEach(() => {
    cleanup();
    getTrade.mockReset();
  });

  function row(id: string, outcome: string | null, pnlAmount: number | null): AIAnalysisResponse {
    return {
      id,
      status: 'completed',
      recommendation: 'BUY',
      symbol: 'XAUUSD',
      timeframe: '15m',
      outcome,
      pnlAmount,
      createdAt: '2026-11-02T12:00:00Z',
      updatedAt: '2026-11-02T12:00:00Z',
    } as unknown as AIAnalysisResponse;
  }

  async function mount() {
    const { default: MyTrades } = await import('@/components/dashboard/MyTrades');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <MyTrades />
        </LanguageProvider>
      </QueryClientProvider>,
    );
  }

  it('so o trade fechado ganha o botao; aberto e sem resultado nao', async () => {
    analyses = [row('closed', 'tp1', 120), row('open', 'open', null), row('pending', null, null)];
    await mount();
    expect(screen.getAllByRole('button', { name: /share result/i })).toHaveLength(1);
  });

  it('abre o modal com os 3 formatos e o "Hide amount" desligado sem retorno registrado', async () => {
    analyses = [row('closed', 'tp1', 120)];
    getTrade.mockResolvedValue({
      analysisId: 'closed', status: 'closed', direction: 'BUY', symbol: 'XAUUSD', timeframe: '15m',
      entryPrice: 4180.5, plannedEntry: 4181, stopLoss: 4170, target: 4200, closeReason: 'target_hit',
      timeline: [{ status: 'closed', at: '2026-11-02T18:05:00Z', closeReason: 'target_hit' }],
      checks: [], checksLeft: 10, analysisCreatedAt: '2026-11-02T12:00:00Z',
    });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /share result/i }));
    await waitFor(() => expect(getTrade).toHaveBeenCalledWith('closed'));
    expect(screen.getByText('Share this result')).toBeTruthy();
    for (const tab of ['Post', 'Feed', 'Story']) expect(screen.getByRole('button', { name: tab })).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: /hide amount/i });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/no return in R or percent logged/i)).toBeTruthy();
  });
});
