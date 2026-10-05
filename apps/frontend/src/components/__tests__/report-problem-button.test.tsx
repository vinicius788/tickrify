import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportProblemButton } from '@/components/ReportProblemButton';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok') }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));

function renderBolha() {
  window.localStorage.setItem('tickrify-language', 'en');
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/dashboard/trades']}>
        <ReportProblemButton />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('bolha "Feedback or problem"', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    toast.mockReset();
    track.mockReset();
  });

  it('abre em "Report a problem" e o relato segue igual: contexto tecnico, sem kind', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'abcdef1234' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderBolha();

    await user.click(screen.getByRole('button', { name: 'Feedback or problem' }));
    expect(screen.getByRole('tab', { name: 'Report a problem' }).getAttribute('aria-selected')).toBe('true');
    await user.type(screen.getByRole('textbox'), 'The chart upload froze');
    await user.click(screen.getByRole('button', { name: 'send' }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.kind).toBeUndefined();
    expect(body.context).toBeDefined();
    expect(body.route).toBe('/dashboard/trades');
  });

  it('aba de opiniao manda kind feedback, sem contexto tecnico, e agradece', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'abcdef1234' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderBolha();

    await user.click(screen.getByRole('button', { name: 'Feedback or problem' }));
    await user.click(screen.getByRole('tab', { name: 'Share your opinion' }));
    expect(screen.getByText('What do you think of Tickrify so far?')).toBeTruthy();
    await user.type(screen.getByRole('textbox'), 'I love the WAIT reads');
    await user.click(screen.getByRole('button', { name: 'send' }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ message: 'I love the WAIT reads', route: '/dashboard/trades', kind: 'feedback' });
    expect(track).toHaveBeenCalledWith('feedback_sent', { length: 21, surface: 'bubble' });
    expect(toast).toHaveBeenCalledWith({ title: 'Thank you. It goes straight to the team.' });
  });
});
