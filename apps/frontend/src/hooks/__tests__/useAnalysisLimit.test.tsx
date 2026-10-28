import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { APIError } from '@/lib/api';
import { useAnalysisLimit } from '../useAnalysisLimit';
import AnalysisCounter from '@/components/dashboard/AnalysisCounter';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

const mocks = vi.hoisted(() => ({
  getUsage: vi.fn(), getToken: vi.fn(), user: { id: 'user_test' }, setPlanContext: vi.fn(),
}));
vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: mocks.user, isLoaded: true }),
  useAuth: () => ({ getToken: mocks.getToken }),
}));
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  apiClient: { getAnalysisUsage: mocks.getUsage },
}));
vi.mock('@/lib/analytics', () => ({ setPlanContext: mocks.setPlanContext, track: vi.fn() }));
vi.mock('@/hooks/useTicks', () => ({ useTicks: () => ({ balance: 17 }) }));
vi.mock('@/lib/stripe', () => ({ openBillingPortal: vi.fn() }));

const unavailable = 'Não foi possível verificar sua assinatura agora. Tente novamente em instantes.';
const usage = (overrides: Record<string, unknown> = {}) => ({
  plan: 'starter', total: 200, used: 1, isUnlimited: true, analysesAllTime: 4,
  freeLocked: false, formerSubscriber: false, billingManageable: true,
  ...overrides,
});
let now = Date.now();

