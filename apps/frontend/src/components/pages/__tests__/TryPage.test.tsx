import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const fetchDemoStatus = vi.fn();
vi.mock('@/lib/demo-api', async (orig) => ({
  ...(await orig<typeof import('@/lib/demo-api')>()),
  fetchDemoStatus: (...a: unknown[]) => fetchDemoStatus(...a),
  requestDemoAnalysis: vi.fn(),
}));
vi.mock('@/lib/fingerprint', () => ({ getDeviceFingerprint: vi.fn().mockResolvedValue('fp-test') }));
vi.mock('@/lib/turnstile', () => ({ getTurnstileToken: vi.fn() }));
vi.mock('@/lib/api', () => ({ warmupPaymentsApi: vi.fn(), buildApiUrl: (p: string) => p }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackSignupStartedOnce: vi.fn() }));
vi.mock('@/components/layout/SiteLayout', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@clerk/clerk-react', () => ({
  SignUpButton: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignedOut: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignedIn: () => null,
}));

import TryPage from '@/components/pages/TryPage';

const leitura = {
  status: 'completed', recommendation: 'BUY', bias: 'bullish', confidence: 60, symbol: 'XAUUSD', timeframe: 'M30',
  currentPrice: null, entry: 4261.4, stopLoss: 4240, takeProfit1: 4295.5, takeProfit2: null, riskReward: '1.6',
  reasoning: 'Clean pullback.', disclaimer: 'Not advice.', demoRemaining: 0, recovered: true,
};

describe('/try devolve a leitura que se perdeu', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem('tickrify_demo_result');
  });

  it('aparelho que ja analisou ve a propria leitura, nao "you already used"', async () => {
    window.localStorage.setItem('tickrify-language', 'en');
    fetchDemoStatus.mockResolvedValue({ used: true, result: leitura });
    render(
      <LanguageProvider>
        <MemoryRouter>
          <TryPage />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText('Real analysis')).toBeTruthy();
    // A entrada aparece nos niveis e no bloco Action do modo leitura.
    expect(screen.getAllByText('4,261.40').length).toBeGreaterThan(0);
    expect(screen.queryByText('You already used your free analysis')).toBeNull();
    expect(track).toHaveBeenCalledWith('demo_result_recovered', { source: 'status_check' });
    expect(window.localStorage.getItem('tickrify_demo_result')).toContain('XAUUSD');
  });

  it('sem leitura guardada, continua o aviso de limite', async () => {
    window.localStorage.setItem('tickrify-language', 'en');
    fetchDemoStatus.mockResolvedValue({ used: true, result: null });
    render(
      <LanguageProvider>
        <MemoryRouter>
          <TryPage />
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(await screen.findByText('You already used your free analysis')).toBeTruthy();
  });
});
