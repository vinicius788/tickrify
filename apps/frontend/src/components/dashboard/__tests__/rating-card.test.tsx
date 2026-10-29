import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RatingCard from '@/components/dashboard/RatingCard';
import { adminListRatings, shouldAskUsefulness, markUsefulnessAsked, markUsefulnessAnswered } from '@/lib/ratings';
import { getTranslations, LANGUAGES } from '@/lib/i18n';
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


describe('authenticated free/trial usefulness', () => {
  let observer: IntersectionObserverCallback;
  let account = 0;
  let userId: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    window.localStorage.clear();
    userId = `usefulness-test-${++account}`;
    window.localStorage.setItem('tickrify-language', 'en');
    fetchMock = vi.fn(async (_url, init) => ({ ok: true, json: async () => init?.method === 'GET' ? { eligible: true, modality: 'trial', verdict: 'WATCH' } : { id: 'cmrating12345', duplicate: false } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { observer = callback; }
      observe() {} disconnect() {} unobserve() {}
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); track.mockReset(); });
  function card(id = 'cmanalysis12345') {
    return render(<LanguageProvider><RatingCard analysisId={id} usefulnessUserId={userId} /></LanguageProvider>);
  }
  async function show() {
    card();
    await screen.findByRole('region', { name: 'Was this analysis useful?' });
  }
  function enterView() {
    act(() => observer([{ isIntersecting: true, intersectionRatio: 0.75 } as IntersectionObserverEntry], {} as IntersectionObserver));
  }

  it('counts actual visible question once, never server eligibility or an off-screen mount', async () => {
    await show();
    expect(track).not.toHaveBeenCalled();
    act(() => observer([{ isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(track).not.toHaveBeenCalled();
    enterView(); enterView();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('analysis_usefulness_viewed', { analysisId: 'cmanalysis12345', modality: 'trial', verdict: 'WATCH' });
    expect(shouldAskUsefulness(userId, 'cmanalysis12345')).toBe(false);
  });

  it('Yes persists before thanks, never grants quote consent or sends free text to analytics', async () => {
    const user = userEvent.setup(); await show(); enterView();
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await screen.findByRole('status');
    expect(fetchMock.mock.calls[1]).toEqual(['https://api.test/api/ratings/usefulness', expect.objectContaining({ method: 'POST', keepalive: true, body: JSON.stringify({ analysisId: 'cmanalysis12345', useful: true }), headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })]);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('No is saved immediately; all six optional reasons use closed codes', async () => {
    const user = userEvent.setup(); await show();
    await user.click(screen.getByRole('button', { name: 'No' }));
    await screen.findByText('What was missing?');
    for (const label of ['Hard to understand', 'The next step was unclear', 'Incorrect levels or asset', 'I don’t trust the analysis', 'Too slow', 'Something else']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'The next step was unclear' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('status');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ reasons: ['next_step_unclear'], kind: 'usefulness' });
  });

  it('reasons are optional, and duplicate answers do not reopen the reason editor', async () => {
    const user = userEvent.setup(); await show();
    await user.click(screen.getByRole('button', { name: 'No' }));
    await screen.findByText('What was missing?');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await screen.findByRole('status');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanup(); userId = `duplicate-${account}`;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ eligible: true, modality: 'legacy', verdict: 'NO_TRADE', id: 'cmrating12345', duplicate: true }) });
    await show(); await user.click(screen.getByRole('button', { name: 'No' }));
    await screen.findByRole('status'); expect(screen.queryByText('What was missing?')).toBeNull();
  });

  it('failed submission keeps the question retryable and never marks an answer', async () => {
    const user = userEvent.setup(); await show();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('status')).toBeNull();
    expect(shouldAskUsefulness(userId, 'other-analysis')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await screen.findByRole('status');
  });

  it('hides on denied eligibility, network/backend failure, and does not retry in a loop', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ eligible: false }) });
    const view = card(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender(<LanguageProvider><RatingCard analysisId="cmanalysis12345" usefulnessUserId={userId} /></LanguageProvider>);
    expect(screen.queryByRole('region')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanup(); userId = `offline-${account}`;
    fetchMock.mockRejectedValue(new Error('offline')); card();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('frequency is account-scoped: first result, weekly after exposure, monthly after reply, never same analysis', () => {
    const now = Date.now();
    expect(shouldAskUsefulness(userId, 'first')).toBe(true);
    markUsefulnessAsked(userId, 'first');
    expect(shouldAskUsefulness(userId, 'second', now + 86400_000)).toBe(false);
    expect(shouldAskUsefulness(userId, 'second', now + 8 * 86400_000)).toBe(true);
    expect(shouldAskUsefulness(userId, 'first', now + 365 * 86400_000)).toBe(false);
    markUsefulnessAnswered(userId, 'first');
    expect(shouldAskUsefulness(userId, 'second', now + 29 * 86400_000)).toBe(false);
    expect(shouldAskUsefulness(userId, 'second', now + 31 * 86400_000)).toBe(true);
    expect(shouldAskUsefulness(`${userId}-other`, 'first')).toBe(true);
  });

  it('paid accounts keep stars and skip analyses already rated, including after upgrade', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ answered: false, recentAnswered: false, modality: 'paid', eligible: false }) });
    render(<LanguageProvider><RatingCard analysisId="cmpaidanalysis1" userId={userId} /></LanguageProvider>);
    expect(await screen.findByRole('button', { name: '5 stars' })).toBeTruthy();
    expect(screen.queryByText('Was this analysis useful?')).toBeNull();
    cleanup();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ answered: true, recentAnswered: false }) });
    render(<LanguageProvider><RatingCard analysisId="cmpaidanalysis2" userId={userId} /></LanguageProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: '5 stars' })).toBeNull();
  });

  it('old backend: free question hides, paid stars stay functional, binary admin rows normalize and mixed averages hide', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    render(<LanguageProvider><RatingCard analysisId="cmpaidoldapi1" userId={userId} /></LanguageProvider>);
    expect(await screen.findByRole('button', { name: '5 stars' })).toBeTruthy();
    cleanup(); userId = `old-api-${account}`;
    card(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region')).toBeNull();
    const binary = { kind: 'usefulness', version: 1, useful: false, modality: 'trial', verdict: 'WATCH', reasons: ['other'] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'r1', rating: 1, reasons: binary }, { id: 'r2', rating: 4, reasons: ['too_slow'] }], averages: [{ average: 2.5, count: 2 }] }) });
    const report = await adminListRatings('tok');
    expect(report.items[0]).toMatchObject({ feedback: binary, reasons: ['other'] });
    expect(report.items[1]).toMatchObject({ rating: 4, reasons: ['too_slow'], feedback: null });
    expect(report.averages).toEqual([]); expect(report.averagesUnavailable).toBe(true);
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.test/api/admin/ratings?includeUsefulness=true');
  });

  it('new backend advertises separated star averages; paid history never offers invalid stars for a trial analysis', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ eligible: true, modality: 'trial', answered: false, recentAnswered: false }) });
    render(<LanguageProvider><RatingCard analysisId="cmpaidhistory1" userId={userId} /></LanguageProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '5 stars' })).toBeNull();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], supportsUsefulness: true, averages: [{ recommendation: 'BUY', average: 4, count: 1 }] }) });
    const report = await adminListRatings('tok');
    expect(report.averages).toEqual([{ recommendation: 'BUY', average: 4, count: 1 }]);
    expect(report.averagesUnavailable).toBe(false);
  });

  it('No dispatches a keepalive response before reasons; leaving the page does not depend on submitting reasons', async () => {
    const user = userEvent.setup(); const view = card();
    await screen.findByRole('region', { name: 'Was this analysis useful?' });
    let finish!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', keepalive: true, body: JSON.stringify({ analysisId: 'cmanalysis12345', useful: false }) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { finish({ ok: true, json: async () => ({ id: 'cmrating12345', duplicate: false }) }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(LANGUAGES)('uses existing translated components in $code', async ({ code }) => {
    window.localStorage.setItem('tickrify-language', code); card();
    expect(await screen.findByRole('region', { name: getTranslations(code).rating.usefulnessQuestion })).toBeTruthy();
  });
});
