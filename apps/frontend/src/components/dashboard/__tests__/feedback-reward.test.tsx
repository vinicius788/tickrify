import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FeedbackRewardCard from '@/components/dashboard/FeedbackRewardCard';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({ useAuth: () => ({ getToken: async () => 'tok' }) }));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
const refreshUsage = vi.fn();
vi.mock('@/hooks/useAnalysisLimit', () => ({ refreshUsage: () => refreshUsage() }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const fetchMock = vi.fn();
const SENTENCE = 'The plan was clear and easy to follow.';

function renderCard(source: 'home' | 'limit' = 'limit') {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LanguageProvider>
        <FeedbackRewardCard source={source} prominent={source === 'limit'} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('FeedbackRewardCard', () => {
  beforeEach(() => {
    [fetchMock, track, refreshUsage, toast].forEach((m) => m.mockReset());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mostra o texto combinado e conta o pedido com a origem', () => {
    renderCard('home');
    expect(screen.getByText('Tell us what you think')).toBeTruthy();
    expect(screen.getByText('Share one sentence about Tickrify and get 3 extra analyses for free.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send feedback and get 3 analyses' })).toBeTruthy();
    expect(track).toHaveBeenCalledWith('feedback_prompt_shown', { source: 'home' });
  });

  it('frase curta nao chama o servidor', async () => {
    renderCard();
    await userEvent.type(screen.getByRole('textbox'), 'too short');
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback and get 3 analyses' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('15');
  });

  it('envio aceito agradece, manda a origem e rele a cota', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ bonusAnalyses: 3 }) });
    renderCard();
    await userEvent.type(screen.getByRole('textbox'), SENTENCE);
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback and get 3 analyses' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Thanks. 3 analyses were added to your account.' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: SENTENCE, source: 'limit' });
    expect(refreshUsage).toHaveBeenCalled();
    // O texto nunca vai ao PostHog.
    expect(JSON.stringify(track.mock.calls)).not.toContain('plan was clear');
  });

  it('oferta ja usada avisa e rele a cota para o card sair', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'feedback_already_used' }) });
    renderCard();
    await userEvent.type(screen.getByRole('textbox'), SENTENCE);
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback and get 3 analyses' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This offer was already used on this account.'));
    expect(toast).not.toHaveBeenCalled();
    expect(refreshUsage).toHaveBeenCalled();
  });
});
