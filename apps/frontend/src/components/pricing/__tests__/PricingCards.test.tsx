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
const founder = { current: null as null | { active: boolean; priceUsd: number; seatsLeft: number | null; expiresAt: number | null }, lastCode: undefined as string | null | undefined };
vi.mock('@/hooks/useFoundingOffer', () => ({
  useFoundingOffer: () => offer.current,
  useFounderOffer: (code: string | null) => {
    founder.lastCode = code;
    return code ? founder.current : null;
  },
}));

import { PricingCards } from '@/components/pricing/PricingCards';
import { clearCheckoutIntent, loadCheckoutIntent } from '@/lib/checkoutIntent';
import { CheckoutError } from '@/lib/stripe';

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
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', 'yearly', 'usd', undefined, 'pricing', undefined);
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
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', 'monthly', 'usd', 'EARLY35', 'locked_value', undefined);
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
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', cycle, 'usd', coupon, 'pricing', undefined);
  });

  it('conta que ja tem assinatura (past_due incluso): avisa e leva para Configuracoes, onde fica o cartao', async () => {
    auth.isSignedIn = true;
    sessionStorage.clear();
    createCheckoutSession.mockRejectedValue(new CheckoutError('already subscribed', 'already_subscribed', 409));
    const location = stubLocation('https://tickrify.com/dashboard/plans');

    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: /^monthly/i }));
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));

    await waitFor(() => expect(location.assigned).toBe('/dashboard/settings'));
    const flash = JSON.parse(sessionStorage.getItem('tickrify_flash') ?? '{}');
    expect(flash.description).toBe('This account already has a subscription. Check its status or update your card in Settings.');
  });
});

describe('PricingCards: oferta do 1o mes', () => {
  afterEach(() => {
    cleanup();
    offer.current = null;
  });

  it('anual informa cobranca anual e franquia mensal sem custo unitario do mensal', async () => {
    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: /yearly/i }));
    expect(screen.getByText(/\$290 billed now and every year until canceled/)).toBeTruthy();
    expect(screen.getByText(/200 ticks\/mo/i)).toBeTruthy();
    expect(screen.queryByText(/0\.145/)).toBeNull();
    expect(screen.getByRole('button', { name: /get started.*\$290\/yr/i })).toBeTruthy();
  });

  it('com o EARLY35 ativo, so o mensal mostra o preco do 1o mes', async () => {
    offer.current = { active: true, code: 'EARLY35', percentOff: 35 };
    render(<PricingCards />);
    expect(screen.getByText(/Billed \$18\.85 now for the first month with EARLY35 \(35% off\)/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /yearly/i }));
    expect(screen.queryByText(/Billed .*now for the first month/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^weekly$/i }));
    expect(screen.queryByText(/Billed .*now for the first month/)).toBeNull();
  });

  it('sem cupom ativo, nenhuma promessa de desconto', () => {
    render(<PricingCards />);
    expect(screen.queryByText(/Billed .*now for the first month/)).toBeNull();
  });
});

describe('PricingCards: oferta Founding Member (link pessoal)', () => {
  const CODE = 'FND-ABCD2345';
  const active = { active: true, priceUsd: 15, seatsLeft: 27, expiresAt: Math.floor(Date.UTC(2026, 10, 4, 12) / 1000) };

  beforeEach(() => {
    clearCheckoutIntent();
    createCheckoutSession.mockReset();
    auth.getToken.mockReset().mockResolvedValue('tok');
    founder.current = null;
    founder.lastCode = undefined;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sem codigo na URL a oferta nao existe e o servidor nem e consultado', () => {
    founder.current = active;
    stubLocation('https://tickrify.com/pricing');
    render(<PricingCards />);
    expect(founder.lastCode).toBeNull();
    expect(screen.queryByText(/founding/i)).toBeNull();
  });

  it('codigo fora do formato e ignorado (EARLY35 digitado na URL nao abre nada)', () => {
    founder.current = active;
    stubLocation('https://tickrify.com/pricing?offer=EARLY35');
    render(<PricingCards />);
    expect(founder.lastCode).toBeNull();
    expect(screen.queryByText(/founding/i)).toBeNull();
  });

  it('codigo recusado pelo servidor (usado, vencido): pagina normal, sem cartao', () => {
    founder.current = null;
    stubLocation(`https://tickrify.com/pricing?offer=${CODE}`);
    render(<PricingCards />);
    expect(founder.lastCode).toBe(CODE);
    expect(screen.queryByText(/founding/i)).toBeNull();
  });

  it('codigo valido: mostra US$ 15, vagas reais e validade, e o plano normal segue abaixo', () => {
    founder.current = active;
    stubLocation(`https://tickrify.com/pricing?offer=${CODE.toLowerCase()}`);
    render(<PricingCards />);
    expect(founder.lastCode).toBe(CODE);
    expect(screen.getByText('$15')).toBeTruthy();
    expect(screen.getByText('27 founding spots left')).toBeTruthy();
    expect(screen.getByText(/Your personal link expires on November 4/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /claim my founding price/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /get started/i })).toBeTruthy();
  });

  it('logado: o clique abre o checkout mensal com o codigo e SEM EARLY35', async () => {
    auth.isSignedIn = true;
    founder.current = active;
    createCheckoutSession.mockResolvedValue({ sessionId: 'cs_f', url: 'https://checkout.stripe.com/c/pay/cs_f' });
    const location = stubLocation(`https://tickrify.com/dashboard/plans?offer=${CODE}`);

    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: /claim my founding price/i }));

    await waitFor(() => expect(location.assigned).toBe('https://checkout.stripe.com/c/pay/cs_f'));
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', 'monthly', 'usd', undefined, 'pricing', CODE);
  });

  it('deslogado: guarda o codigo na intencao e o login devolve para o checkout com ele', async () => {
    auth.isSignedIn = false;
    founder.current = active;
    const location = stubLocation(`https://tickrify.com/pricing?offer=${CODE}`);

    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: /claim my founding price/i }));

    expect(location.assigned).toBe(
      `/sign-in?redirect_url=${encodeURIComponent(`/dashboard/plans?checkout=starter&cycle=monthly&source=pricing&offer=${CODE}`)}`,
    );
    expect(loadCheckoutIntent()).toEqual({ plan: 'starter', cycle: 'monthly', source: 'pricing', offer: CODE });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it('volta do login com o codigo: abre o checkout sozinho, uma vez, com o codigo', async () => {
    auth.isSignedIn = true;
    founder.current = active;
    createCheckoutSession.mockResolvedValue({ sessionId: 'cs_r', url: 'https://checkout.stripe.com/c/pay/cs_r' });
    const location = stubLocation(
      `https://tickrify.com/dashboard/plans?checkout=starter&cycle=monthly&source=pricing&offer=${CODE}`,
    );

    render(<PricingCards />);

    await waitFor(() => expect(location.assigned).toBe('https://checkout.stripe.com/c/pay/cs_r'));
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).toHaveBeenCalledWith('starter', 'tok', 'monthly', 'usd', undefined, 'pricing', CODE);
  });

  it('servidor recusa o codigo no checkout: erro na tela e nenhum redirect para o preco cheio', async () => {
    auth.isSignedIn = true;
    founder.current = active;
    createCheckoutSession.mockRejectedValue(new CheckoutError('This offer is no longer available.', 'founder_offer_unavailable', 409));
    const location = stubLocation(`https://tickrify.com/dashboard/plans?offer=${CODE}`);

    render(<PricingCards />);
    await userEvent.click(screen.getByRole('button', { name: /claim my founding price/i }));

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(location.assigned).toBe('');
  });
});