describe('usage verification failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    now += 2000; // Expire the existing, short request-deduplication window.
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.getToken.mockResolvedValue('token_test');
    window.localStorage.setItem('tickrify-language', 'pt');
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([100, 10_000])('rechecks the trial boundary in %i ms without reusing the pre-boundary quota or granting local credits', async boundaryDelay => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const trial = {
      dayIndex: 1, daysTotal: 3, usedToday: 3, limitToday: 3, remainingToday: 0,
      daysUsed: 1, status: 'active', paywall: 'daily_limit',
      nextAvailableAt: new Date(now + boundaryDelay).toISOString(), windowEndsAt: new Date(now + 100_000).toISOString(),
    };
    let resolve!: (value: ReturnType<typeof usage>) => void;
    mocks.getUsage.mockResolvedValueOnce(usage({ plan: 'free', isUnlimited: false, trial }))
      .mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { result } = renderHook(useAnalysisLimit);
    await act(async () => {});
    expect(result.current.canAnalyze).toBe(false);
    const delay = Math.max(boundaryDelay + 1000, 1600);
    now += delay;
    await act(() => vi.advanceTimersByTimeAsync(delay));
    expect(mocks.getUsage).toHaveBeenCalledTimes(2);
    expect(result.current.remaining).toBe(0);
    await act(async () => resolve(usage({ plan: 'free', isUnlimited: false, trial: { ...trial, dayIndex: 2, usedToday: 0, limitToday: 2, remainingToday: 2, paywall: null, nextAvailableAt: null } })));
    expect(result.current.remaining).toBe(2);
    expect(result.current.canAnalyze).toBe(true);
  });

  it('does not loop if the refreshed server response still contains the expired trial boundary', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const trial = {
      dayIndex: 1, daysTotal: 3, usedToday: 3, limitToday: 3, remainingToday: 0,
      daysUsed: 1, status: 'active', paywall: 'daily_limit',
      nextAvailableAt: new Date(now + 100).toISOString(), windowEndsAt: new Date(now + 100_000).toISOString(),
    };
    mocks.getUsage.mockImplementation(async () => usage({ plan: 'free', isUnlimited: false, trial: { ...trial } }));
    const { result } = renderHook(useAnalysisLimit);
    await act(async () => {});
    now += 1600;
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.getUsage).toHaveBeenCalledTimes(2);
    expect(result.current.canAnalyze).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it('keeps the plan unknown until the first successful response', async () => {
    let resolve!: (value: ReturnType<typeof usage>) => void;
    mocks.getUsage.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(mocks.getUsage).toHaveBeenCalledTimes(1));
    expect(result.current).toMatchObject({ plan: null, isLoading: true, canAnalyze: false, remaining: 0 });
    await act(async () => resolve(usage()));
    expect(result.current.plan).toBe('starter');
  });

  it.each([
    ['503', new APIError('temporary verification failure', 503, 'subscription_verification_unavailable')],
    ['network failure', new TypeError('Failed to fetch')],
    ['timeout', new APIError('timeout', 0, 'timeout')],
  ])('does not infer free or canceled status from %s', async (_name, error) => {
    mocks.getUsage.mockRejectedValueOnce(error);
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current).toMatchObject({
      plan: null, total: 0, remaining: 0, canAnalyze: false, isUnlimited: false,
      formerSubscriber: false, freeLocked: false, trial: null, trialBlocked: null,
    });
    expect(mocks.setPlanContext).not.toHaveBeenCalled();
  });

  it('does not infer a subscription state when the token is temporarily unavailable', async () => {
    mocks.getToken.mockResolvedValueOnce(null);
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.plan).toBeNull();
    expect(mocks.getUsage).not.toHaveBeenCalled();
  });

  it.each(['weekly', 'monthly', 'yearly'])('preserves confirmed active %s access', async billingCycle => {
    const plan = billingCycle === 'weekly' ? 'weekly' : 'starter';
    mocks.getUsage.mockResolvedValueOnce(usage({ plan, billingCycle }));
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ plan, canAnalyze: true, isUnlimited: true, isUnavailable: false });
  });

  it('preserves the confirmed free quota', async () => {
    mocks.getUsage.mockResolvedValueOnce(usage({ plan: 'free', total: 3, used: 1, isUnlimited: false, billingManageable: false }));
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ plan: 'free', remaining: 2, canAnalyze: true, isUnavailable: false });
  });

  it('preserves confirmed ended subscriptions and prevents new analyses', async () => {
    mocks.getUsage.mockResolvedValueOnce(usage({ plan: 'free', isUnlimited: false, formerSubscriber: true, billingManageable: false }));
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ plan: 'free', formerSubscriber: true, remaining: 0, canAnalyze: false });
  });

  it('masks a previously confirmed plan on failure and recovers through retry', async () => {
    mocks.getUsage.mockResolvedValueOnce(usage()).mockRejectedValueOnce(new APIError('temporary', 503));
    const { result } = renderHook(useAnalysisLimit);
    await waitFor(() => expect(result.current.plan).toBe('starter'));
    now += 2000;
    act(() => { window.dispatchEvent(new Event('tickrify:analysis-created')); });
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.plan).toBeNull();
    expect(result.current.canAnalyze).toBe(false);
    mocks.getUsage.mockResolvedValueOnce(usage());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.plan).toBe('starter'));
    expect(result.current.isUnavailable).toBe(false);
  });

  it('shows a neutral notice instead of quotas, offers or cancellation, and retries all counters once', async () => {
    mocks.getUsage.mockRejectedValueOnce(new APIError('temporary', 503));
    render(<MemoryRouter><LanguageProvider><AnalysisCounter /><AnalysisCounter /></LanguageProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(unavailable)).toHaveLength(2));
    expect(screen.queryByText(/Assinatura encerrada|Sua assinatura terminou|Análises grátis/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /assinar|planos/i })).toBeNull();
    expect(mocks.getUsage).toHaveBeenCalledTimes(1);
    mocks.getUsage.mockResolvedValueOnce(usage({ plan: 'weekly' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Tentar novamente' })[0]);
    await waitFor(() => expect(screen.queryByText(unavailable)).toBeNull());
    expect(mocks.getUsage).toHaveBeenCalledTimes(2);
  });

  it('does not reuse another session’s successful usage response', async () => {
    mocks.getUsage.mockResolvedValueOnce(usage());
    const first = renderHook(useAnalysisLimit);
    await waitFor(() => expect(first.result.current.plan).toBe('starter'));
    first.unmount();
    mocks.getToken.mockResolvedValueOnce('different_session');
    mocks.getUsage.mockRejectedValueOnce(new APIError('temporary', 503));
    const second = renderHook(useAnalysisLimit);
    await waitFor(() => expect(second.result.current.isUnavailable).toBe(true));
    expect(second.result.current.plan).toBeNull();
  });
});
