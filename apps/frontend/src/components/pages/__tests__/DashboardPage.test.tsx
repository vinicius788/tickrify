import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import DashboardPage from '@/components/pages/DashboardPage';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getTranslations, LANGUAGES } from '@/lib/i18n';

const mockUseUser = vi.fn();
const mockUseAuth = vi.fn();
const mockUseAPIClient = vi.fn();
const mockUseAnalysisLimit = vi.fn();
const mockUseIncrementAnalysis = vi.fn();
const mockUseTicks = vi.fn();
const mockToast = vi.fn();
const mockTrack = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => mockUseUser(),
  useAuth: () => mockUseAuth(),
  UserButton: () => <div>UserButton</div>,
}));

vi.mock('@/lib/api', () => ({
  APIError: class MockAPIError extends Error {
    status: number;
    code?: string;
    cause?: unknown;

    constructor(message: string, status: number, code?: string, cause?: unknown) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.code = code;
      this.cause = cause;
    }
  },
  useAPIClient: () => mockUseAPIClient(),
  displayAsset: (symbol: string | null | undefined) => String(symbol || '').replace(/^[A-Za-z0-9_]+:/, '') || 'N/A',
  tradeQueryKey: (analysisId: string) => ['trade', analysisId],
  buildApiUrl: (path: string) => `https://api.test${path}`,
  isFreeQuotaExhausted: (error: unknown) =>
    Boolean(error) && (error as { status?: number }).status === 402 && (error as { code?: string }).code === 'free_quota_exhausted',
}));

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock('@/hooks/useAnalysisLimit', () => ({
  useAnalysisLimit: () => mockUseAnalysisLimit(),
  useIncrementAnalysis: () => mockUseIncrementAnalysis(),
}));

vi.mock('@/hooks/useTicks', () => ({
  useTicks: () => mockUseTicks(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockGetSubscription = vi.fn();
const mockOpenBillingPortal = vi.fn();
vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  createCheckoutSession: vi.fn(),
  getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
  openBillingPortal: (...args: unknown[]) => mockOpenBillingPortal(...args),
}));

vi.mock('@/components/dashboard/NewAnalysis', () => ({
  default: ({ onStartAnalysis }: { onStartAnalysis: (imageUrl?: string | null, imageFile?: File | null) => Promise<void> }) => (
    <div>
      <button onClick={() => void onStartAnalysis('data:image/png;base64,AAA', null)}>start-with-image</button>
      <button onClick={() => void onStartAnalysis(null, null)}>start-without-image</button>
    </div>
  ),
}));

vi.mock('@/components/dashboard/AnalysisLoading', () => ({
  default: () => <div>Analysis loading</div>,
}));

vi.mock('@/components/dashboard/AnalysisResult', () => ({
  default: ({ sample }: { sample?: boolean }) => <div>{sample ? 'Analysis result (sample)' : 'Analysis result'}</div>,
}));

// Exemplos minimos: o teste confere o fluxo, nao o texto do motor.
vi.mock('@/lib/sample-analyses', () => {
  const make = (kind: string, recommendation: string, symbol: string) => ({
    kind,
    analysis: {
      id: `sample-${kind}`,
      status: 'completed',
      recommendation,
      createdAt: '2026-09-01T12:00:00.000Z',
      fullResponse: { analysis: { symbol, timeframe: '1H' } },
    },
    after: { headline: `after ${kind}`, detail: 'detail' },
  });
  return {
    SAMPLE_ANALYSES: [make('bullish', 'BUY', 'BTCUSDT'), make('bearish', 'SELL', 'ETHUSDT'), make('neutral', 'WAIT', 'SOLUSDT')],
  };
});

vi.mock('@/components/dashboard/MyTrades', () => ({
  default: () => <div>My trades</div>,
}));

vi.mock('@/components/dashboard/JournalCalendar', () => ({
  default: () => <div>Journal</div>,
}));

vi.mock('@/components/dashboard/AnalysisCounter', () => ({
  default: () => <div>Analysis counter</div>,
}));

vi.mock('@/components/pricing/PricingCards', () => ({
  PricingCards: () => <div>Pricing cards</div>,
}));

/**
 * Fábrica do apiClient falso.
 *
 * Existe porque os testes montavam o objeto na mão em cada caso: quando o
 * DashboardPage passou a chamar `syncUserProfile`, dois testes quebraram com
 * "is not a function" e o motivo não tinha nada a ver com o que eles testam.
 * Método novo no cliente entra AQUI, num lugar só.
 */
function makeApiClient(overrides: Record<string, unknown> = {}) {
  return {
    createAnalysis: vi.fn(),
    getAnalysis: vi.fn(),
    listAnalyses: vi.fn().mockResolvedValue([]),
    getAnalysisUsage: vi.fn(),
    setOutcome: vi.fn().mockResolvedValue(undefined),
    syncUserProfile: vi.fn().mockResolvedValue(undefined),
    getStrategy: vi.fn().mockResolvedValue({ profile: null, paid: false }),
    waitForAnalysisCompletion: vi.fn().mockResolvedValue({ status: 'completed' }),
    // Estado da operacao: sem operacao aberta, o fluxo de sempre.
    listOpenTrades: vi.fn().mockResolvedValue({ trades: [] }),
    matchTrade: vi.fn().mockResolvedValue({ symbol: null, matches: [] }),
    getTrade: vi.fn().mockRejectedValue(new Error('not tracked in this test')),
    ...overrides,
  };
}

/** Mostra a URL atual e faz o papel do botao voltar do navegador. */
function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <button type="button" onClick={() => navigate(-1)}>browser-back</button>
    </>
  );
}

