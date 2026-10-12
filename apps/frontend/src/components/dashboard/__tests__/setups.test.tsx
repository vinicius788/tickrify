import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FollowSetupBar from '@/components/dashboard/FollowSetupBar';
import SetupsSection from '@/components/dashboard/SetupsSection';
import SetupPage from '@/components/dashboard/SetupPage';
import NewAnalysis from '@/components/dashboard/NewAnalysis';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') }),
}));
const getStrategy = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  buildApiUrl: (p: string) => `https://api.test${p}`,
  useAPIClient: () => ({ getStrategy }),
}));
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

/** Servidor falso por rota (metodo + caminho). */
function serve(routes: Record<string, (init?: RequestInit) => ReturnType<typeof json>>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('https://api.test', '').split('?')[0]}`;
    const handler = routes[key];
    if (!handler) throw new Error(`rota nao mockada: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function wrap(ui: ReactNode, path = '/dashboard') {
  window.localStorage.setItem('tickrify-language', 'en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={<>{ui}<Where /></>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const SETUP = {
  id: 'setup-aaaaaaaa',
  status: 'tracking',
  symbol: 'EURUSD',
  timeframe: '1H',
  rootAnalysisId: 'analysis00001',
  createdAt: '2026-10-10T10:00:00.000Z',
  lastAnalysisAt: '2026-10-11T10:00:00.000Z',
};

beforeEach(() => {
  window.localStorage.clear();
  getStrategy.mockResolvedValue({ profile: null, paid: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  track.mockReset();
  toast.mockReset();
});

describe('Follow setup no resultado', () => {
  it('WAIT: cartao em destaque, seguir grava pelo servidor e vira "Following"', async () => {
    const user = userEvent.setup();
    let followed = false;
    const fetchMock = serve({
      'GET /api/setups/by-analysis/analysis00001': () => json(200, { setup: followed ? SETUP : null }),
      'POST /api/setups': () => {
        followed = true;
        return json(201, { setup: SETUP });
      },
    });
    wrap(<FollowSetupBar analysisId="analysis00001" recommendation="WAIT" base="/dashboard" />);

    expect(await screen.findByText('Come back when this happens')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Follow setup/ }));

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ analysisId: 'analysis00001' });
    expect(track).toHaveBeenCalledWith('setup_follow_clicked', { surface: 'result', recommendation: 'WAIT' });
    expect(await screen.findByText('Following this setup')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open setup' }).getAttribute('href')).toBe('/dashboard/setups/setup-aaaaaaaa');
  });

  it('BUY: cartao discreto, mesmo botao, sem substituir nada', async () => {
    serve({ 'GET /api/setups/by-analysis/analysis00002': () => json(200, { setup: null }) });
    wrap(<FollowSetupBar analysisId="analysis00002" recommendation="BUY" base="/dashboard" />);
    expect(await screen.findByText('Follow this setup to update it with a new chart later.')).toBeTruthy();
    expect(screen.queryByText('Come back when this happens')).toBeNull();
  });

  it('teto de 20: avisa para arquivar um', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/setups/by-analysis/analysis00001': () => json(200, { setup: null }),
      'POST /api/setups': () => json(409, { code: 'setup_limit', message: 'x' }),
    });
    wrap(<FollowSetupBar analysisId="analysis00001" recommendation="WAIT" base="/dashboard" />);
    await user.click(await screen.findByRole('button', { name: /Follow setup/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'You follow 20 setups', description: 'Archive one on your dashboard to follow this one.' }),
    );
  });

  it('gratis esgotado (402): o cartao nao aparece', async () => {
    const fetchMock = serve({
      'GET /api/setups/by-analysis/analysis00001': () => json(402, { code: 'free_quota_exhausted' }),
    });
    wrap(<FollowSetupBar analysisId="analysis00001" recommendation="WAIT" base="/dashboard" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Follow setup/ })).toBeNull();
  });
});

