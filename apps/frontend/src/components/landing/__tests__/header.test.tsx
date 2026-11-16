import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import Header from '@/components/landing/Header';
import HeroSection from '@/components/landing/HeroSection';
import FoundingTraderBanner from '@/components/landing/FoundingTraderBanner';
import PricingSection from '@/components/landing/PricingSection';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ isLoaded: true, user: null }),
  SignedOut: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignedIn: () => null,
  SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const offer = { current: null as null | { active: boolean; code: string; percentOff: number | null } };
vi.mock('@/hooks/useFoundingOffer', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/hooks/useFoundingOffer')>();
  return {
    ...mod,
    useFoundingOffer: () => offer.current,
    useLocalPrices: (language: Parameters<typeof mod.localPricesFrom>[1]) => mod.localPricesFrom(null, language),
  };
});
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  warmupPaymentsApi: vi.fn(),
}));

function renderSite(node: ReactNode) {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </LanguageProvider>,
  );
}

describe('cabecalho e topo da home no celular', () => {
  afterEach(() => cleanup());

  it('"Log in" aparece em toda largura; o botao principal leva a analise gratis, nao ao cadastro', () => {
    renderSite(<Header />);
    const login = screen.getByRole('button', { name: 'Login' });
    expect(login.closest('.hidden')).toBeNull();
    const cta = screen.getByRole('link', { name: 'Analyze my chart free' });
    expect(cta.getAttribute('href')).toBe('/try');
    // No celular o botao some (o menu tem o mesmo link); `hidden` fica no
    // invólucro porque `.site-btn` ganharia do Tailwind no proprio link.
    expect(cta.parentElement?.className).toContain('hidden');
  });

  it('o menu abre FIXO na tela, com analise gratis, links e login', async () => {
    const user = userEvent.setup();
    renderSite(<Header />);
    await user.click(screen.getByRole('button', { name: 'Main menu' }));
    const painel = await screen.findByRole('dialog');
    // `.tk-site` no painel trocava o `fixed` por `relative` e jogava o menu no fim da pagina.
    expect(painel.className).not.toContain('tk-site');
    expect(painel.className).toContain('fixed');
    const menu = within(painel);
    expect(menu.getByRole('link', { name: 'Analyze my chart free' }).getAttribute('href')).toBe('/try');
    expect(menu.getByRole('link', { name: 'Login' }).getAttribute('href')).toBe('/sign-in');
    expect(menu.getByRole('link', { name: 'FAQ' })).toBeTruthy();
  });

  it('topo da home tem um botao so, que leva a analise gratis', () => {
    renderSite(<HeroSection />);
    const acoes = document.querySelector('.site-hero-actions');
    expect(acoes?.querySelectorAll('a, button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Analyze my chart free/ })).toBeTruthy();
  });
});

describe('faixa da oferta de lancamento', () => {
  afterEach(() => {
    cleanup();
    offer.current = null;
  });

  it('diz a oferta real (desconto no 1o mes do mensal), sem prometer trava de preco', () => {
    offer.current = { active: true, code: 'EARLY35', percentOff: 35 };
    renderSite(<FoundingTraderBanner />);
    expect(
      screen.getByText(/35% off your first month on the monthly plan with EARLY35, applied at checkout\. Then \$29\/month\./),
    ).toBeTruthy();
    expect(screen.queryByText(/lock/i)).toBeNull();
  });

  it('sem cupom ativo, a faixa nao aparece', () => {
    const { container } = renderSite(<FoundingTraderBanner />);
    expect(container.textContent).toBe('');
  });

  it('secao de preco da home com EARLY35 ativo: $29 riscado, preco do 1o mes e botao do 1o mes', () => {
    offer.current = { active: true, code: 'EARLY35', percentOff: 35 };
    const { container } = renderSite(<PricingSection />);
    expect(container.querySelector('.site-price-amt s')?.textContent).toBe('Regular price $29');
    expect(container.querySelector('.site-price-amt b')?.textContent).toBe('$18.85');
    expect(screen.getByText('Then $29/month. Cancel anytime in Settings.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start for $18.85 first month' })).toBeTruthy();
    expect(screen.queryByText('Billed $29 now and monthly until canceled.')).toBeNull();
  });

  it('secao de preco da home sem oferta: $29 sem risco', () => {
    const { container } = renderSite(<PricingSection />);
    expect(container.querySelector('s')).toBeNull();
    expect(container.querySelector('.site-price-amt b')?.textContent).toBe('$29');
    expect(screen.getByText('Billed $29 now and monthly until canceled.')).toBeTruthy();
  });
});
