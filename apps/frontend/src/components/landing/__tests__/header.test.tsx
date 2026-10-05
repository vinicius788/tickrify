import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import Header from '@/components/landing/Header';
import HeroSection from '@/components/landing/HeroSection';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ isLoaded: true, user: null }),
  SignedOut: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignedIn: () => null,
  SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
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
    expect(screen.getByRole('link', { name: 'Analyze my chart free' }).getAttribute('href')).toBe('/try');
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
