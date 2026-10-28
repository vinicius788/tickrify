import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalysisCounter from '@/components/dashboard/AnalysisCounter';
import Paywall from '@/components/dashboard/Paywall';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { TrialUsage } from '@/lib/api';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: async () => null }) }));
vi.mock('@/hooks/useTicks', () => ({ useTicks: () => ({ balance: 0 }) }));
vi.mock('@/hooks/useFoundingOffer', () => ({ useFoundingOffer: () => null }));
vi.mock('@/lib/ratings', () => ({ useTestimonials: () => [] }));
vi.mock('@/components/dashboard/UpgradeVideo', () => ({ default: () => null }));

let trial: TrialUsage | null = null;
vi.mock('@/hooks/useAnalysisLimit', () => ({
  useAnalysisLimit: () => ({
    isUnlimited: false,
    plan: 'free',
    total: trial?.limitToday ?? 3,
    used: trial?.usedToday ?? 0,
    remaining: trial?.remainingToday ?? 3,
    totalUsed: 0,
    totalLimit: 7,
    trial,
    isLoading: false,
  }),
}));

const day = (over: Partial<TrialUsage>): TrialUsage => ({
  dayIndex: 1,
  daysTotal: 3,
  usedToday: 0,
  limitToday: 3,
  remainingToday: 3,
  daysUsed: 0,
  status: 'active',
  paywall: null,
  windowEndsAt: '2026-10-27T12:00:00.000Z',
  ...over,
});

const renderCounter = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AnalysisCounter />
      </LanguageProvider>
    </MemoryRouter>,
  );

describe('trial de 3 dias no painel', () => {
  afterEach(cleanup);

  it('dia 1: 3 analises; dia 2: 2', () => {
    trial = day({});
    renderCounter();
    expect(screen.getByText('Day 1 of 3')).toBeTruthy();
    expect(screen.getByText('3 of 3 analyses left today')).toBeTruthy();
    cleanup();
    trial = day({ dayIndex: 2, limitToday: 2, usedToday: 1, remainingToday: 1, daysUsed: 1 });
    renderCounter();
    expect(screen.getByText('Day 2 of 3')).toBeTruthy();
    expect(screen.getByText('1 of 2 analyses left today')).toBeTruthy();
  });

  it('cota do dia esgotada: volte amanha ou assine', () => {
    trial = day({ usedToday: 3, remainingToday: 0, paywall: 'daily_limit' });
    renderCounter();
    expect(screen.getByText("Today’s analyses are used up. See your trial allowance for availability.")).toBeTruthy();
  });

  it('trial encerrado: modo leitura', () => {
    trial = day({ status: 'ended', dayIndex: 3, limitToday: 0, remainingToday: 0, paywall: 'day3_quota', daysUsed: 3 });
    renderCounter();
    expect(screen.getByText('Your free trial has ended. Your analyses stay open to read.')).toBeTruthy();
  });

  it('mostra janela e a proxima cota no fuso da conta', () => {
    trial = day({ usedToday: 3, remainingToday: 0, paywall: 'daily_limit', timezone: 'America/Sao_Paulo', nextAvailableAt: '2026-10-21T03:00:00Z' });
    renderCounter();
    expect(screen.getByText(/Next analyses:.*Oct 21, 2026.*12:00 AM.*America\/Sao_Paulo/)).toBeTruthy();
    expect(screen.getByText(/Trial window ends:.*America\/Sao_Paulo/)).toBeTruthy();
    expect(screen.getByText(/WAIT counts/)).toBeTruthy();
  });

  it('nao promete voltar amanha se nao ha proxima cota dentro da janela', () => {
    trial = day({ usedToday: 3, remainingToday: 0, paywall: 'daily_limit', nextAvailableAt: null });
    renderCounter();
    expect(screen.getByText('The trial window ends before another daily allowance becomes available.')).toBeTruthy();
    expect(screen.queryByText(/Come back tomorrow/)).toBeNull();
  });

  it('paywall: botao principal e o semanal, com o mensal ao lado', () => {
    const onWeekly = vi.fn();
    render(
      <MemoryRouter>
        <LanguageProvider>
          <Paywall surface="new_analysis" variant="daily_limit" onWeekly={onWeekly} onMonthly={vi.fn()} plansHref="/dashboard/plans" />
        </LanguageProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("You have used today's analyses")).toBeTruthy();
    expect(screen.getByText('Today’s analyses are used up. See your trial allowance for availability.')).toBeTruthy();
    screen.getByRole('button', { name: 'Start with one week: $7.99 for 25 Ticks' }).click();
    expect(onWeekly).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Or monthly: $29/month for 200 Ticks' })).toBeTruthy();
  });
});
