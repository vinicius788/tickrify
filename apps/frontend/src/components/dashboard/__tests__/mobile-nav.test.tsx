import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { BAR_ITEMS, MORE_ITEMS, MobileNav, type MobileNavSection } from '@/components/dashboard/MobileNav';

const openChat = vi.fn();
vi.mock('@/lib/support-chat', () => ({ openChat: (surface: string) => openChat(surface) }));
const track = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackCommunityClick: (location: string) => track(location),
}));

const PATHS: Record<MobileNavSection, string> = {
  home: '/dashboard', new: '/dashboard/new', trades: '/dashboard/trades', journal: '/dashboard/journal', watching: '/dashboard/watching',
  strategy: '/dashboard/strategy', plans: '/dashboard/plans', settings: '/dashboard/settings',
};

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function show(activeNav: MobileNavSection | null, counts = { alerts: 0, chat: 0 }, onNewAnalysis = vi.fn()) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <input aria-label="note" />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
        <MobileNav activeNav={activeNav} linkTo={(s) => PATHS[s]} onNewAnalysis={onNewAnalysis} counts={counts} signedIn />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

const nav = () => screen.getByTestId('bottom-nav');

describe('ilha de navegacao do celular', () => {
  beforeEach(() => {
    window.localStorage.setItem('tickrify-language', 'en');
    openChat.mockClear();
    track.mockClear();
  });
  afterEach(cleanup);

  it('5 itens na ordem combinada, com o Analisar no meio, numa nav com nome', () => {
    show('home');
    expect(screen.getByRole('navigation', { name: 'Dashboard navigation' })).toBe(nav());
    const items = [...nav().querySelectorAll('[data-nav]')].map((el) => el.getAttribute('data-nav'));
    expect(items).toEqual(['home', 'journal', 'new', 'trades', 'more']);
    expect(BAR_ITEMS).toHaveLength(4);
  });

  it.each([['home'], ['journal'], ['new'], ['trades']] as const)('item ativo pela URL: %s', (section) => {
    show(section);
    const current = nav().querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-nav')).toBe(section);
  });

  it.each([['watching'], ['strategy'], ['plans'], ['settings']] as const)('area dentro do Mais (%s) marca o Mais, sem aria-current na ilha', (section) => {
    show(section);
    expect(nav().querySelector('[aria-current="page"]')).toBeNull();
    expect(nav().querySelector('[data-nav="more"]')?.className).toContain('bg-[var(--fill-5)]');
  });

  it('cada item tem no minimo 44 px de toque e foco visivel', () => {
    show('home');
    for (const el of nav().querySelectorAll('[data-nav]')) {
      expect(el.className).toContain('min-h-[52px]');
      expect(el.className).toContain('focus-visible:outline');
    }
  });

  it('contadores: alertas (Watching) e chat ficam no Mais, somados na ilha e um em cada linha', () => {
    show('home', { alerts: 2, chat: 3 });
    expect(within(nav()).getByLabelText('5 new in More').textContent).toBe('5');
    expect(nav().querySelector('[data-nav="home"] [data-testid="bottom-nav-counter"]')).toBeNull();
    fireEvent.click(within(nav()).getByRole('button', { name: /More/ }));
    const sheet = screen.getByTestId('bottom-nav-more');
    expect(within(sheet).getByLabelText('2 price alerts reached').textContent).toBe('2');
    expect(within(sheet).getByLabelText(/3/).textContent).toBe('3');
    fireEvent.click(within(sheet).getByRole('link', { name: /Watching/ }));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/watching');
  });

  it('sem contador, nenhum circulo vermelho', () => {
    show('home');
    expect(screen.queryByTestId('bottom-nav-counter')).toBeNull();
  });

  it('Mais abre a folha com os itens da lista e navega pela URL', () => {
    show('home');
    fireEvent.click(within(nav()).getByRole('button', { name: 'More' }));
    const sheet = screen.getByTestId('bottom-nav-more');
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(MORE_ITEMS.length);
    fireEvent.click(within(sheet).getByRole('link', { name: 'Plans' }));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/plans');
  });

  it('Mais: chat abre a bolha na conversa e o Discord abre em nova aba com o evento', () => {
    show('home');
    fireEvent.click(within(nav()).getByRole('button', { name: 'More' }));
    const sheet = screen.getByTestId('bottom-nav-more');
    const discord = within(sheet).getByRole('link', { name: 'Join our Discord community' });
    expect(discord.getAttribute('target')).toBe('_blank');
    expect(discord.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(discord);
    expect(track).toHaveBeenCalledWith('app');
    fireEvent.click(within(nav()).getByRole('button', { name: 'More' }));
    fireEvent.click(within(screen.getByTestId('bottom-nav-more')).getByRole('button', { name: /Chat/ }));
    expect(openChat).toHaveBeenCalledWith('dashboard_more');
  });

  it('Analisar chama o envio limpo (o mesmo da barra lateral)', () => {
    const onNew = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    show('home', { alerts: 0, chat: 0 }, onNew);
    fireEvent.click(nav().querySelector('[data-nav="new"]')!);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('campo de texto em foco (teclado aberto): a ilha some e a bolha volta ao lugar', async () => {
    show('home');
    expect(nav().hidden).toBe(false);
    expect(document.documentElement.hasAttribute('data-bottom-nav')).toBe(true);
    const input = screen.getByLabelText('note');
    act(() => input.focus());
    expect(nav().hidden).toBe(true);
    expect(document.documentElement.hasAttribute('data-bottom-nav')).toBe(false);
    await act(async () => {
      input.blur();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(nav().hidden).toBe(false);
  });

  it('desmontar tira a marca do html (a bolha volta no resto do site)', () => {
    const { unmount } = show('home');
    unmount();
    expect(document.documentElement.hasAttribute('data-bottom-nav')).toBe(false);
  });
});
