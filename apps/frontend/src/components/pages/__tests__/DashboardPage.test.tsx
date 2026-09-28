import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import DashboardPage from '@/components/pages/DashboardPage';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

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

vi.mock('@/lib/stripe', () => ({
  createCheckoutSession: vi.fn(),
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
  default: () => <div>Analysis result</div>,
}));

vi.mock('@/components/dashboard/MyTrades', () => ({
  default: () => <div>My trades</div>,
}));

vi.mock('@/components/dashboard/JournalCalendar', () => ({
  default: () => <div>Journal</div>,
}));

vi.mock('@/components/dashboard/AnalysisCounter', () => ({
  default: () => <div>Analysis counter</div>,
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
    waitForAnalysisCompletion: vi.fn().mockResolvedValue({ status: 'completed' }),
    ...overrides,
  };
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

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
    mockUseAPIClient.mockReturnValue(makeApiClient());
  });

  afterEach(() => {
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

  it('exibe análises recentes quando listAnalyses retorna dados', async () => {
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

    await waitFor(() => {
      expect(screen.getAllByText('BTCUSD').length).toBeGreaterThan(0);
    });

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
      expect(screen.getByRole('button', { name: /Assinar para continuar/ })).toBeTruthy();
      expect(screen.queryByText(/Unlock to see it/)).toBeNull();
    });

    it('com a cota esgotada, a proxima tentativa cai direto no paywall sem chamar a API', async () => {
      const user = userEvent.setup();
      mockUseAnalysisLimit.mockImplementation(() => freeLimit(3));
      const createAnalysis = vi.fn();
      mockUseAPIClient.mockReturnValue(makeApiClient({ createAnalysis }));

      renderDashboard();
      await user.click((await screen.findAllByRole('button', { name: 'Nova Análise' }))[0]);
      await user.click(screen.getAllByRole('button', { name: 'start-with-image' })[0]);

      expect(await screen.findByText(/Unlock to see it/)).toBeTruthy();
      expect(createAnalysis).not.toHaveBeenCalled();
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

      expect(await screen.findByText(/Unlock to see it/)).toBeTruthy();
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
});