describe('Setups no inicio do painel', () => {
  const listed = {
    ...SETUP,
    versions: 2,
    latest: { analysisId: 'analysis00002', createdAt: '2026-10-11T10:00:00.000Z', recommendation: 'WAIT', entryCondition: 'Close above 1.0950' },
  };

  it('cartao: ativo, datas, condicao de espera com a data; Update abre a nova analise com o setup', async () => {
    const user = userEvent.setup();
    serve({ 'GET /api/setups': () => json(200, { items: [listed], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" onNewAnalysis={vi.fn()} showEmpty />);

    expect(await screen.findByText("Setups you're following")).toBeTruthy();
    expect(screen.getByText(/First analysis Oct 10/)).toBeTruthy();
    expect(screen.getByText('Waiting for: Close above 1.0950 (from Oct 11)')).toBeTruthy();
    // Nada de preco atual, "monitoring" ou alerta.
    expect(document.body.textContent).not.toMatch(/monitor|live|alert|current price/i);

    await user.click(screen.getByRole('button', { name: /Update/ }));
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/new?setup=setup-aaaaaaaa');
    expect(track).toHaveBeenCalledWith('setup_update_clicked', { setupId: 'setup-aaaaaaaa' });
    expect(JSON.stringify(track.mock.calls)).not.toContain('Close above');
  });

  it('arquivar so muda o status pelo servidor', async () => {
    const user = userEvent.setup();
    const fetchMock = serve({
      'GET /api/setups': () => json(200, { items: [listed], nextCursor: null }),
      'PATCH /api/setups/setup-aaaaaaaa': () => json(200, { setup: { ...SETUP, status: 'archived' } }),
    });
    wrap(<SetupsSection base="/dashboard" onNewAnalysis={vi.fn()} showEmpty />);
    await user.click(await screen.findByRole('button', { name: /Archive/ }));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: 'archived' });
  });

  it('vazio: uma frase de como seguir; perfil salvo vira uma linha com Edit', async () => {
    getStrategy.mockResolvedValue({
      paid: true,
      profile: { instruments: ['forex', 'metals'], timeframes: ['1h', '4h'], setups: ['breakout'], sessions: [], direction: 'both', minRiskReward: 1.5 },
    });
    serve({ 'GET /api/setups': () => json(200, { items: [], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" onNewAnalysis={vi.fn()} showEmpty />);
    expect(await screen.findByText('Follow a setup from any analysis to come back to it here.')).toBeTruthy();
    expect(await screen.findByText('Forex, Metals · 1h, 4h · Breakout')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/dashboard/strategy');
  });

  it('gratis ou sem perfil: sem resumo de estrategia', async () => {
    getStrategy.mockResolvedValue({ paid: false, profile: { instruments: ['forex'], timeframes: [], setups: [], sessions: [], direction: 'both', minRiskReward: 1 } });
    serve({ 'GET /api/setups': () => json(200, { items: [], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" onNewAnalysis={vi.fn()} showEmpty={false} />);
    await waitFor(() => expect(getStrategy).toHaveBeenCalled());
    expect(screen.queryByText(/Your strategy/)).toBeNull();
    expect(screen.queryByText('Follow a setup from any analysis to come back to it here.')).toBeNull();
  });
});

describe('Pagina do setup', () => {
  const versions = [
    {
      analysisId: 'analysis00003', version: 2, createdAt: '2026-10-12T14:05:00.000Z', recommendation: 'BUY',
      entry: 1.0952, stopLoss: 1.0921, takeProfit1: 1.0998, takeProfit2: 1.103, entryCondition: null,
    },
    {
      analysisId: 'analysis00001', version: 1, createdAt: '2026-10-10T10:00:00.000Z', recommendation: 'WAIT',
      entry: null, stopLoss: null, takeProfit1: null, takeProfit2: null, entryCondition: 'Close above 1.0950',
    },
  ];

  it('versoes da mais nova para a mais antiga, rotulo "Analysis from", precos so no BUY/SELL', async () => {
    serve({ 'GET /api/setups/setup-aaaaaaaa': () => json(200, { setup: SETUP, versions, nextCursor: null }) });
    wrap(<SetupPage setupId="setup-aaaaaaaa" base="/dashboard" onUpdate={vi.fn()} paywall={() => <p>PAYWALL</p>} />);

    const links = await screen.findAllByRole('link');
    const versionLinks = links.filter((a) => a.getAttribute('href')?.startsWith('/dashboard/analysis/'));
    expect(versionLinks.map((a) => a.getAttribute('href'))).toEqual(['/dashboard/analysis/analysis00003', '/dashboard/analysis/analysis00001']);
    expect(versionLinks[0].textContent).toMatch(/^Analysis from Oct 12, 2026/);
    expect(versionLinks[0].textContent).toContain('1.0952');
    expect(versionLinks[1].textContent).toContain('Waiting for: Close above 1.0950');
    expect(versionLinks[1].textContent).not.toMatch(/Entry|Stop/);
    expect(document.body.textContent).not.toMatch(/\b(current|live|now)\b/i);
  });

  it('largado: so "Follow again", sem Update', async () => {
    serve({ 'GET /api/setups/setup-aaaaaaaa': () => json(200, { setup: { ...SETUP, status: 'untracked' }, versions, nextCursor: null }) });
    wrap(<SetupPage setupId="setup-aaaaaaaa" base="/dashboard" onUpdate={vi.fn()} paywall={() => <p>PAYWALL</p>} />);
    expect(await screen.findByRole('button', { name: 'Follow again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull();
  });

  it('gratis esgotado sem versao aberta (402): paywall', async () => {
    serve({ 'GET /api/setups/setup-aaaaaaaa': () => json(402, { code: 'free_quota_exhausted' }) });
    wrap(<SetupPage setupId="setup-aaaaaaaa" base="/dashboard" onUpdate={vi.fn()} paywall={() => <p>PAYWALL</p>} />);
    expect(await screen.findByText('PAYWALL')).toBeTruthy();
  });

  it('setup de outra pessoa (404): nao encontrado', async () => {
    serve({ 'GET /api/setups/setup-aaaaaaaa': () => json(404, { code: 'setup_not_found' }) });
    wrap(<SetupPage setupId="setup-aaaaaaaa" base="/dashboard" onUpdate={vi.fn()} paywall={() => <p>PAYWALL</p>} />);
    expect(await screen.findByText('Setup not found.')).toBeTruthy();
  });
});

describe('Atualizar: custo real antes de enviar', () => {
  it('mostra o setup, a condicao e o custo; "analise comum" sai do modo atualizacao', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    wrap(
      <NewAnalysis
        onStartAnalysis={vi.fn()}
        setupUpdate={{
          title: 'Updating setup EURUSD 1H',
          detail: 'Waiting for: Close above 1.0950 (from Oct 11)',
          hint: 'Send a new chart of the same market.',
          costLine: (deep) => `Cost: ${deep ? 3 : 1} of your 180 ticks.`,
          cancelLabel: 'Do a regular analysis instead',
          onCancel,
        }}
      />,
    );
    expect(screen.getByText('Updating setup EURUSD 1H')).toBeTruthy();
    expect(screen.getByText('Cost: 1 of your 180 ticks.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Do a regular analysis instead' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