function renderDashboard(path = '/dashboard') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <DashboardPage />
          <RouterProbe />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const currentPath = () => screen.getByTestId('pathname').textContent;

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Idioma determinístico (pt) para os rótulos de navegação no teste.
    window.localStorage.setItem('tickrify-language', 'pt');
    mockUseUser.mockReturnValue({ user: { id: 'default-user' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free' });
    mockUseIncrementAnalysis.mockReturnValue(vi.fn());
    mockUseTicks.mockReturnValue({
      balance: 0,
      refetch: vi.fn(),
      history: [],
      loadingBalance: false,
    });
    mockUseAuth.mockReturnValue({ getToken: vi.fn().mockResolvedValue('token') });
    mockGetSubscription.mockReset().mockResolvedValue(null);
    mockOpenBillingPortal.mockReset();
    mockUseAPIClient.mockReturnValue(makeApiClient());
    // Setups (12/10/2026) buscam por fetch proprio: fora do ar por padrao,
    // a secao some e o resto do painel e o de sempre.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Sem config do Vitest (globals: false) a Testing Library NAO desmonta a
    // tela sozinha entre testes: os paineis se empilhavam e o clique em
    // "Nova Analise"[0] caia no painel do teste ANTERIOR.
    cleanup();
    vi.useRealTimers();
  });

  it('renderiza estado de loading durante análise em modo demo', async () => {
    const user = userEvent.setup();

    mockUseUser.mockReturnValue({ user: null });

    renderDashboard();

    // O dashboard abre na home; navega para "Nova Análise" antes de enviar.
    await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
    await user.click(screen.getByRole('button', { name: 'start-with-image' }));

    expect(screen.getByText('Analysis loading')).toBeTruthy();
  });

  it('inicio: bloco Today no topo, sem KPIs, quadro semanal nem lista de recentes (27/10/2026)', async () => {
    mockUseUser.mockReturnValue({
      user: { id: 'user-1' },
    });

    const listAnalyses = vi.fn().mockResolvedValue([
      {
        id: 'analysis-1',
        status: 'completed',
        symbol: 'BTCUSD',
        timeframe: '1H',
        recommendation: 'BUY',
        bias: 'bullish',
        createdAt: new Date().toISOString(),
      },
    ]);

    mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses }));

    renderDashboard();

    // Este arquivo roda em portugues (idioma do navegador do teste).
    expect(await screen.findByRole('region', { name: 'Hoje' }, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('Últimas Análises')).toBeNull();
    expect(screen.queryByText('Planos de trade')).toBeNull();
    expect(screen.queryByText('Insight da semana')).toBeNull();
    expect(screen.queryByText('Ao vivo')).toBeNull();
    expect(listAnalyses).toHaveBeenCalledWith(40, null);
  });

  it('trata erro de upload quando nenhuma imagem é enviada', async () => {
    const user = userEvent.setup();

    mockUseUser.mockReturnValue({
      user: { id: 'user-1' },
    });

    renderDashboard();

    await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
    await user.click(screen.getAllByRole('button', { name: 'start-without-image' })[0]);

    expect(
      await screen.findByText('Por favor, faça upload de uma imagem de gráfico.'),
    ).toBeTruthy();
  });

  it('registra falha de processamento sem code unknown nem mensagem privada', async () => {
    const user = userEvent.setup();
    mockUseAPIClient.mockReturnValue(makeApiClient({
      createAnalysis: vi.fn().mockResolvedValue({ id: 'analysis-failed', status: 'pending' }),
      waitForAnalysisCompletion: vi.fn().mockResolvedValue({
        id: 'analysis-failed',
        status: 'failed',
        errorMessage: 'Detalhe privado da falha',
      }),
    }));

    renderDashboard();
    await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
    await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

    await waitFor(() => {
      expect(mockTrack).toHaveBeenCalledWith('analysis_failed', expect.objectContaining({
        code: 'processing_failed_unclassified',
        stage: 'processing',
      }));
    });
    const event = mockTrack.mock.calls.find(([name]) => name === 'analysis_failed')?.[1];
    expect(JSON.stringify(event)).not.toContain('Detalhe privado');
  });

  it('falha de rede envia código estável sem mensagem privada e mostra mensagem clara na tela', async () => {
    const user = userEvent.setup();
    const { APIError } = await import('@/lib/api');

    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, isLoading: false });
    const createAnalysis = vi.fn().mockRejectedValue(
      new APIError('mensagem tecnica com VITE_API_URL', 0, 'network_error', new TypeError('Failed to fetch')),
    );
    mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis }));

    renderDashboard();

    await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
    await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

    expect(
      await screen.findByText('Não foi possível conectar ao Tickrify. Confira sua internet e tente novamente.'),
    ).toBeTruthy();
    expect(screen.queryByText(/VITE_API_URL/)).toBeNull();

    const failed = mockTrack.mock.calls.find(([event]) => event === 'analysis_failed');
    expect(failed?.[1]).toMatchObject({ code: 'network_error', stage: 'request', analysisType: 'quick' });
    expect(failed?.[1].errorMessage).toBeUndefined();
    expect(typeof failed?.[1].durationMs).toBe('number');
  });

  it('falha de token mostra a mensagem de sessão sem enviar o erro bruto à telemetria', async () => {
    const user = userEvent.setup();
    const { APIError } = await import('@/lib/api');

    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, isLoading: false });
    const createAnalysis = vi.fn().mockRejectedValue(
      new APIError('token', 0, 'auth_token_failed', new Error('x'.repeat(500))),
    );
    mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis }));

    renderDashboard();

    await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
    await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

    expect(await screen.findByText(/Não conseguimos confirmar sua sessão/)).toBeTruthy();

    const failed = mockTrack.mock.calls.find(([event]) => event === 'analysis_failed');
    expect(failed?.[1]).toMatchObject({ code: 'auth_token_failed', stage: 'request' });
    expect(failed?.[1].errorMessage).toBeUndefined();
  });

  it('atualizar setup: o envio de sempre leva o setupId e conta clique e envio separados', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/api/setups/setup-aaaaaaaa')
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              setup: {
                id: 'setup-aaaaaaaa', status: 'tracking', symbol: 'EURUSD', timeframe: '1H', rootAnalysisId: 'analysis00001',
                createdAt: '2026-10-10T10:00:00.000Z', lastAnalysisAt: '2026-10-10T10:00:00.000Z',
              },
              versions: [],
              nextCursor: null,
            }),
          }
        : { ok: false, status: 503, json: async () => ({}) },
    ));
    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, isLoading: false });
    const createAnalysis = vi.fn().mockResolvedValue({ id: 'analysis00002', status: 'pending' });
    mockUseAPIClient.mockReturnValue(
      makeApiClient({ createAnalysis, waitForAnalysisCompletion: vi.fn().mockResolvedValue({ id: 'analysis00002', status: 'completed' }) }),
    );

    renderDashboard('/dashboard/new?setup=setup-aaaaaaaa');
    // O envio so leva o setup depois de confirmar que ele ainda e acompanhado.
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(([u]) => String(u).includes('/api/setups/setup-aaaaaaaa'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

    await waitFor(() => expect(createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ setupId: 'setup-aaaaaaaa' })));
    expect(mockTrack).toHaveBeenCalledWith('setup_update_submitted', { setupId: 'setup-aaaaaaaa' });
    expect(await screen.findByText('Analysis result')).toBeTruthy();
  });

  it('nova analise sem setup na URL nao manda setupId', async () => {
    const user = userEvent.setup();
    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, isLoading: false });
    const createAnalysis = vi.fn().mockResolvedValue({ id: 'analysis00002', status: 'pending' });
    mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis }));

    renderDashboard('/dashboard/new');
    await user.click((await screen.findAllByRole('button', { name: 'start-with-image' }))[0]);

    await waitFor(() => expect(createAnalysis).toHaveBeenCalled());
    expect(createAnalysis.mock.calls[0][0].setupId).toBeUndefined();
    expect(mockTrack.mock.calls.some(([event]) => event === 'setup_update_submitted')).toBe(false);
  });

  // Estado da operacao (13/10/2026): operacao aberta do mesmo ativo dispara a pergunta.
  const openGold = { analysisId: 'analysis-gold', status: 'in_trade', symbol: 'FX:XAUUSD', timeframe: '1H', direction: 'BUY', updatedAt: '2026-10-12T10:00:00.000Z' };

  it('grafico novo do mesmo ativo de uma operacao aberta pergunta antes de analisar', async () => {
    const user = userEvent.setup();
    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, isLoading: false });
    const createAnalysis = vi.fn().mockResolvedValue({ id: 'analysis00003', status: 'pending' });
    const checkTrade = vi.fn().mockResolvedValue({ result: {}, view: { analysisId: 'analysis-gold' } });
    mockUseAPIClient.mockReturnValue(makeApiClient({
      createAnalysis,
      checkTrade,
      // Depois do "Sim" a tela abre a analise da operacao: a busca precisa responder.
      getAnalysis: vi.fn().mockResolvedValue({ id: 'analysis-gold', status: 'completed', recommendation: 'BUY' }),
      listOpenTrades: vi.fn().mockResolvedValue({ trades: [openGold] }),
      matchTrade: vi.fn().mockResolvedValue({ symbol: 'XAUUSD', matches: [openGold] }),
    }));

    renderDashboard('/dashboard/new');
    await user.click((await screen.findAllByRole('button', { name: 'start-with-image' }))[0]);

    expect(await screen.findByText('Este gráfico é acompanhamento da sua operação aberta em XAUUSD?')).toBeTruthy();
    expect(createAnalysis).not.toHaveBeenCalled();

    // Sim: modo gerenciamento na operacao, nunca uma analise nova.
    await user.click(screen.getByRole('button', { name: 'Sim, conferir minha operação' }));
    await waitFor(() => expect(checkTrade).toHaveBeenCalledWith('analysis-gold', expect.objectContaining({ userLanguage: 'pt' })));
    expect(createAnalysis).not.toHaveBeenCalled();
  });

  it('nao e acompanhamento: pergunta se a anterior segue aberta e faz a analise nova', async () => {
    const user = userEvent.setup();
    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, isLoading: false });
    const createAnalysis = vi.fn().mockResolvedValue({ id: 'analysis00004', status: 'pending' });
    mockUseAPIClient.mockReturnValue(makeApiClient({
      createAnalysis,
      listOpenTrades: vi.fn().mockResolvedValue({ trades: [openGold] }),
      matchTrade: vi.fn().mockResolvedValue({ symbol: 'XAUUSD', matches: [openGold] }),
    }));

    renderDashboard('/dashboard/new');
    await user.click((await screen.findAllByRole('button', { name: 'start-with-image' }))[0]);
    await user.click(await screen.findByRole('button', { name: 'Não, análise nova' }));
    expect(await screen.findByText('Sua operação em XAUUSD continua aberta?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continua aberta' }));
    await waitFor(() => expect(createAnalysis).toHaveBeenCalledTimes(1));
  });

  it.each([
    { label: 'primeira analise', used: 0, totalUsed: 0, isUnlimited: false, expected: 1 },
    { label: 'dois WAIT anteriores', used: 0, totalUsed: 2, isUnlimited: false, expected: 3 },
    { label: 'contador total ainda desconhecido', used: 0, totalUsed: null, isUnlimited: false, expected: null },
    { label: 'contador total invalido', used: 0, totalUsed: -1, isUnlimited: false, expected: null },
    { label: 'assinante', used: 2, totalUsed: 2, isUnlimited: true, expected: null },
  ])('numera o evento pelo total da cota: $label', async ({ used, totalUsed, isUnlimited, expected }) => {
    const user = userEvent.setup();
    mockUseUser.mockReturnValue({ user: { id: 'user-1' } });
    const quota = {
      plan: isUnlimited ? 'starter' : 'free',
      total: 3, used, remaining: 3 - used, totalUsed, totalLimit: 10,
      isUnlimited, isLoading: false,
    };
    mockUseAnalysisLimit.mockImplementation(() => quota);
    // O refresh depois da criacao ja inclui a analise em andamento: a conclusao
    // tem que manter o numero lido ANTES do envio.
    mockUseIncrementAnalysis.mockReturnValue(() => {
      quota.totalUsed = 9;
    });
    mockUseAPIClient.mockReturnValue(makeApiClient({
      createAnalysis: vi.fn().mockResolvedValue({ id: 'analysis-number', status: 'pending' }),
      waitForAnalysisCompletion: vi.fn().mockResolvedValue({
        id: 'analysis-number', status: 'completed', recommendation: 'WAIT',
      }),
    }));

    renderDashboard('/dashboard/new');
    await user.click((await screen.findAllByRole('button', { name: 'start-with-image' }))[0]);
    // O `analysis_completed` de um teste anterior sai depois do proximo quadro
    // pintado e pode cair no comeco deste: vale so o desta analise (WAIT).
    const isMine = ([name, props]: unknown[]) =>
      name === 'analysis_completed' && (props as { recommendation?: string })?.recommendation === 'WAIT';
    await waitFor(() => expect(mockTrack.mock.calls.some(isMine)).toBe(true));

    const started = mockTrack.mock.calls.filter(([name]) => name === 'analysis_started').at(-1);
    for (const last of [started, mockTrack.mock.calls.find(isMine)]) {
      expect(last?.[1]).toEqual(expect.objectContaining({
        analysisNumber: expected,
        analysisNumberSource: expected === null ? null : 'free_quota_total',
      }));
    }
  });

  describe('fim das 3 gratis', () => {
    const freeLimit = (used: number) => ({
      plan: 'free',
      total: 3,
      used,
      remaining: Math.max(0, 3 - used),
      isUnlimited: false,
      analysesAllTime: used,
      isLoading: false,
    });

    it('na 3a gratis mostra o resultado e, logo abaixo, o CTA de assinar (sem botao de nova analise)', async () => {
      const user = userEvent.setup();
      let used = 2;
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(used));
      // Igual a producao: o /usage e relido logo depois de criar a analise e o
      // backend ja conta a linha nova (status != failed), entao used vira 3.
      mockUseIncrementAnalysis.mockReturnValue(() => {
        used = 3;
      });
      const createAnalysis = vi.fn().mockResolvedValue({ id: 'a-3', status: 'pending' });
      mockUseAPIClient.mockReturnValue(
        makeApiClient({
          createAnalysis,
          waitForAnalysisCompletion: vi.fn().mockResolvedValue({ id: 'a-3', status: 'completed' }),
        }),
      );

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText('Analysis result')).toBeTruthy();
      expect(createAnalysis).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Suas análises grátis foram utilizadas.')).toBeTruthy();
      expect(screen.getByRole('button', { name: /Comece com uma semana/ })).toBeTruthy();
      expect(screen.queryByText(/Suas análises grátis com plano de trade acabaram/)).toBeNull();
    });

    it('com a cota esgotada, a proxima tentativa cai direto no paywall sem chamar a API', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(3));
      const createAnalysis = vi.fn();
      mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis }));

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText(/Suas análises grátis com plano de trade acabaram/)).toBeTruthy();
      expect(createAnalysis).not.toHaveBeenCalled();
    });

    it('WAIT no gratis: a barra do topo diz que nao gastou e leva a outro grafico', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(1));
      mockUseAPIClient.mockReturnValue(
        makeApiClient({
          createAnalysis: vi.fn().mockResolvedValue({ id: 'a-w', status: 'pending' }),
          waitForAnalysisCompletion: vi.fn().mockResolvedValue({ id: 'a-w', status: 'completed', recommendation: 'WAIT' }),
        }),
      );

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText('Este WAIT não gastou uma análise com entrada. Você ainda tem 2 de 3.')).toBeTruthy();
      expect(mockTrack).toHaveBeenCalledWith('wait_nudge_viewed', { freeRemaining: 2 });

      await user.click(screen.getByRole('button', { name: /Analisar outro gráfico/ }));
      expect(mockTrack).toHaveBeenCalledWith('wait_nudge_clicked', { freeRemaining: 2 });
      expect(screen.getAllByRole('button', { name: 'start-with-image' }).length).toBeGreaterThan(0);
    });

    it('BUY no gratis nao mostra a barra do WAIT', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(1));
      mockUseAPIClient.mockReturnValue(
        makeApiClient({
          createAnalysis: vi.fn().mockResolvedValue({ id: 'a-b', status: 'pending' }),
          waitForAnalysisCompletion: vi.fn().mockResolvedValue({ id: 'a-b', status: 'completed', recommendation: 'BUY' }),
        }),
      );

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText('Analysis result')).toBeTruthy();
      expect(screen.queryByText(/Este WAIT não gastou/)).toBeNull();
    });

    it('paywall nao afirma que existe uma analise pronta do grafico', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(3));
      mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis: vi.fn() }));

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText(/Suas análises grátis com plano de trade acabaram/)).toBeTruthy();
      expect(screen.queryByText(/is ready/i)).toBeNull();
      expect(screen.queryByText(/calculated for this chart/i)).toBeNull();
      expect(screen.getByRole('button', { name: /uma semana: US\$ 7,99/ })).toBeTruthy();
    });

    it('se o contador do navegador estiver defasado, o 403 do backend tambem leva ao paywall', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(2));
      const { APIError } = await import('@/lib/api');
      const createAnalysis = vi
        .fn()
        .mockRejectedValue(new (APIError as unknown as new (m: string, s: number, c?: string) => Error)('limit', 403, 'DEMO_LIMIT_REACHED'));
      mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis }));

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText(/Suas análises grátis com plano de trade acabaram/)).toBeTruthy();
    });
  });
  // ── Cobranca de trades em aberto (25/09/2026) ─────────────────────────────
  // Bug real: o aviso "1 trades ainda em aberto" nunca sumia. A marcacao local
  // (localStorage) valia para SEMPRE acima do servidor, entao um "aberto"
  // antigo guardado no aparelho escondia o TP/Stop ja gravado no servidor.
  describe('trades em aberto no painel', () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const row = (outcome: string | null) => [
      { id: 'a1', status: 'completed', recommendation: 'BUY', confidence: 62, symbol: 'XAUUSD', timeframe: '5M', createdAt: old, outcome },
    ];

    it('marcou TP1: o aviso some e nao volta depois que o servidor confirma', async () => {
      const user = userEvent.setup();
      const listAnalyses = vi.fn().mockResolvedValueOnce(row('open')).mockResolvedValue(row('tp1'));
      const setOutcome = vi.fn().mockResolvedValue({});
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses, setOutcome }));

      renderDashboard();
      await user.click(await screen.findByRole('button', { name: 'TP1 atingido' }));

      expect(setOutcome).toHaveBeenCalledWith('a1', { outcome: 'tp1' });
      await waitFor(() => expect(listAnalyses.mock.calls.length).toBeGreaterThan(1));
      await waitFor(() => expect(screen.queryByText(/trades ainda em aberto/)).toBeNull());
    });

    it('servidor recusou: a tela desfaz e avisa, em vez de fingir que gravou', async () => {
      const user = userEvent.setup();
      const listAnalyses = vi.fn().mockResolvedValue(row('open'));
      const setOutcome = vi.fn().mockRejectedValue(new Error('500'));
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses, setOutcome }));

      renderDashboard();
      await user.click(await screen.findByRole('button', { name: 'TP1 atingido' }));

      await waitFor(() => expect(mockToast).toHaveBeenCalled());
      expect(await screen.findByText(/trades ainda em aberto/)).toBeTruthy();
    });

    it('"aberto" antigo guardado no aparelho nao esconde o TP1 que esta no servidor', async () => {
      window.localStorage.setItem('tickrify_verdicts', JSON.stringify({ a1: 'OPEN' }));
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses: vi.fn().mockResolvedValue(row('tp1')) }));

      renderDashboard();
      await screen.findAllByRole('button', { name: 'Nova Análise' });
      expect(screen.queryByText(/trades ainda em aberto/)).toBeNull();
      window.localStorage.removeItem('tickrify_verdicts');
    });
  });

  describe('analises de exemplo', () => {
    const newFreeUser = {
      plan: 'free',
      total: 3,
      used: 0,
      remaining: 3,
      isUnlimited: false,
      analysesAllTime: 0,
      isLoading: false,
    };

    beforeEach(() => {
      window.localStorage.removeItem('tickrify_samples_viewed');
    });

    it('abre os 3 exemplos, um por vez, sem chamar a API nem mexer na cota', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockReturnValue(newFreeUser);
      const increment = vi.fn();
      mockUseIncrementAnalysis.mockReturnValue(increment);
      const api = makeApiClient();
      mockUseAPIClient.mockReturnValue(api);

      renderDashboard();
      // Quem nunca analisou cai direto em "Nova analise", com os exemplos em cima.
      await user.click(await screen.findByRole('button', { name: /Otimista/ }));
      expect(await screen.findByText('Analysis result (sample)')).toBeTruthy();
      expect(screen.getByText('Exemplo otimista')).toBeTruthy();
      expect(screen.getByText('after bullish')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /Neutro/ }));
      expect(screen.getByText('Exemplo neutro')).toBeTruthy();
      expect(screen.getByText('Não entrar também é uma resposta')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /Pessimista/ }));
      expect(screen.getByText('Exemplo pessimista')).toBeTruthy();
      expect(screen.queryByText('Não entrar também é uma resposta')).toBeNull();

      expect(screen.getByText('Agora é sua vez.')).toBeTruthy();
      expect(screen.getByText(getTranslations('pt').commercial.exampleLegacy.replace('{left}', '3'))).toBeTruthy();
      expect(api.createAnalysis).not.toHaveBeenCalled();
      expect(api.getAnalysis).not.toHaveBeenCalled();
      expect(api.getAnalysisUsage).not.toHaveBeenCalled();
      expect(increment).not.toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith('sample_analysis_opened', { sample: 'neutral' });

      // "Agora e sua vez" leva ao envio do grafico, com os tres marcados.
      await user.click(screen.getByRole('button', { name: /Analisar meu gráfico/ }));
      expect(screen.getByRole('button', { name: 'start-with-image' })).toBeTruthy();
      expect(screen.getAllByText('Vista')).toHaveLength(3);
      expect(mockTrack).toHaveBeenCalledWith('sample_cta_clicked', { viewed: 3, surface: 'sample' });
    });

    const trialState = {
      dayIndex: 1, daysTotal: 3, usedToday: 1, limitToday: 3, remainingToday: 2,
      daysUsed: 1, status: 'active', paywall: null,
      windowEndsAt: '2026-11-03T12:00:00Z', timezone: 'UTC', nextAvailableAt: null,
    };
    const pt = getTranslations('pt');
    it.each([
      { name: 'anonymous demo', usage: { ...newFreeUser, isUnlimited: true, remaining: Infinity, total: Infinity }, expected: pt.commercial.exampleDemo, anonymous: true },
      { name: 'paid subscriber', usage: { ...newFreeUser, plan: 'starter', isUnlimited: true, remaining: Infinity, total: Infinity }, expected: `${pt.commercial.examplePaid} ${pt.commercial.tickCosts}` },
      { name: 'current trial', usage: { ...newFreeUser, trial: trialState, remaining: 2 }, expected: `${pt.counter.trialLeftToday.replace('{left}', '2').replace('{limit}', '3')} ${pt.commercial.trialRules}` },
      { name: 'ended trial', usage: { ...newFreeUser, trial: { ...trialState, status: 'ended', remainingToday: 0 } }, expected: pt.counter.trialEnded },
      { name: 'legacy allowance', usage: { ...newFreeUser, remaining: 1 }, expected: pt.commercial.exampleLegacy.replace('{left}', '1') },
      { name: 'former subscriber', usage: { ...newFreeUser, formerSubscriber: true, remaining: 0 }, expected: pt.counter.subscriptionEnded },
      { name: 'blocked trial', usage: { ...newFreeUser, trialBlocked: { code: 'TRIAL_UNAVAILABLE', message: 'blocked' } }, expected: pt.counter.planUnavailable },
      { name: 'unavailable usage', usage: { ...newFreeUser, isUnavailable: true }, expected: pt.counter.planUnavailable },
      { name: 'non-finite legacy quota', usage: { ...newFreeUser, remaining: Infinity, total: Infinity }, expected: pt.counter.planUnavailable },
    ])('sample footer reflects $name without granting or spending analyses', async ({ usage, expected, anonymous }) => {
      if (anonymous) mockUseUser.mockReturnValue({ user: null });
      mockUseAnalysisLimit.mockReturnValue(usage);
      const increment = vi.fn();
      mockUseIncrementAnalysis.mockReturnValue(increment);
      const api = makeApiClient();
      mockUseAPIClient.mockReturnValue(api);
      renderDashboard(`${anonymous ? '/demo' : '/dashboard'}/new/example/neutral`);
      const footer = (await screen.findByText('Agora é sua vez.')).parentElement!;
      expect(within(footer).getByText(expected)).toBeTruthy();
      expect(document.body.textContent).not.toContain('Infinity');
      expect(document.body.textContent).not.toContain('WAIT não conta.');
      expect(api.createAnalysis).not.toHaveBeenCalled();
      expect(api.getAnalysis).not.toHaveBeenCalled();
      expect(api.getAnalysisUsage).not.toHaveBeenCalled();
      expect(increment).not.toHaveBeenCalled();
    });

    it.each(LANGUAGES.map(l => l.code))('uses the existing locale for subscriber sample messaging in %s', async language => {
      window.localStorage.setItem('tickrify-language', language);
      mockUseAnalysisLimit.mockReturnValue({ ...newFreeUser, plan: 'starter', isUnlimited: true, remaining: Infinity });
      renderDashboard('/dashboard/new/example/bullish');
      const t = getTranslations(language);
      expect(await screen.findByText(`${t.commercial.examplePaid} ${t.commercial.tickCosts}`)).toBeTruthy();
    });

    it('voltar aos exemplos mantem a pessoa na tela de nova analise', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockReturnValue(newFreeUser);

      renderDashboard();
      await user.click(await screen.findByRole('button', { name: /Pessimista/ }));
      await user.click(screen.getByRole('button', { name: /Voltar aos exemplos/ }));

      expect(screen.getByRole('button', { name: 'start-with-image' })).toBeTruthy();
      expect(screen.getByText('Veja antes 3 análises reais de exemplo')).toBeTruthy();
      expect(screen.getByText('Agora é sua vez.')).toBeTruthy();
    });

    it('nao aparece para assinante', async () => {
      mockUseAnalysisLimit.mockReturnValue({ ...newFreeUser, plan: 'pro', total: -1, remaining: Infinity, isUnlimited: true });

      renderDashboard();
      expect(await screen.findByRole('button', { name: 'start-with-image' })).toBeTruthy();
      expect(screen.queryByText('Veja antes 3 análises reais de exemplo')).toBeNull();
    });

    it('nao aparece para quem ja concluiu uma analise', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockReturnValue(newFreeUser);
      mockUseAPIClient.mockReturnValue(
        makeApiClient({
          listAnalyses: vi.fn().mockResolvedValue([
            { id: 'a-1', status: 'completed', recommendation: 'WAIT', createdAt: new Date().toISOString() },
          ]),
        }),
      );

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      expect(screen.getByRole('button', { name: 'start-with-image' })).toBeTruthy();
      expect(screen.queryByText('Veja antes 3 análises reais de exemplo')).toBeNull();
    });
  });

  describe('rotas do painel', () => {
    const withAnalysis = () =>
      makeApiClient({
        listAnalyses: vi.fn().mockResolvedValue([
          { id: 'old-1', status: 'completed', symbol: 'BTCUSD', timeframe: '1H', recommendation: 'BUY', createdAt: new Date().toISOString() },
        ]),
      });

    it('link colado na barra abre a area certa, com o item do menu ativo', async () => {
      mockUseAPIClient.mockReturnValue(withAnalysis());
      renderDashboard('/dashboard/journal');

      expect(await screen.findByText('Journal')).toBeTruthy();
      const active = screen.getAllByRole('link', { current: 'page' });
      expect(active.length).toBeGreaterThan(0);
      expect(active.every((link) => link.getAttribute('href') === '/dashboard/journal')).toBe(true);
    });

    it('Planos abre dentro do painel e o voltar do navegador fica no app', async () => {
      const user = userEvent.setup();
      mockUseAPIClient.mockReturnValue(withAnalysis());
      renderDashboard('/dashboard/trades');
      expect(await screen.findByText('My trades')).toBeTruthy();

      await user.click(screen.getByRole('link', { name: 'Planos' }));
      expect(currentPath()).toBe('/dashboard/plans');
      expect(screen.getByText('Pricing cards')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: 'browser-back' }));
      expect(currentPath()).toBe('/dashboard/trades');
      expect(screen.getByText('My trades')).toBeTruthy();
    });

    it('trocar de area pelo menu muda a URL', async () => {
      const user = userEvent.setup();
      mockUseAPIClient.mockReturnValue(withAnalysis());
      renderDashboard('/dashboard');

      await user.click((await screen.findAllByRole('link', { name: 'Meus Trades' }))[0]);
      expect(currentPath()).toBe('/dashboard/trades');
      await user.click(screen.getAllByRole('link', { name: 'Estratégia' })[0]);
      expect(currentPath()).toBe('/dashboard/strategy');
    });

    it('endereco desconhecido dentro do painel volta ao inicio do painel, nunca a landing', async () => {
      mockUseAPIClient.mockReturnValue(withAnalysis());
      renderDashboard('/dashboard/nao-existe');
      await waitFor(() => expect(currentPath()).toBe('/dashboard'));
    });

    it('analise concluida ganha URL propria; recarregar busca a mesma analise no servidor', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockReturnValue({ plan: 'starter', isUnlimited: true, isLoading: false });
      mockUseAPIClient.mockReturnValue(
        makeApiClient({
          createAnalysis: vi.fn().mockResolvedValue({ id: 'a-77', status: 'pending' }),
          waitForAnalysisCompletion: vi.fn().mockResolvedValue({ id: 'a-77', status: 'completed', recommendation: 'BUY' }),
        }),
      );
      renderDashboard('/dashboard/new');
      await user.click(await screen.findByRole('button', { name: 'start-with-image' }));
      expect(await screen.findByText('Analysis result')).toBeTruthy();
      expect(currentPath()).toBe('/dashboard/analysis/a-77');

      cleanup();
      const getAnalysis = vi.fn().mockResolvedValue({ id: 'a-77', status: 'completed', recommendation: 'BUY' });
      mockUseAPIClient.mockReturnValue(makeApiClient({ getAnalysis }));
      renderDashboard('/dashboard/analysis/a-77');
      expect(await screen.findByText('Analysis result')).toBeTruthy();
      expect(getAnalysis).toHaveBeenCalledWith('a-77');
    });
  });

  describe('oferta da ultima gratis no resultado', () => {
    const lastFreeViewed = () =>
      mockTrack.mock.calls.some(([event, props]) => event === 'upgrade_cta_viewed' && props?.source === 'last_free_result');

    it('recarregar uma analise com o plano ainda carregando nao conta oferta vista', async () => {
      // Carregando, o hook devolve remaining 0 para todo mundo (ate assinante).
      mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 0, used: 0, remaining: 0, isUnlimited: false, isLoading: true });
      const getAnalysis = vi.fn().mockResolvedValue({ id: 'a-1', status: 'completed', recommendation: 'SELL' });
      mockUseAPIClient.mockReturnValue(makeApiClient({ getAnalysis }));
      renderDashboard('/dashboard/analysis/a-1');

      await waitFor(() => expect(getAnalysis).toHaveBeenCalledWith('a-1'));
      expect(lastFreeViewed()).toBe(false);
    });

    it('com o plano confirmado e nada sobrando, conta a oferta vista', async () => {
      mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 3, remaining: 0, isUnlimited: false, isLoading: false });
      mockUseAPIClient.mockReturnValue(
        makeApiClient({ getAnalysis: vi.fn().mockResolvedValue({ id: 'a-1', status: 'completed', recommendation: 'SELL' }) }),
      );
      renderDashboard('/dashboard/analysis/a-1');

      await waitFor(() => expect(lastFreeViewed()).toBe(true));
    });

    it('recarregar a analise conta a oferta UMA vez, so depois de ela chegar', async () => {
      mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 3, remaining: 0, isUnlimited: false, isLoading: false });
      let resolve: (value: unknown) => void = () => {};
      const getAnalysis = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
      mockUseAPIClient.mockReturnValue(makeApiClient({ getAnalysis }));
      renderDashboard('/dashboard/analysis/a-1');

      await waitFor(() => expect(getAnalysis).toHaveBeenCalledWith('a-1'));
      expect(lastFreeViewed()).toBe(false);
      resolve({ id: 'a-1', status: 'completed', recommendation: 'SELL' });
      expect(await screen.findByText('Analysis result')).toBeTruthy();
      await waitFor(() => expect(lastFreeViewed()).toBe(true));
      const views = mockTrack.mock.calls.filter(
        ([event, props]) => event === 'upgrade_cta_viewed' && props?.source === 'last_free_result',
      );
      expect(views).toHaveLength(1);
    });

    it('analise que cai no paywall nao conta a oferta da ultima gratis', async () => {
      mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 3, remaining: 0, isUnlimited: false, freeLocked: true, isLoading: false });
      const getAnalysis = vi.fn().mockRejectedValue(Object.assign(new Error('locked'), { status: 402, code: 'free_quota_exhausted' }));
      mockUseAPIClient.mockReturnValue(makeApiClient({ getAnalysis }));
      renderDashboard('/dashboard/analysis/a-9');

      await waitFor(() => expect(getAnalysis).toHaveBeenCalledWith('a-9'));
      await new Promise((r) => setTimeout(r, 20));
      expect(lastFreeViewed()).toBe(false);
    });
  });

  describe('gratis esgotado', () => {
    const locked = { plan: 'free', total: 3, used: 3, remaining: 0, isUnlimited: false, freeLocked: true, isLoading: false };
    const recent = [
      { id: 'r-1', status: 'completed', symbol: 'BTCUSD', timeframe: '1H', recommendation: 'BUY', createdAt: new Date().toISOString() },
      { id: 'r-2', status: 'completed', symbol: 'XAUUSD', timeframe: '4H', recommendation: 'SELL', createdAt: new Date().toISOString() },
    ];

    it('My Trades abre com o paywall e as ultimas analises so para leitura', async () => {
      mockUseAnalysisLimit.mockReturnValue(locked);
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses: vi.fn().mockResolvedValue(recent) }));
      renderDashboard('/dashboard/trades');

      expect(await screen.findByText('Assine para continuar com acesso às suas análises e operações')).toBeTruthy();
      expect(screen.queryByText('My trades')).toBeNull();
      const row = await screen.findByRole('link', { name: /BTCUSD/ });
      expect(row.getAttribute('href')).toBe('/dashboard/analysis/r-1');
      expect(mockTrack).toHaveBeenCalledWith('upgrade_cta_viewed', { source: 'paywall', surface: 'trades' });
    });

    it('diario abre com o paywall, sem buscar os dados', async () => {
      mockUseAnalysisLimit.mockReturnValue(locked);
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses: vi.fn().mockResolvedValue(recent) }));
      renderDashboard('/dashboard/journal');

      expect(await screen.findByText(/O diário organiza cada análise/)).toBeTruthy();
      expect(screen.queryByText('Journal')).toBeNull();
    });

    it('nova analise vira o paywall direto, sem area de envio', async () => {
      mockUseAnalysisLimit.mockReturnValue(locked);
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses: vi.fn().mockResolvedValue(recent) }));
      renderDashboard('/dashboard/new');

      expect(await screen.findByText('Suas análises grátis com plano de trade acabaram')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'start-with-image' })).toBeNull();
    });

    it('analise antiga aberta pelo link: o 402 do servidor vira o paywall do historico', async () => {
      mockUseAnalysisLimit.mockReturnValue(locked);
      const { APIError } = await import('@/lib/api');
      const getAnalysis = vi
        .fn()
        .mockRejectedValue(new (APIError as unknown as new (m: string, s: number, c?: string) => Error)('locked', 402, 'free_quota_exhausted'));
      mockUseAPIClient.mockReturnValue(makeApiClient({ getAnalysis, listAnalyses: vi.fn().mockResolvedValue(recent) }));
      renderDashboard('/dashboard/analysis/velha');

      expect(await screen.findByText(/mais antiga que as suas 3 últimas/)).toBeTruthy();
    });

    it('checkout do paywall leva a area para o PostHog', async () => {
      const user = userEvent.setup();
      const { createCheckoutSession } = await import('@/lib/stripe');
      (createCheckoutSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://checkout.stripe.com/x', sessionId: 'cs_1' });
      mockUseAnalysisLimit.mockReturnValue(locked);
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses: vi.fn().mockResolvedValue(recent) }));
      Object.defineProperty(window, 'location', { value: { ...window.location, href: '' }, writable: true, configurable: true });
      renderDashboard('/dashboard/journal');

      await user.click(await screen.findByRole('button', { name: /uma semana: US\$ 7,99/ }));
      await waitFor(() =>
        expect(mockTrack).toHaveBeenCalledWith('checkout_started', expect.objectContaining({ source: 'locked_value', surface: 'journal', billingCycle: 'weekly', coupon: null })),
      );
    });

    it('antes de esgotar, My Trades funciona normal', async () => {
      mockUseAnalysisLimit.mockReturnValue({ ...locked, used: 1, remaining: 2, freeLocked: false });
      mockUseAPIClient.mockReturnValue(makeApiClient({ listAnalyses: vi.fn().mockResolvedValue(recent) }));
      renderDashboard('/dashboard/trades');
      expect(await screen.findByText('My trades')).toBeTruthy();
    });
  });

  it('leitura feita no /try antes do cadastro aparece no painel da conta nova', async () => {
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, freeLocked: false, isLoading: false });
    window.localStorage.setItem(
      'tickrify_demo_result',
      JSON.stringify({ recommendation: 'BUY', symbol: 'XAUUSD', timeframe: 'M30', entry: 4261.4, stopLoss: 4240, takeProfit1: 4300, riskReward: '1.8', savedAt: Date.now() }),
    );
    renderDashboard('/dashboard/new');

    expect(await screen.findByText('Sua leitura da demo grátis')).toBeTruthy();
    expect(screen.getByText('4261.4')).toBeTruthy();
    window.localStorage.removeItem('tickrify_demo_result');
  });

  describe('pergunta de origem', () => {
    const withHistory = (overrides: Record<string, unknown>) =>
      makeApiClient({
        syncUserProfile: vi.fn().mockResolvedValue({ acquisitionSource: null }),
        listAnalyses: vi.fn().mockResolvedValue([
          { id: 'o-1', status: 'completed', symbol: 'BTCUSD', timeframe: '1H', recommendation: 'BUY', createdAt: new Date().toISOString() },
        ]),
        ...overrides,
      });

    it('responder grava uma vez, com a origem escolhida', async () => {
      const user = userEvent.setup();
      const setAcquisitionSource = vi.fn().mockResolvedValue(undefined);
      mockUseAPIClient.mockReturnValue(withHistory({ setAcquisitionSource }));
      renderDashboard('/dashboard');

      await user.click(await screen.findByRole('button', { name: 'ChatGPT' }));
      expect(setAcquisitionSource).toHaveBeenCalledTimes(1);
      expect(setAcquisitionSource).toHaveBeenCalledWith({ source: 'chatgpt' });
    });

    it('dispensar nao grava nada', async () => {
      const user = userEvent.setup();
      const setAcquisitionSource = vi.fn().mockResolvedValue(undefined);
      mockUseAPIClient.mockReturnValue(withHistory({ setAcquisitionSource }));
      renderDashboard('/dashboard');

      await user.click(await screen.findByRole('button', { name: 'Agora não' }));
      expect(screen.queryByRole('button', { name: 'ChatGPT' })).toBeNull();
      expect(setAcquisitionSource).not.toHaveBeenCalled();
    });
  });

  describe('quadrinho de opiniao', () => {
    const comAnalise = () =>
      makeApiClient({
        listAnalyses: vi.fn().mockResolvedValue([
          { id: 'f-1', status: 'completed', symbol: 'BTCUSD', timeframe: '1H', recommendation: 'BUY', createdAt: new Date().toISOString() },
        ]),
      });
    const usage = { plan: 'free', total: 3, used: 1, remaining: 2, isUnlimited: false, freeLocked: false, isLoading: false, analysesAllTime: 1 };

    afterEach(() => {
      window.localStorage.removeItem('tickrify_feedback_hidden_until');
      vi.unstubAllGlobals();
    });

    it('envia a opiniao como kind feedback, com a rota, e agradece', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);
      mockUseAnalysisLimit.mockReturnValue(usage);
      mockUseAPIClient.mockReturnValue(comAnalise());
      renderDashboard('/dashboard');

      await user.type(await screen.findByRole('textbox', { name: 'O que você está achando da Tickrify?' }), 'Gostei, mas quero alerta de entrada');
      await user.click(screen.getByRole('button', { name: 'Enviar' }));

      expect(await screen.findByText('Obrigado. Vai direto para a equipe.')).toBeTruthy();
      const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/reports'))!;
      expect(url).toBe('https://api.test/api/reports');
      expect(JSON.parse(init.body)).toEqual({ message: 'Gostei, mas quero alerta de entrada', route: '/dashboard', kind: 'feedback' });
      expect(mockTrack).toHaveBeenCalledWith('feedback_sent', { length: 35, surface: 'card' });
    });

    it('texto curto nao envia', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      mockUseAnalysisLimit.mockReturnValue(usage);
      mockUseAPIClient.mockReturnValue(comAnalise());
      renderDashboard('/dashboard');

      await user.type(await screen.findByRole('textbox', { name: 'O que você está achando da Tickrify?' }), 'ok');
      await user.click(screen.getByRole('button', { name: 'Enviar' }));
      expect(screen.getByRole('alert').textContent).toContain('mínimo de 5');
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/reports'))).toBe(false);
    });

    it('dispensar esconde e lembra no aparelho', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockReturnValue(usage);
      mockUseAPIClient.mockReturnValue(comAnalise());
      renderDashboard('/dashboard');

      await user.click(await screen.findByRole('button', { name: 'Agora não' }));
      expect(screen.queryByText('O que você está achando da Tickrify?')).toBeNull();
      expect(Number(window.localStorage.getItem('tickrify_feedback_hidden_until'))).toBeGreaterThan(Date.now());
    });

    it('quem nunca analisou nao ve o quadrinho', async () => {
      mockUseAnalysisLimit.mockReturnValue({ ...usage, used: 0, analysesAllTime: 0 });
      mockUseAPIClient.mockReturnValue(makeApiClient());
      renderDashboard('/dashboard/trades');
      await screen.findByText('My trades');
      expect(screen.queryByText('O que você está achando da Tickrify?')).toBeNull();
    });
  });

  it('paywall: semanal e o botao principal, o mensal vem em seguida', async () => {
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 3, remaining: 0, isUnlimited: false, freeLocked: true, isLoading: false });
    mockUseAPIClient.mockReturnValue(makeApiClient());
    renderDashboard('/dashboard/new');

    await screen.findByRole('button', { name: /Comece com uma semana/ });
    const botoes = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const semanal = botoes.findIndex((b) => b.includes('Comece com uma semana: US$ 7,99 por 25 Ticks'));
    const mensal = botoes.findIndex((b) => b.startsWith('Ou mensal:'));
    expect(semanal).toBeGreaterThanOrEqual(0);
    expect(mensal).toBeGreaterThan(semanal);
  });

  it('assinante: o cartao do plano (Manage subscription) abre pelo saldo ou pelo plano no topo, nao fica fixo', async () => {
    const user = userEvent.setup();
    mockUseAnalysisLimit.mockReturnValue({ plan: 'weekly', isUnlimited: true, isLoading: false, total: Infinity, remaining: Infinity, used: 0 });
    mockUseTicks.mockReturnValue({ balance: 21, refetch: vi.fn(), history: [], loadingBalance: false });
    mockUseAPIClient.mockReturnValue(makeApiClient({
      listAnalyses: vi.fn().mockResolvedValue([
        { id: 's-1', status: 'completed', symbol: 'BTCUSD', timeframe: '1H', recommendation: 'BUY', createdAt: new Date().toISOString() },
      ]),
    }));
    renderDashboard('/dashboard');

    const plano = await screen.findByRole('button', { name: /WEEKLY/ });
    expect(screen.queryByText('Analysis counter')).toBeNull();
    await user.click(plano);
    expect(screen.getByText('Analysis counter')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Analysis counter')).toBeNull();
    await user.click(screen.getByRole('button', { name: '21 Ticks' }));
    expect(screen.getByText('Analysis counter')).toBeTruthy();
  });

  it.each(['/dashboard', '/dashboard/new', '/dashboard/plans'])(
    'usage indisponivel em %s nao mostra cotas ou ofertas e permite nova tentativa', async path => {
      const retry = vi.fn();
      mockUseAnalysisLimit.mockReturnValue({ plan: null, total: 0, remaining: 0, used: 0, isUnlimited: false, isLoading: true, isUnavailable: true, retry });
      renderDashboard(path);
      const message = 'Não foi possível verificar sua assinatura agora. Tente novamente em instantes.';
      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.queryByText('Analysis counter')).toBeNull();
      expect(screen.queryByText('Pricing cards')).toBeNull();
      expect(screen.queryByRole('button', { name: /assinar|subscribe|grátis restantes/i })).toBeNull();
      expect(screen.queryByText(/assinatura encerrada/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      expect(retry).toHaveBeenCalledTimes(1);
    });

  it('gratis continua vendo o contador na lateral', async () => {
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 1, remaining: 2, isUnlimited: false, isLoading: false });
    renderDashboard('/dashboard');
    expect(await screen.findByText('Analysis counter')).toBeTruthy();
  });

  it('pergunta de origem tambem aparece logo abaixo do resultado da analise', async () => {
    const user = userEvent.setup();
    const setAcquisitionSource = vi.fn().mockResolvedValue(undefined);
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 0, remaining: 3, isUnlimited: false, freeLocked: false, isLoading: false });
    mockUseAPIClient.mockReturnValue(
      makeApiClient({
        syncUserProfile: vi.fn().mockResolvedValue({ acquisitionSource: null }),
        setAcquisitionSource,
        createAnalysis: vi.fn().mockResolvedValue({ id: 'q-1', status: 'pending' }),
        waitForAnalysisCompletion: vi.fn().mockResolvedValue({ id: 'q-1', status: 'completed', recommendation: 'BUY' }),
      }),
    );
    renderDashboard('/dashboard/new');
    await user.click(await screen.findByRole('button', { name: 'start-with-image' }));
    expect(await screen.findByText('Analysis result')).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: 'ChatGPT' }));
    expect(setAcquisitionSource).toHaveBeenCalledWith({ source: 'chatgpt' });
  });

  describe('assinatura com pagamento recusado', () => {
    const pastDue = {
      id: 'sub_1',
      status: 'past_due',
      plan: 'free',
      billingCycle: 'monthly',
      currentPeriodEnd: 1_800_000_000,
      cancelAtPeriodEnd: false,
      accessEndsAt: null,
      nextChargeAt: null,
      amount: 29,
      currency: 'usd',
      manageable: true,
      canReactivate: false,
    };
    const gratis = { plan: 'free', total: 3, used: 1, remaining: 2, isUnlimited: false, isLoading: false };

    it('past_due: o aviso aparece no topo do painel e o botao abre o portal da Stripe', async () => {
      const user = userEvent.setup();
      mockGetSubscription.mockResolvedValue(pastDue);
      mockUseAnalysisLimit.mockReturnValue(gratis);
      renderDashboard('/dashboard');

      expect(await screen.findByText('O pagamento falhou. Atualize o cartão para manter o acesso.')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Atualizar cartão' }));
      expect(mockOpenBillingPortal).toHaveBeenCalledWith('token');
    });

    it('em Configuracoes o aviso nao se repete: a propria tela ja mostra o status', async () => {
      mockGetSubscription.mockResolvedValue(pastDue);
      mockUseAnalysisLimit.mockReturnValue(gratis);
      renderDashboard('/dashboard/settings');

      expect(await screen.findByText('O pagamento falhou. Atualize o cartão para manter o acesso.')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('assinante com plano ativo e visitante da demo nao consultam a assinatura', async () => {
      mockUseAnalysisLimit.mockReturnValue({ plan: 'weekly', isUnlimited: true, isLoading: false, total: Infinity, remaining: Infinity, used: 0 });
      const ativo = renderDashboard('/dashboard');
      await screen.findByRole('button', { name: /WEEKLY/ });
      ativo.unmount();

      mockUseUser.mockReturnValue({ user: null });
      mockUseAnalysisLimit.mockReturnValue(gratis);
      renderDashboard('/dashboard');
      await screen.findAllByRole('button', { name: 'Nova Análise' });

      expect(mockGetSubscription).not.toHaveBeenCalled();
    });

    it('paywall: quem ja tem assinatura recebe o aviso e vai para Configuracoes, nao para um beco', async () => {
      const user = userEvent.setup();
      const { createCheckoutSession, CheckoutError } = await import('@/lib/stripe');
      (createCheckoutSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new CheckoutError('already subscribed', 'already_subscribed', 409),
      );
      mockUseAnalysisLimit.mockReturnValue({ plan: 'free', total: 3, used: 3, remaining: 0, isUnlimited: false, freeLocked: true, isLoading: false });
      renderDashboard('/dashboard/new');

      await user.click(await screen.findByRole('button', { name: /Comece com uma semana/ }));
      await waitFor(() => expect(currentPath()).toBe('/dashboard/settings'));
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Esta conta já tem uma assinatura. Veja o status ou atualize o cartão em Configurações.' }),
      );
      expect(mockTrack).toHaveBeenCalledWith('checkout_failed', expect.objectContaining({ code: 'already_subscribed' }));
    });
  });
});
