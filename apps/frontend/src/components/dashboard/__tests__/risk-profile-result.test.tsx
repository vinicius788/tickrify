import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalysisResult from '@/components/dashboard/AnalysisResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { AIAnalysisResponse } from '@/lib/api';

vi.mock('@/hooks/useEconomicCalendar', () => ({ useEconomicCalendar: () => ({ events: [], loading: false, unreliable: false }) }));
vi.mock('@/components/dashboard/WatchEntryLog', () => ({ WatchEntryLog: () => null }));
vi.mock('@/hooks/useMarketContext', () => ({ useMarketContext: () => ({ data: undefined, isLoading: false }) }));
vi.mock('@/lib/setups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/setups')>()),
  useAlertOptions: () => ({ isLoading: false, isError: false, data: { available: true, suggestions: [], alerts: [], watchAlert: null, setupId: null, emailEnabled: true, limits: { maxSetups: 10, perSetup: 3 } } }),
  useSetupForAnalysis: () => ({ data: { setup: null } }),
  useSetupAlerts: () => ({ data: { items: [] } }),
  useSetupActions: () => ({ follow: { mutate: vi.fn(), isPending: false }, setStatus: { mutate: vi.fn(), isPending: false } }),
  useAlertActions: () => ({ create: { mutate: vi.fn(), isPending: false }, cancel: { mutate: vi.fn(), isPending: false }, seen: { mutate: vi.fn() } }),
}));

const created = '2026-11-09T18:03:34Z';

function enterNow(extra: Record<string, unknown>): AIAnalysisResponse {
  return {
    id: 'r1', status: 'completed', recommendation: 'SELL', bias: 'bearish', confidence: 60, createdAt: created, updatedAt: created,
    fullResponse: {
      recommendation: 'SELL', signalState: 'ENTER_NOW', bias: 'bearish', confidence: 60, reasoning: '',
      analysis: {
        symbol: 'TEST', timeframe: '30m', currentPrice: 100, entry: 100, stopLoss: 110, takeProfit1: 91, takeProfit2: 85,
        entryType: 'market', marketStructure: { bias: 'bearish' },
      },
      ...extra,
    } as unknown as AIAnalysisResponse['fullResponse'],
  };
}

function watch(price: number): AIAnalysisResponse {
  const plan = {
    direction: 'long', triggerType: 'zone_reaction', zoneLow: 27710, zoneHigh: 27730, invalidation: 27650,
    target1: 27880, target2: 27910, validForCandles: 16, trigger: 'Watch 27710-27730 for a bullish reaction.',
  };
  return {
    id: 'w1', status: 'completed', recommendation: 'WAIT', bias: 'bullish', confidence: 40, createdAt: created, updatedAt: created, watch: null,
    fullResponse: {
      recommendation: 'WAIT', signalState: 'WATCH', watchPlan: plan, bias: 'bullish', confidence: 40, reasoning: '',
      analysis: { symbol: 'NAS100', timeframe: 'M5', currentPrice: price, executiveSummary: 'x', reasoning: 'x', technicalAnalysis: 'x', structureValidation: '' },
    } as unknown as AIAnalysisResponse['fullResponse'],
  };
}

const show = (data: AIAnalysisResponse) => render(
  <LanguageProvider><MemoryRouter><AnalysisResult analysisData={data} uploadedImage={null} /></MemoryRouter></LanguageProvider>,
);

describe('perfil de risco no resultado', () => {
  afterEach(cleanup);

  it('mostra o rotulo so quando o perfil nao e o padrao', () => {
    show(enterNow({ riskProfile: 'conservative' }));
    expect(screen.getByTestId('risk-profile-label').textContent).toBe('Risk profile: Conservative');
    expect(screen.queryByTestId('risk-breakeven')).toBeNull();
    cleanup();
    show(enterNow({ riskProfile: 'balanced' }));
    expect(screen.queryByTestId('risk-profile-label')).toBeNull();
    cleanup();
    show(enterNow({}));
    expect(screen.queryByTestId('risk-profile-label')).toBeNull();
  });

  it('agressivo com ENTER_NOW mostra o R/R e a taxa de acerto de empate', () => {
    show(enterNow({ riskProfile: 'aggressive' }));
    expect(screen.getByTestId('risk-profile-label').textContent).toBe('Risk profile: Aggressive');
    expect(screen.getByTestId('risk-breakeven').textContent).toBe('R/R 0.9: needs a win rate above 53%');
  });

  it('preco dentro da zona do WATCH nao manda esperar o recuo', () => {
    show(watch(27720));
    expect(screen.getByTestId('watch-headline').textContent).toBe(
      'Price is in the zone but the entry does not fit the risk rules. Waiting for a better entry near 27,710.',
    );
  });

  it('preco fora da zona mantem o texto de sempre', () => {
    show(watch(27832));
    expect(screen.getByTestId('watch-headline').textContent).toBe('No entry at 27,832. Wait for a pullback to 27,710 to 27,730.');
  });
});
