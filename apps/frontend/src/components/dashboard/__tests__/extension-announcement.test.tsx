import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExtensionAnnouncement, { EXTENSION_STORE_URL } from '@/components/dashboard/ExtensionAnnouncement';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { track } from '@/lib/analytics';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

const STORE = 'https://chromewebstore.google.com/detail/tickrify/abc';
const CHROME_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function renderCard(storeUrl?: string) {
  return render(
    <LanguageProvider>
      <ExtensionAnnouncement storeUrl={storeUrl} />
    </LanguageProvider>,
  );
}

describe('card de novidade da extensao', () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent(CHROME_DESKTOP);
    vi.mocked(track).mockClear();
  });
  afterEach(cleanup);

  it('fica desligado enquanto a extensao nao esta na loja', () => {
    expect(EXTENSION_STORE_URL).toBe('');
    const { container } = renderCard();
    expect(container.innerHTML).toBe('');
  });

  it('com o link da loja, no Chrome do computador, mostra logo, texto e o link', () => {
    renderCard(STORE);
    expect(screen.getByRole('img', { name: 'Tickrify' })).toBeTruthy();
    expect(screen.getByText('New: Tickrify for Chrome')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Add to Chrome' });
    expect(link.getAttribute('href')).toBe(STORE);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(track).toHaveBeenCalledWith('extension_card_viewed');
  });

  it('nao aparece no celular nem no Safari (a extensao nao roda la)', () => {
    setUserAgent(CHROME_ANDROID);
    expect(renderCard(STORE).container.innerHTML).toBe('');
    cleanup();
    setUserAgent(SAFARI_DESKTOP);
    expect(renderCard(STORE).container.innerHTML).toBe('');
  });

  it('"Not now" esconde e lembra por 30 dias', () => {
    renderCard(STORE);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('New: Tickrify for Chrome')).toBeNull();
    expect(track).toHaveBeenCalledWith('extension_card_dismissed');
    const until = Number(localStorage.getItem('tickrify_extension_card_hidden_until'));
    expect(until - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    cleanup();
    expect(renderCard(STORE).container.innerHTML).toBe('');
  });

  it('clicar em "Add to Chrome" esconde de vez', () => {
    renderCard(STORE);
    fireEvent.click(screen.getByRole('link', { name: 'Add to Chrome' }));
    expect(track).toHaveBeenCalledWith('extension_card_clicked');
    cleanup();
    expect(renderCard(STORE).container.innerHTML).toBe('');
  });
});
