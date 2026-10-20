import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentFailedBanner from '@/components/dashboard/PaymentFailedBanner';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import type { SubscriptionSummary } from '@/lib/stripe';

const getToken = vi.fn().mockResolvedValue('tok');
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));

const getSubscription = vi.fn();
const openBillingPortal = vi.fn();
vi.mock('@/lib/stripe', () => ({
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  openBillingPortal: (...a: unknown[]) => openBillingPortal(...a),
}));

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({
  track: (...a: unknown[]) => track(...a),
}));

function sub(over: Partial<SubscriptionSummary> = {}): SubscriptionSummary {
  return {
    id: 'sub_1',
    status: 'past_due',
    plan: 'free',
    billingCycle: 'monthly',
    currentPeriodEnd: Date.UTC(2026, 10, 8, 12) / 1000,
    cancelAtPeriodEnd: false,
    accessEndsAt: null,
    nextChargeAt: null,
    amount: 29,
    currency: 'usd',
    manageable: true,
    canReactivate: false,
    ...over,
  };
}

function renderBanner() {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <PaymentFailedBanner />
    </LanguageProvider>,
  );
}

const MESSAGE = 'Payment failed. Update your card to keep your access.';

describe('Aviso de pagamento recusado', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    getSubscription.mockReset();
    openBillingPortal.mockReset();
    track.mockReset();
    getToken.mockClear();
  });

  it('past_due: mostra o aviso e o botao abre o portal da Stripe', async () => {
    const user = userEvent.setup();
    getSubscription.mockResolvedValue(sub());
    renderBanner();

    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    expect(getSubscription).toHaveBeenCalledWith('tok');
    expect(track).toHaveBeenCalledWith('billing_alert_viewed', { status: 'past_due' });

    await user.click(screen.getByRole('button', { name: 'Update card' }));
    expect(openBillingPortal).toHaveBeenCalledWith('tok');
    expect(track).toHaveBeenCalledWith('billing_alert_clicked');
  });

  it('unpaid: tambem mostra o aviso', async () => {
    getSubscription.mockResolvedValue(sub({ status: 'unpaid' }));
    renderBanner();
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
  });

  it('assinatura ativa, encerrada ou inexistente: nada aparece', async () => {
    for (const result of [sub({ status: 'active' }), sub({ status: 'canceled', manageable: false }), null]) {
      getSubscription.mockReset();
      getSubscription.mockResolvedValue(result);
      const { unmount } = renderBanner();
      await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(MESSAGE)).toBeNull();
      unmount();
    }
    expect(track).not.toHaveBeenCalled();
  });

  it('past_due sem portal (manageable falso): nada aparece, sem botao morto', async () => {
    getSubscription.mockResolvedValue(sub({ manageable: false }));
    renderBanner();
    await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('falha ao ler a assinatura: o aviso some em silencio, sem erro na tela', async () => {
    getSubscription.mockRejectedValue(new Error('offline'));
    renderBanner();
    await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha ao abrir o portal: mostra o erro e o botao volta a funcionar', async () => {
    const user = userEvent.setup();
    getSubscription.mockResolvedValue(sub());
    openBillingPortal.mockRejectedValue(new Error('portal down'));
    renderBanner();

    await user.click(await screen.findByRole('button', { name: 'Update card' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Update card' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
