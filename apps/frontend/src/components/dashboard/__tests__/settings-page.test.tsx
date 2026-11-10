import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '@/components/dashboard/SettingsPage';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { SubscriptionSummary } from '@/lib/stripe';
import { formatUsd } from '@/lib/i18n';

describe('formatUsd', () => {
  it('um formato so: $ na frente, sem centavos em valor inteiro', () => {
    expect(formatUsd(29, 'en')).toBe('$29');
    expect(formatUsd(18.85, 'pt')).toBe('$18,85');
    expect(formatUsd(29 * 0.65, 'en')).toBe('$18.85');
    expect(formatUsd(290, 'de')).toBe('$290');
  });
});

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

  it('assinante real no mensal: status, $29 e proxima cobranca', async () => {
    getSubscription.mockResolvedValue(sub({ billingCycle: 'monthly', amount: 29 }));
    renderPage();
    expect(await screen.findByText('Active, renews on October 20, 2026')).toBeTruthy();
    expect(screen.getByText('$29 / month')).toBeTruthy();
    expect(screen.getByText('Next charge').nextElementSibling?.textContent).toBe('October 20, 2026');
  });

  it('mesmo formato de moeda em portugues: $7,99, nunca US$', async () => {
    getSubscription.mockResolvedValue(sub());
    window.localStorage.setItem('tickrify-language', 'pt');
    render(<MemoryRouter><LanguageProvider><SettingsPage eyebrow={null} /></LanguageProvider></MemoryRouter>);
    expect(await screen.findByText('$7,99 / semana')).toBeTruthy();
    expect(document.body.textContent).not.toContain('US$');
  });

  it('acesso manual: "Manual access", sem status, valor nem portal de assinatura antiga', async () => {
    getSubscription.mockResolvedValue({ manualAccess: true });
    renderPage();
    expect(await screen.findByText('Manual access')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Ended on|R\$|Next charge|You do not have/);
    expect(screen.queryByRole('button', { name: /Manage subscription/ })).toBeNull();
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

it('shows a pending payment without replacing the paid current plan', async () => {
  getSubscription.mockResolvedValue(sub({ pendingPayment: true }));
  renderPage();
  expect(await screen.findByText(/Plan change awaiting payment confirmation/)).toBeTruthy();
  expect(screen.getByText('$7.99 / week')).toBeTruthy();
  cleanup();
});
it('shows a future change read-only while downgrades remain disabled', async () => {
  getSubscription.mockResolvedValue(sub({ billingCycle: 'monthly', scheduledChange: { billingCycle: 'weekly', effectiveAt: PERIOD_END } }));
  renderPage();
  expect(await screen.findByText(/Change to Weekly on/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Undo scheduled change' })).toBeNull();
  cleanup();
});

it('shows upgrade entry only for an eligible user, preserving the manage button', async () => {
  getSubscription.mockResolvedValue(sub({ canChangePlans: true }));
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to monthly' }));
  expect(openBillingPortal).toHaveBeenCalledWith('tok', 'upgrade');
  expect(screen.getByRole('button', { name: /Manage subscription/ })).toBeTruthy();
  cleanup();
});
