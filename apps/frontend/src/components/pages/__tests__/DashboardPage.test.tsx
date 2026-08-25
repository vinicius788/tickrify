import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => mockUseUser(),
  useAuth: () => mockUseAuth(),
  UserButton: () => <div>UserButton</div>,
}));

vi.mock('@/lib/api', () => ({
  APIError: class MockAPIError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  useAPIClient: () => mockUseAPIClient(),
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
  detectCurrency: vi.fn(() => 'usd'),
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

vi.mock('@/components/dashboard/Watchlist', () => ({
  default: () => <div>Watchlist</div>,
}));

vi.mock('@/components/dashboard/AnalysisCounter', () => ({
  default: () => <div>Analysis counter</div>,
}));

vi.mock('@/components/TicksBadge', () => ({
  TicksBadge: ({ onClick }: { onClick?: () => void }) => (
    <button onClick={onClick}>ticks-badge</button>
  ),
}));

vi.mock('@/components/BuyTicksModal', () => ({
  BuyTicksModal: () => <div>BuyTicksModal</div>,
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
      buyTicks: vi.fn(),
      refetch: vi.fn(),
      packages: [],
      history: [],
      loadingBalance: false,
    });
    mockUseAuth.mockReturnValue({ getToken: vi.fn().mockResolvedValue('token') });
    mockUseAPIClient.mockReturnValue(makeApiClient());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza estado de loading durante análise em modo demo', async () => {
    const user = userEvent.setup();

    mockUseUser.mockReturnValue({ user: null });

    renderDashboard();

    // O dashboard abre na home; navega para "Nova Análise" antes de enviar.
    await user.click(screen.getAllByRole('button', { name: 'Nova Análise' })[0]);
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

    expect(listAnalyses).toHaveBeenCalledWith(40);
  });

  it('trata erro de upload quando nenhuma imagem é enviada', async () => {
    const user = userEvent.setup();

    mockUseUser.mockReturnValue({
      user: { id: 'user-1' },
    });

    renderDashboard();

    await user.click(screen.getAllByRole('button', { name: 'Nova Análise' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'start-without-image' })[0]);

    expect(
      await screen.findByText('Por favor, faça upload de uma imagem de gráfico.'),
    ).toBeTruthy();
  });
});
