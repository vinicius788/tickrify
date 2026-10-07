import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RatingCard from '@/components/dashboard/RatingCard';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

function renderCard() {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <RatingCard analysisId="cmanalysis12345" />
    </LanguageProvider>,
  );
}

describe('estrelas abaixo do resultado', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    track.mockReset();
  });

  it('nota alta: grava a nota, pede a frase e manda a licenca junto; texto nunca vai ao PostHog', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'rating_abc1234567' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderCard();

    await user.click(screen.getByRole('button', { name: '5 stars' }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/ratings',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ analysisId: 'cmanalysis12345', rating: 5 }) }),
    );
    await user.type(screen.getByPlaceholderText(/What you use Tickrify for/), 'Keeps me disciplined');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const [, init] = fetchMock.mock.calls[1];
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/api/ratings/rating_abc1234567');
    expect(JSON.parse(init.body)).toEqual({ comment: 'Keeps me disciplined', quoteConsent: true });
    expect(await screen.findByText('Thanks, this goes straight to Vinícius.')).toBeTruthy();
    expect(JSON.stringify(track.mock.calls)).not.toContain('Keeps me disciplined');
  });

  it('nota baixa: pergunta o que faltou com a lista fechada', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'rating_abc1234567' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderCard();

    await user.click(screen.getByRole('button', { name: '2 stars' }));
    await user.click(screen.getByRole('button', { name: 'Too many WAITs' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ reasons: ['too_many_waits'], comment: '' });
  });

  it('quem ja respondeu nao ve de novo por um tempo', () => {
    window.localStorage.setItem('tickrify-rating-answered-at', String(Date.now()));
    renderCard();
    expect(screen.queryByText('How useful was this read?')).toBeNull();
  });
});
