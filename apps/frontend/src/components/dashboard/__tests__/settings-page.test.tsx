import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/components/dashboard/SettingsPage';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { SubscriptionSummary } from '@/lib/stripe';

const getToken = vi.fn().mockResolvedValue('tok');
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));

const getSubscription = vi.fn();
const openBillingPortal = vi.fn();
const reactivateSubscription = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  openBillingPortal: (...a: unknown[]) => openBillingPortal(...a),
  reactivateSubscription: (...a: unknown[]) => reactivateSubscription(...a),
}));

// 20/10/2026 12:00 UTC: data no meio do dia, igual em qualquer fuso do CI.
const PERIOD_END = Date.UTC(2026, 9, 20, 12) / 1000;

function sub(over: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    id: 'sub_1',
    status: 'active',
    plan: 'starter',
    billingCycle: 'weekly',
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    accessEndsAt: null,
    nextChargeAt: PERIOD_END,
    amount: 7.99,
    currency: 'usd',
    manageable: true,
    canReactivate: false,
    ...over,
  };
}

function renderPage() {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <SettingsPage eyebrow={null} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('Configuracoes: assinatura e tema', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    getSubscription.mockReset();
    openBillingPortal.mockReset();
    reactivateSubscription.mockReset();
  });

  it('assinatura ativa: renova em, valor, proxima cobranca e o botao do portal', async () => {
    const user = userEvent.setup();
    getSubscription.mockResolvedValue(sub());
    renderPage();

    expect(await screen.findByText('Active, renews on October 20, 2026')).toBeTruthy();
    expect(screen.getByText('$7.99 / week')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reactivate/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Manage subscription/ }));
    expect(openBillingPortal).toHaveBeenCalledWith('tok');
  });

  it('cancelada no portal: acesso ate a data, sem proxima cobranca, e reativar funciona', async () => {
    const user = userEvent.setup();
    getSubscription.mockResolvedValue(
      sub({ cancelAtPeriodEnd: true, accessEndsAt: PERIOD_END, nextChargeAt: null, canReactivate: true }),
    );
    reactivateSubscription.mockResolvedValue(sub());
    renderPage();

    expect(await screen.findByText('Canceled, access until October 20, 2026')).toBeTruthy();
    expect(screen.getByText('No more charges')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Reactivate subscription/ }));
    expect(reactivateSubscription).toHaveBeenCalledWith('tok');
    expect(await screen.findByText('Active, renews on October 20, 2026')).toBeTruthy();
    expect(screen.getByText('Your subscription is active again.')).toBeTruthy();
  });

  it('sem assinatura: nao mostra o botao do portal, so os planos', async () => {
    getSubscription.mockResolvedValue(null);
    renderPage();

    expect(await screen.findByText('You do not have a subscription.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Manage subscription/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeTruthy();
  });

  it('tema: escuro por padrao; escolher claro grava no aparelho e na conta', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme: 'light' }) });
    vi.stubGlobal('fetch', fetchMock);
    getSubscription.mockResolvedValue(null);
    renderPage();

    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('radio', { name: 'Light' }));

    expect(window.localStorage.getItem('tickrify_theme')).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/auth/preferences',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ theme: 'light' }) }),
    );
  });
});
