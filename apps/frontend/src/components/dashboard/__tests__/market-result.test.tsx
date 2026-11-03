import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketResultCard, TrackRecordCard } from '@/components/dashboard/MarketResult';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok'), isSignedIn: true }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

const CREATED = '2026-10-10T09:41:00Z';
const created = Date.parse(CREATED);

function renderResult(props: Partial<Parameters<typeof MarketResultCard>[0]> = {}) {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <MarketResultCard analysisId="an_1" createdAt={CREATED} now={created + 3 * 3600_000} {...props} />
    </LanguageProvider>,
  );
}

describe('48 hours later', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    track.mockReset();
  });

  it('antes de medir: diz que o resultado sai depois das 48h, sem evento', () => {
    renderResult({ marketOutcome: null });
    expect(screen.getByText('Result pending')).toBeTruthy();
    expect(screen.getByText(/48 hours after the read/)).toBeTruthy();
    expect(track).not.toHaveBeenCalled();
  });

  it('sem resultado depois de 72h: o quadro some em vez de prometer data velha', () => {
    const { container } = renderResult({ marketOutcome: null, now: created + 80 * 3600_000 });
    expect(container.querySelector('[data-testid="market-result"]')).toBeNull();
  });

  it('acerto: alvo 1 com o R, alvo 2 quando houve, e um evento so com o resultado', () => {
    renderResult({ marketOutcome: 'WIN', marketTp1R: 2, marketTp2Hit: true });
    expect(screen.getByText('Target 1 reached, +2.0R')).toBeTruthy();
    expect(screen.getByText(/Target 2 was reached too/)).toBeTruthy();
    expect(screen.getByText(/not a guaranteed fill/)).toBeTruthy();
    expect(track).toHaveBeenCalledWith('market_result_viewed', { outcome: 'WIN' });
  });

  it('erro aparece do mesmo jeito que o acerto', () => {
    renderResult({ marketOutcome: 'LOSS' });
    expect(screen.getByText('Stop hit, -1R')).toBeTruthy();
    expect(screen.getByText(/hit the stop before Target 1/)).toBeTruthy();
  });

  it('entrada nao atingida e "nada em 48h" nao contam como trade', () => {
    renderResult({ marketOutcome: 'NO_FILL' });
    expect(screen.getByText('Entry not reached')).toBeTruthy();
    cleanup();
    renderResult({ marketOutcome: 'TIMEOUT' });
    expect(screen.getByText('No target, no stop')).toBeTruthy();
  });

  it('sem dados de mercado: "nao medido", nunca um resultado inventado', () => {
    renderResult({ marketOutcome: 'UNTRACKABLE' });
    expect(screen.getByText('Not measured')).toBeTruthy();
  });

  it('em portugues', () => {
    window.localStorage.setItem('tickrify-language', 'pt');
    render(
      <LanguageProvider>
        <MarketResultCard analysisId="an_1" createdAt={CREATED} marketOutcome="LOSS" />
      </LanguageProvider>,
    );
    expect(screen.getByText('Stop atingido, -1R')).toBeTruthy();
  });
});

describe('Your track record', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    track.mockReset();
  });

  function renderRecord(body: unknown, ok = true) {
    window.localStorage.setItem('tickrify-language', 'en');
    const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(
      <LanguageProvider>
        <TrackRecordCard />
      </LanguageProvider>,
    );
    return { fetchMock, ...view };
  }

  it('mostra as contagens dos ultimos 30 dias do proprio usuario', async () => {
    const { fetchMock } = renderRecord({ days: 30, plans: 10, win: 3, loss: 4, noFill: 1, timeout: 0, pending: 2 });
    await waitFor(() => expect(screen.getByText('Automatic market review')).toBeTruthy());
    expect(screen.getByText(/not your executed trades or recorded P&L/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/ai/track-record',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
    expect(screen.getByText('Reached Target 1').previousSibling?.textContent).toBe('3');
    expect(screen.getByText('Hit the stop').previousSibling?.textContent).toBe('4');
    // O evento sai num useEffect depois da pintura: com a maquina carregada (CI) ele chega depois do texto.
    await waitFor(() => expect(track).toHaveBeenCalledWith('track_record_viewed', { plans: 10 }));
  });

  it('sem plano nenhum, ou com erro, o card nao aparece', async () => {
    const { container, fetchMock } = renderRecord({ days: 30, plans: 0, win: 0, loss: 0, noFill: 0, timeout: 0, pending: 0 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="track-record"]')).toBeNull();
    cleanup();
    const failed = renderRecord({}, false);
    await waitFor(() => expect(failed.fetchMock).toHaveBeenCalled());
    expect(failed.container.querySelector('[data-testid="track-record"]')).toBeNull();
  });
});
