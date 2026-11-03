import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountLanguageSync, LanguageProvider, useLanguage } from '../LanguageContext';
import { getStoredLanguage, STORAGE_KEY } from '../index';

const state = vi.hoisted(() => ({ userId: null as string | null, getToken: vi.fn(), toast: vi.fn() }));
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ isLoaded: true, userId: state.userId, getToken: state.getToken }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: state.toast }));
const fetchMock = vi.fn();
const response = (language: unknown) => ({ ok: true, json: async () => ({ language }) });
function Choice() {
  const { language, setLanguage } = useLanguage();
  return <><output data-testid="language">{language}</output><button onClick={() => setLanguage('es')}>ES</button><button onClick={() => setLanguage('ja')}>JA</button></>;
}
const tree = () => <LanguageProvider><AccountLanguageSync><Choice /></AccountLanguageSync></LanguageProvider>;

beforeEach(() => {
  localStorage.clear();
  state.userId = null;
  state.getToken.mockReset().mockImplementation(async () => `token-${state.userId}`);
  state.toast.mockReset();
  fetchMock.mockReset().mockResolvedValue(response(null));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('language preference lifecycle', () => {
  it('defaults to English and keeps a guest choice after remount without API writes', () => {
    const view = render(tree());
    expect(screen.getByTestId('language').textContent).toBe('en');
    fireEvent.click(screen.getByText('ES'));
    expect(document.documentElement.lang).toBe('es');
    view.unmount();
    render(tree());
    expect(screen.getByTestId('language').textContent).toBe('es');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the account on login and another device, saves changes and restores after logout/login', async () => {
    const saved = new Map([['a', 'ja'], ['b', 'pt']]);
    fetchMock.mockImplementation(async (_url, init) => {
      const user = init.headers.Authorization.replace('Bearer token-', '');
      if (init.method === 'PATCH') saved.set(user, JSON.parse(init.body).language);
      return response(saved.get(user));
    });
    localStorage.setItem(STORAGE_KEY, 'de');
    state.userId = 'a';
    const view = render(tree());
    await waitFor(() => expect(screen.getByTestId('language').textContent).toBe('ja'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ja');
    fireEvent.click(screen.getByText('ES'));
    await waitFor(() => expect(saved.get('a')).toBe('es'));
    state.userId = null;
    view.rerender(tree());
    state.userId = 'b';
    view.rerender(tree());
    await waitFor(() => expect(screen.getByTestId('language').textContent).toBe('pt'));
    state.userId = null;
    view.rerender(tree());
    view.unmount();
    localStorage.clear(); // another device
    state.userId = 'a';
    render(tree());
    await waitFor(() => expect(screen.getByTestId('language').textContent).toBe('es'));
    expect(saved.get('b')).toBe('pt');
  });

  it('keeps the local choice when the account has never selected a language', async () => {
    localStorage.setItem(STORAGE_KEY, 'pt');
    state.userId = 'new-account';
    fetchMock.mockResolvedValue(response(null));
    render(tree());
    await waitFor(() => expect(screen.getByTestId('language').textContent).toBe('pt'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('pt');
    expect(fetchMock.mock.calls.every(([, init]) => init.method !== 'PATCH')).toBe(true);
  });

  it('does not apply a late response from the previous account', async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(response('pt'));
    state.userId = 'a';
    const view = render(tree());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    state.userId = 'b';
    view.rerender(tree());
    await waitFor(() => expect(screen.getByTestId('language').textContent).toBe('pt'));
    await act(async () => finish(response('ja')));
    expect(screen.getByTestId('language').textContent).toBe('pt');
  });

  it('serializes rapid changes so the last selection is what the server stores', async () => {
    state.userId = 'a';
    render(tree());
    await screen.findByTestId('language');
    fireEvent.click(screen.getByText('ES'));
    fireEvent.click(screen.getByText('JA'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(2));
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH').map(([, init]) => JSON.parse(init.body).language)).toEqual(['es', 'ja']);
  });

  it('works with blocked localStorage and reports a failed account write', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    state.userId = 'a';
    fetchMock.mockResolvedValueOnce(response('ja')).mockRejectedValue(new Error('offline'));
    render(tree());
    await waitFor(() => expect(screen.getByTestId('language').textContent).toBe('ja'));
    fireEvent.click(screen.getByText('ES'));
    expect(screen.getByTestId('language').textContent).toBe('es');
    await waitFor(() => expect(state.toast).toHaveBeenCalledTimes(1));
  });

  it('rejects prototype names and invalid language values from localStorage', () => {
    for (const value of ['toString', '__proto__', 'EN', 'xx']) {
      localStorage.setItem(STORAGE_KEY, value);
      expect(getStoredLanguage()).toBe('en');
    }
  });
});
