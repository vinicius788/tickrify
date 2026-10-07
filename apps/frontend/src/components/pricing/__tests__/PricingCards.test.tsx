import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const auth = { isSignedIn: false, isLoaded: true, getToken: vi.fn() };
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => auth }));

const createCheckoutSession = vi.fn();
vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  return { ...actual, createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args) };
});
vi.mock('../../../lib/api', () => ({ warmupPaymentsApi: vi.fn() }));
vi.mock('../../../lib/analytics', () => ({ track: vi.fn() }));
vi.mock('../../../hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
const offer = { current: null as null | { active: boolean; code: string; percentOff: number | null } };
vi.mock('@/hooks/useFoundingOffer', () => ({ useFoundingOffer: () => offer.current }));

import { PricingCards } from '@/components/pricing/PricingCards';
import { clearCheckoutIntent, loadCheckoutIntent } from '@/lib/checkoutIntent';

/** Troca `window.location` por um objeto que registra o destino do redirect. */
function stubLocation(url: string) {
  const location = new URL(url);
  const stub = {
    get href() { return location.href; },
    set href(value: string) { stub.assigned = value; },
    get search() { return location.search; },
    get pathname() { return location.pathname; },
    get hash() { return location.hash; },
    get origin() { return location.origin; },
    assigned: '' as string,
  };
  vi.stubGlobal('location', stub);
  Object.defineProperty(window, 'location', { value: stub, configurable: true });
  window.history.replaceState({}, '', location.pathname + location.search);
  return stub;
}

describe('PricingCards: Upgrade -> login -> checkout', () => {
  beforeEach(() => {
    clearCheckoutIntent();
    createCheckoutSession.mockReset();
    auth.getToken.mockReset().mockResolvedValue('tok');
  });

  afterEach(() => {
    // Sem config global do Vitest a tela nao desmonta sozinha entre testes.
    cleanup();
    vi.unstubAllGlobals();
  });

  it('deslogado: guarda a intencao e manda para o login com redirect de volta ao checkout', async () => {
    auth.isSignedIn = false;
    const location = stubLocation('https://tickrify.com/pricing');

    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: /yearly/i }));
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));

    expect(location.assigned).toBe(
      '/sign-in?redirect_url=%2Fdashboard%2Fplans%3Fcheckout%3Dstarter%26cycle%3Dyearly%26source%3Dpricing',
    );
    expect(loadCheckoutIntent()).toEqual({ plan: 'starter', cycle: 'yearly', source: 'pricing' });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('volta do login: abre o checkout do plano e ciclo escolhidos, sozinho, uma vez', async () => {
    auth.isSignedIn = true;
    createCheckoutSession.mockResolvedValue({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    const location = stubLocation('https://tickrify.com/pricing?checkout=starter&cycle=yearly&source=pricing');

    render(<PricingCards />);

    await waitFor(() => expect(location.assigned).toBe('https://checkout.stripe.com/c/pay/cs_1'));
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    // EARLY35 e so do mensal: o anual vai sem cupom.
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', 'yearly', 'usd', undefined, 'pricing');
    expect(loadCheckoutIntent()).toBeNull();
  });

  it('volta sem a URL (One Tap, outra aba): usa a intencao guardada', async () => {
    auth.isSignedIn = true;
    localStorage.setItem(
      'tickrify_checkout_intent',
      JSON.stringify({ plan: 'starter', cycle: 'monthly', source: 'locked_value', savedAt: Date.now() }),
    );
    createCheckoutSession.mockResolvedValue({ sessionId: 'cs_2', url: 'https://checkout.stripe.com/c/pay/cs_2' });
    const location = stubLocation('https://tickrify.com/pricing');

    render(<PricingCards />);

    await waitFor(() => expect(location.assigned).toBe('https://checkout.stripe.com/c/pay/cs_2'));
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', 'monthly', 'usd', 'EARLY35', 'locked_value');
  });

  it('logado sem intencao: nao abre checkout sozinho', async () => {
    auth.isSignedIn = true;
    stubLocation('https://tickrify.com/pricing');

    render(<PricingCards />);
    await new Promise((r) => setTimeout(r, 20));

    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('ainda deslogado na volta: nao tenta checkout e mantem a intencao', async () => {
    auth.isSignedIn = false;
    localStorage.setItem(
      'tickrify_checkout_intent',
      JSON.stringify({ plan: 'starter', cycle: 'monthly', source: 'pricing', savedAt: Date.now() }),
    );
    stubLocation('https://tickrify.com/pricing?checkout=starter');

    render(<PricingCards />);
    await new Promise((r) => setTimeout(r, 20));

    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(loadCheckoutIntent()).not.toBeNull();
  });

  it.each([
    ['weekly', undefined],
    ['monthly', 'EARLY35'],
    ['yearly', undefined],
  ] as const)('logado, clique no ciclo %s: cupom %s', async (cycle, coupon) => {
    auth.isSignedIn = true;
    createCheckoutSession.mockResolvedValue({ sessionId: 'cs_c', url: 'https://checkout.stripe.com/c/pay/cs_c' });
    stubLocation('https://tickrify.com/dashboard/plans');

    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${cycle}`, 'i') }));
    await userEvent.click(screen.getByRole('button', { name: /get started|start weekly/i }));

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', cycle, 'usd', coupon, 'pricing');
  });
});

describe('PricingCards: oferta do 1o mes', () => {
  afterEach(() => {
    cleanup();
    offer.current = null;
  });

  it('com o EARLY35 ativo, so o mensal mostra o preco do 1o mes', async () => {
    offer.current = { active: true, code: 'EARLY35', percentOff: 35 };
    render(<PricingCards />);
    expect(screen.getByText(/First month \$18\.85 with EARLY35 \(35% off\)/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /yearly/i }));
    expect(screen.queryByText(/First month/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^weekly$/i }));
    expect(screen.queryByText(/First month/)).toBeNull();
  });

  it('sem cupom ativo, nenhuma promessa de desconto', () => {
    render(<PricingCards />);
    expect(screen.queryByText(/First month/)).toBeNull();
  });
});
