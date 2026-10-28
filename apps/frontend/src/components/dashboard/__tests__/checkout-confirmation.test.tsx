import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutConfirmation from '../CheckoutConfirmation';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { getCheckoutStatus } from '@/lib/stripe';
import { trackAdConversion } from '@/lib/analytics';

const getToken = vi.fn();
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken }) }));
vi.mock('@/lib/stripe', () => ({ getCheckoutStatus: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), trackAdConversion: vi.fn() }));
const paid = { sessionId: 'cs_test_1', paid: true, value: 7.99, currency: 'USD' };
const refresh = vi.fn();

function content(query: QueryClient, hasPaidAccess = false) {
  return <MemoryRouter><QueryClientProvider client={query}><LanguageProvider><CheckoutConfirmation hasPaidAccess={hasPaidAccess} /></LanguageProvider></QueryClientProvider></MemoryRouter>;
}

async function mount(search = '?success=true&session_id=cs_test_1') {
  window.history.replaceState({}, '', `/dashboard${search}`);
  const query = new QueryClient();
  const invalidate = vi.spyOn(query, 'invalidateQueries');
  const view = render(content(query));
  await act(async () => {});
  return { invalidate, view, query };
}

describe('checkout confirmation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    getToken.mockResolvedValue('token');
    vi.mocked(getCheckoutStatus).mockResolvedValue({ ...paid, paid: false });
    window.addEventListener('tickrify:analysis-created', refresh);
  });
  afterEach(() => {
    cleanup();
    window.removeEventListener('tickrify:analysis-created', refresh);
    vi.useRealTimers();
  });

  it('a URL de sucesso sozinha nao confirma pagamento nem atualiza acesso', async () => {
    const { invalidate } = await mount();
    expect(screen.getByText('Checking payment confirmation…')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.getByText('Payment confirmation is still pending.')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(trackAdConversion).not.toHaveBeenCalled();
    expect(window.location.search).toContain('session_id=cs_test_1');
  });

  it('pagamento atrasado so confirma apos resposta valida, preservando o valor real', async () => {
    vi.mocked(getCheckoutStatus).mockResolvedValueOnce({ ...paid, paid: false }).mockResolvedValueOnce(paid);
    const { invalidate } = await mount();
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByText('Payment confirmed. Updating your plan…')).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(trackAdConversion).toHaveBeenCalledWith('purchase', expect.objectContaining({ transactionId: 'cs_test_1', value: 7.99 }));
    expect(window.location.search).toBe('');
  });

  it.each([null, { ...paid, sessionId: 'cs_other' }])('falha ou sessao divergente nao confirma: %j', async (status) => {
    vi.mocked(getCheckoutStatus).mockResolvedValue(status);
    await mount();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.getByText('Payment confirmation is still pending.')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(trackAdConversion).not.toHaveBeenCalled();
    vi.mocked(getCheckoutStatus).mockResolvedValue(paid);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check again' })));
    expect(screen.getByText('Payment confirmed. Updating your plan…')).toBeTruthy();
  });

  it('sem sessao ou sem token, permite consultar assinatura sem afirmar ativacao', async () => {
    getToken.mockResolvedValue(null);
    await mount('?success=true');
    expect(screen.getByText('Payment confirmation is still pending.')).toBeTruthy();
    expect(getCheckoutStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'View subscription' }).getAttribute('href')).toBe('/dashboard/settings');
  });

  it('desmontar cancela a verificacao, sem efeitos tardios', async () => {
    await mount();
    cleanup();
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('webhook atrasado: reconsulta uso ate o acesso chegar, sem repetir confirmacao ou compra', async () => {
    vi.mocked(getCheckoutStatus).mockResolvedValue(paid);
    const { view, query } = await mount();
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Payment confirmed. Updating your plan…')).toBeTruthy();
    view.rerender(content(query, true));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(getCheckoutStatus).toHaveBeenCalledTimes(1);
    expect(trackAdConversion).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('webhook muito atrasado: para apos quatro reconsultas e permite nova tentativa manual', async () => {
    vi.mocked(getCheckoutStatus).mockResolvedValue(paid);
    await mount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledTimes(5); // Initial refresh + four bounded checks.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledTimes(5);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(refresh).toHaveBeenCalledTimes(6);
    cleanup();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(refresh).toHaveBeenCalledTimes(6);
    expect(trackAdConversion).toHaveBeenCalledTimes(1);
  });

  it('nao interpreta um valor truthy invalido como pagamento confirmado', async () => {
    vi.mocked(getCheckoutStatus).mockResolvedValue({ ...paid, paid: 'false' } as unknown as typeof paid);
    await mount();
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(screen.getByText('Payment confirmation is still pending.')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
