import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import DashboardPage from '@/components/pages/DashboardPage';

const mockUseUser = vi.fn();
const mockUseAuth = vi.fn();
const mockUseAPIClient = vi.fn();
const mockUseAnalysisLimit = vi.fn();
const mockUseIncrementAnalysis = vi.fn();
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

vi.mock('@/components/dashboard/Watchlist', () => ({
  default: () => <div>Watchlist</div>,
}));

vi.mock('@/components/dashboard/AnalysisCounter', () => ({
  default: () => <div>Analysis counter</div>,
}));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUser.mockReturnValue({ user: { id: 'default-user' } });
    mockUseAnalysisLimit.mockReturnValue({ plan: 'free' });
    mockUseIncrementAnalysis.mockReturnValue(vi.fn());
    mockUseAuth.mockReturnValue({ getToken: vi.fn().mockResolvedValue('token') });
    mockUseAPIClient.mockReturnValue({
      createAnalysis: vi.fn(),
      getAnalysis: vi.fn(),
      listAnalyses: vi.fn().mockResolvedValue([]),
      getAnalysisUsage: vi.fn(),
      waitForAnalysisCompletion: vi.fn().mockResolvedValue({ status: 'completed' }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renderiza estado de loading durante análise em modo demo', async () => {
    const user = userEvent.setup();

    mockUseUser.mockReturnValue({ user: null });

    renderDashboard();

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

    mockUseAPIClient.mockReturnValue({
      createAnalysis: vi.fn(),
      getAnalysis: vi.fn(),
      listAnalyses,
      getAnalysisUsage: vi.fn(),
      waitForAnalysisCompletion: vi.fn().mockResolvedValue({ status: 'completed' }),
    });

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

    await user.click(screen.getAllByRole('button', { name: 'start-without-image' })[0]);

    expect(
      await screen.findByText('Por favor, faça upload de uma imagem de gráfico.'),
    ).toBeTruthy();
  });
});
