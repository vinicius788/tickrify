import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoPayLink, CryptoReturnNotice } from '@/components/dashboard/CryptoPass';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok') }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
const limit = vi.fn();
vi.mock('@/hooks/useAnalysisLimit', () => ({ useAnalysisLimit: () => limit() }));

const crypto = (over: Record<string, unknown> = {}) => ({
  crypto: { enabled: true, paymentMethod: null, passEndsAt: null, passEndedAt: null, ...over },
});

function withLanguage(node: React.ReactNode) {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(<LanguageProvider>{node}</LanguageProvider>);
}

describe('pagar com cripto', () => {
  beforeEach(() => {
    limit.mockReturnValue(crypto());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    track.mockReset();
    window.history.replaceState({}, '', '/');
  });

  it('some sem o NOWPayments configurado e para quem assina no cartao', () => {
    limit.mockReturnValue(crypto({ enabled: false }));
    withLanguage(<CryptoPayLink surface="paywall" />);
    expect(screen.queryByText('Pay with crypto (USDT or USDC)')).toBeNull();
    cleanup();
    limit.mockReturnValue(crypto({ paymentMethod: 'card' }));
    withLanguage(<CryptoPayLink surface="paywall" />);
    expect(screen.queryByText('Pay with crypto (USDT or USDC)')).toBeNull();
  });

  it('abre os dois passes e manda so o tipo do passe ao servidor', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: 'https://nowpayments.io/payment/?iid=1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, set href(v: string) { assign(v); } });
    withLanguage(<CryptoPayLink surface="paywall" />);

    await user.click(screen.getByText('Pay with crypto (USDT or USDC)'));
    expect(track).toHaveBeenCalledWith('crypto_cta_clicked', { surface: 'paywall' });
    expect(screen.getByText('$7.99')).toBeTruthy();
    expect(screen.getByText('$29')).toBeTruthy();

    await user.click(screen.getByText('200 analyses'));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/crypto/checkout',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ pass: 'month' }) }),
    );
    expect(assign).toHaveBeenCalledWith('https://nowpayments.io/payment/?iid=1');
  });

  it('servidor recusou por assinatura de cartao: avisa na janela', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'already_subscribed' }) }));
    withLanguage(<CryptoPayLink surface="plans" />);
    await user.click(screen.getByText('Pay with crypto (USDT or USDC)'));
    await user.click(screen.getByText('25 analyses'));
    expect(await screen.findByText('You already have an active card subscription.')).toBeTruthy();
  });

  it('volta do pagamento: confirma ate o servidor dizer que o passe ligou', async () => {
    window.history.replaceState({}, '', '/dashboard?crypto=success&order=ckorder123456');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'confirming', active: false }) })
      .mockResolvedValue({ ok: true, json: async () => ({ status: 'finished', active: true }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    withLanguage(<CryptoReturnNotice />);
    expect(await screen.findByText('Payment received, confirming on the blockchain')).toBeTruthy();
    expect(window.location.search).toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(await screen.findByText('Your crypto pass is active')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/crypto/payment/ckorder123456', expect.anything());
  });

  it('volta cancelada nao consulta nada e avisa que nada foi cobrado', async () => {
    window.history.replaceState({}, '', '/dashboard/plans?crypto=canceled');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    withLanguage(<CryptoReturnNotice />);
    expect(await screen.findByText('Crypto payment canceled')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
