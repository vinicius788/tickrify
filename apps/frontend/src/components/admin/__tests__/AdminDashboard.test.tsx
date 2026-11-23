import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InicioPainel from '@/components/admin/InicioPainel';
import InspetorPainel from '@/components/admin/InspetorPainel';
import MotorPainel from '@/components/admin/MotorPainel';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok') }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));

const janela = (analyses: number) => ({
  signups: 2,
  analysis: {
    analyses, failed: 1, byState: { ENTER_NOW: 1, WATCH: 2 }, byAction: { buy_pullback: 1, wait: 2 }, agreement: { '3/3': 2, '2/3': 1 }, decidedBy: { majority: 2, candle_bias: 1 }, withoutMajority: 1,
    readerLabels: [{ label: 'C', seen: 3, failures: 1, topError: 'timeout' }],
    strongRead: 2, readerFailures: 1, readersSeen: 9, totalMsP50: 15600, totalMsP90: 18200, costUsd: 0.12, costPerAnalysisUsd: 0.04,
  },
  alerts: { triggered: 3, armed: 2, invalidated: 1, notified: 3, notifyDelayP50Ms: 4000, notifyDelayP90Ms: 9000 },
});
const inicio = {
  generatedAt: '2026-11-23T15:00:00Z', today: janela(3), week: janela(20), activeTrials: 5, subscribers: 1, activeAlerts: 4,
  twelveData: { day: '20261123', total: 410, analysis: 300, monitor: 90, sweeper: 20, minute: 2, exhausted: false, store: 'redis', dailyLimit: 800, perMinute: 8 },
};

const stats = (over = {}) => ({ analyses: 12, clearPct: 75, closedTrades: 4, win: 2, loss: 1, timeout: 1, meanR: 0.2, decision: 'wait', verdict: 'Esperar: faltam 26 trades fechados.', ...over });
const motor = {
  since: '2026-11-23T12:00:00Z',
  total: stats(),
  byEntry: [{ entry: 'pullback', stats: stats() }, { entry: 'wait', stats: stats({ clearPct: 0 }) }],
  byClass: [{ assetClass: 'crypto', stats: stats() }],
  agreement: [{ agreement: '3/3', count: 8 }, { agreement: '2/3', count: 4 }],
  decidedBy: [{ decidedBy: 'majority', count: 10 }, { decidedBy: 'candle_bias', count: 2 }],
  withoutMajorityPct: 16.7,
  readerFailures: [{ label: 'C', seen: 12, failures: 3, topError: 'timeout' }],
  byRules: [{ rules: 'filter-2026-11-23', stats: stats() }, { rules: null, stats: stats() }],
  noCandles: [{ reason: 'provider_quota', count: 2 }],
};

const detalhe = {
  id: 'a1', createdAt: '2026-11-23T14:00:00Z', status: 'completed', errorCode: null, recommendation: 'BUY', promptVer: 20, model: 'luna',
  imageUrl: 'https://img.test/a1.png', user: { id: 'u1', email: 'ana@example.com' }, groundingStats: null, track: null,
  result: {
    dataMode: 'real_data', signalState: 'WATCH', analysis: { symbol: 'BTCUSDT' },
    codeSummary: { action: 'buy_pullback', waitReason: null, entry: 90000, stopLoss: 89000, takeProfit1: 91500, takeProfit2: null, level: 89800, turnsBuyAbove: null, turnsSellBelow: null, flippedFromPrior: false },
    candleBias: { direction: 'long', score: 3, structure: 'up', htfTrend: 'uptrend', vsEma50: 'above', htfVsEma50: 'above', stretched: false, rsi14: 55 },
    engine: {
      version: '4.0.0', vote: { agreement: '2/3', strongRead: false, decidedBy: 'majority' },
      readers: [
        { label: 'A', provider: 'openai', model: 'luna', status: 'used', ms: 9000, costUsd: 0.01, state: 'WATCH', direction: 'long', veto: null },
        { label: 'C', provider: 'anthropic', model: null, status: 'failed', ms: 3000, costUsd: null, state: null, direction: null, veto: null, error: 'timeout' },
      ],
      timings: { server_total_ms: 16000, model_ms: 12000 },
    },
  },
};

function stubFetch(respostas: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const chave = Object.keys(respostas).find((k) => url.includes(k));
    return chave ? { ok: true, status: 200, json: async () => respostas[chave] } : { ok: false, status: 404, json: async () => ({}) };
  }));
}
function renderComQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('paineis novos do admin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('Inicio mostra assinantes, custo, tempo, alertas e a cota do Twelve Data', async () => {
    stubFetch({ '/api/admin/home': inicio });
    renderComQuery(<InicioPainel />);
    expect(await screen.findByText('cadastros hoje')).toBeTruthy();
    expect(screen.getByText('assinantes reais')).toBeTruthy();
    expect(screen.getByText('410 de 800')).toBeTruthy();
    expect(screen.getAllByText('15,6 s / 18,2 s').length).toBe(2);
    expect(screen.getAllByText('Compra no recuo: 1').length).toBe(2);
    expect(screen.getByText('Atraso do aviso p50 / p90')).toBeTruthy();
  });

  it('Motor mostra a regra do projeto, por entrada e por classe, sem perfis nem variantes', async () => {
    stubFetch({ '/api/admin/engine': motor });
    renderComQuery(<MotorPainel />);
    expect(await screen.findByText('Por tipo de entrada')).toBeTruthy();
    expect(screen.getByText(/n >= 30 trades fechados/)).toBeTruthy();
    expect(screen.getByText('Recuo')).toBeTruthy();
    expect(screen.getByText('Cripto')).toBeTruthy();
    expect(screen.getByText('Cota do Twelve Data')).toBeTruthy();
    expect(screen.queryByText(/Perfis de risco/)).toBeNull();
    expect(screen.queryByText(/variante/i)).toBeNull();
  });

  it('Inspetor busca, abre a analise e mostra leitores, falha de leitor e o texto em ingles', async () => {
    stubFetch({
      '/api/admin/analyses/a1': detalhe,
      '/api/admin/analyses?q=': { items: [{ id: 'a1', createdAt: '2026-11-23T14:00:00Z', email: 'ana@example.com', symbol: 'BTCUSDT', timeframe: '5m', status: 'completed', signalState: 'WATCH', action: 'buy_pullback', agreement: '2/3' }] },
    });
    renderComQuery(<InspetorPainel analiseInicial={null} onUsuario={() => undefined} />);
    await userEvent.type(screen.getByLabelText('Buscar análise'), 'btc');
    await userEvent.click(screen.getByText('Buscar'));
    await userEvent.click(await screen.findByText('abrir'));
    expect(await screen.findByText('O que a pessoa leu')).toBeTruthy();
    await waitFor(() => expect(screen.getByAltText('Print enviado pela pessoa').getAttribute('src')).toBe('https://img.test/a1.png'));
    expect(screen.getByText('timeout')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
    // Texto do resumo pelo codigo, em ingles, com o preco formatado como na tela.
    expect(screen.getByText(/\$ 90,000\.00/)).toBeTruthy();
    expect(screen.getByTestId('what-ai-saw')).toBeTruthy();
  });
});
