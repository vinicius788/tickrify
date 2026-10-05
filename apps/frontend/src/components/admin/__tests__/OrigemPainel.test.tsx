import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrigemPainel } from '@/components/admin/OrigemPainel';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: vi.fn().mockResolvedValue('tok') }),
}));
vi.mock('@/lib/api', () => ({ buildApiUrl: (p: string) => `https://api.test${p}` }));

const relatorio = {
  dias: 30,
  declarada: [
    { canal: 'chatgpt', cadastros: 10, analisaram: 8, assinaram: 2, ativos: 1 },
    { canal: 'google', cadastros: 5, analisaram: 2, assinaram: 0, ativos: 0 },
  ],
  tecnica: [{ canal: 'chatgpt.com', cadastros: 7, analisaram: 6, assinaram: 2, ativos: 1 }],
  respostas: [{ respondidoEm: '2026-10-05T10:00:00Z', canal: 'friend', detalhe: 'meu primo', email: 'a@x.com', assinou: true }],
};

function renderPainel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrigemPainel />
    </QueryClientProvider>,
  );
}

describe('aba Origem do admin', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mostra canal declarado com nome legivel, conversao e as ultimas respostas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => relatorio }));
    renderPainel();

    expect(await screen.findByText('ChatGPT')).toBeTruthy();
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByText('chatgpt.com')).toBeTruthy();
    expect(screen.getByText('Indicação')).toBeTruthy();
    expect(screen.getByText('"meu primo"')).toBeTruthy();
  });

  it('trocar o periodo busca de novo com o novo filtro', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => relatorio });
    vi.stubGlobal('fetch', fetchMock);
    renderPainel();
    await screen.findByText('ChatGPT');

    await user.click(screen.getByRole('button', { name: 'desde o início' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/admin/acquisition?dias=0'))).toBe(true));
  });
});
