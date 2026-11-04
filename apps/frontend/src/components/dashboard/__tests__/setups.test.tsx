import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupAlertBar from '@/components/dashboard/SetupAlertBar';
import TodaySection from '@/components/dashboard/TodaySection';
import Paywall from '@/components/dashboard/Paywall';
import { parseAlertLevel, type SetupAlert } from '@/lib/setups';
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

const OPTIONS = {
  available: true,
  symbol: 'XAUUSD',
  symbolClass: 'metal',
  referencePrice: 4150,
  suggestions: [
    { label: 'entry', level: 4140 },
    { label: 'stop', level: 4120 },
    { label: 'tp1', level: 4180 },
  ],
  setupId: null,
  alerts: [],
  limits: { perSetup: 3, maxSetups: 2, setupsUsed: 0 },
  emailEnabled: true,
};

const ALERT: SetupAlert = {
  id: 'alert-aaaaaaaa',
  setupId: 'setup-aaaaaaaa',
  analysisId: 'analysis00001',
  symbol: 'XAUUSD',
  timeframe: '15m',
  level: 4180,
  label: 'tp1',
  side: 'above',
  status: 'triggered',
  createdAt: '2026-10-27T10:00:00.000Z',
  triggeredAt: '2026-10-27T13:42:00.000Z',
  triggerPrice: 4181,
  seenAt: null,
  lastPrice: 4150,
  checkedAt: '2026-10-27T13:50:00.000Z',
};

describe('Alerta de nivel no resultado', () => {
  it('niveis preenchidos, um botao: cria o alerta (seguindo o setup) com o rotulo do nivel', async () => {
    const user = userEvent.setup();
    const fetchMock = serve({
      'GET /api/setups/alerts/options/analysis00001': () => json(200, OPTIONS),
      'GET /api/setups/by-analysis/analysis00001': () => json(200, { setup: null }),
      'POST /api/setups/alerts': () => json(201, { alert: { ...ALERT, status: 'active', label: 'entry', level: 4140 }, setupId: 'setup-aaaaaaaa' }),
    });
    wrap(<SetupAlertBar analysisId="analysis00001" recommendation="BUY" base="/dashboard" />);

    expect(await screen.findByText('Alert me when price reaches')).toBeTruthy();
    expect(screen.getByText(/email you when it gets there\. Setting an alert also follows this setup\./)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Price level' }) as HTMLInputElement).value).toBe('4140');
    await user.click(screen.getByRole('radio', { name: /Target 1/ }));
    expect((screen.getByRole('textbox', { name: 'Price level' }) as HTMLInputElement).value).toBe('4180');
    await user.click(screen.getByRole('button', { name: /Set alert/ }));

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ analysisId: 'analysis00001', label: 'tp1', level: 4180 });
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Alert set at 4,180.' }));
    expect(screen.getAllByRole('button', { name: /Set alert/ })).toHaveLength(1);
  });

  it('nivel digitado vai como custom; com a chave de e-mail desligada o texto nao promete e-mail', async () => {
    const user = userEvent.setup();
    const fetchMock = serve({
      'GET /api/setups/alerts/options/analysis00001': () => json(200, { ...OPTIONS, emailEnabled: false }),
      'GET /api/setups/by-analysis/analysis00001': () => json(200, { setup: null }),
      'POST /api/setups/alerts': () => json(201, { alert: ALERT, setupId: 'setup-aaaaaaaa' }),
    });
    wrap(<SetupAlertBar analysisId="analysis00001" recommendation="WAIT" base="/dashboard" />);
    const input = await screen.findByRole('textbox', { name: 'Price level' });
    expect(screen.getByText(/show it on your dashboard/)).toBeTruthy();
    expect(screen.queryByText(/email/)).toBeNull();
    await user.clear(input);
    await user.type(input, '4,200.5');
    await user.click(screen.getByRole('button', { name: /Set alert/ }));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ analysisId: 'analysis00001', label: 'custom', level: 4200.5 });
  });

  it('WAIT sem nivel: pede para digitar', async () => {
    serve({
      'GET /api/setups/alerts/options/analysis00001': () => json(200, { ...OPTIONS, suggestions: [] }),
      'GET /api/setups/by-analysis/analysis00001': () => json(200, { setup: null }),
    });
    wrap(<SetupAlertBar analysisId="analysis00001" recommendation="WAIT" base="/dashboard" />);
    expect(await screen.findByText('This read has no price level. Type the price you want to watch.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Price level' }) as HTMLInputElement).value).toBe('');
  });

  it('teto do plano (409 alert_limit): avisa e sugere assinar no gratis', async () => {
    const user = userEvent.setup();
    serve({
      'GET /api/setups/alerts/options/analysis00001': () => json(200, OPTIONS),
      'GET /api/setups/by-analysis/analysis00001': () => json(200, { setup: null }),
      'POST /api/setups/alerts': () => json(409, { code: 'alert_limit', message: 'x' }),
    });
    wrap(<SetupAlertBar analysisId="analysis00001" recommendation="BUY" base="/dashboard" />);
    await user.click(await screen.findByRole('button', { name: /Set alert/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'You have alerts on 2 setups',
        description: 'Cancel one, or subscribe to watch up to 10 setups.',
      }),
    );
  });

  it('ativo sem fonte de preco: diz que nao ha alerta e deixa so seguir', async () => {
    const user = userEvent.setup();
    let followed = false;
    serve({
      'GET /api/setups/alerts/options/analysis00002': () => json(200, { ...OPTIONS, available: false, suggestions: [] }),
      'GET /api/setups/by-analysis/analysis00002': () => json(200, { setup: followed ? SETUP : null }),
      'POST /api/setups': () => {
        followed = true;
        return json(201, { setup: SETUP });
      },
    });
    wrap(<SetupAlertBar analysisId="analysis00002" recommendation="BUY" base="/dashboard" />);
    expect(await screen.findByText("Price alerts aren't available for this asset yet.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Set alert/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Follow setup/ }));
    expect(track).toHaveBeenCalledWith('setup_follow_clicked', { surface: 'result', recommendation: 'BUY' });
    expect(await screen.findByText('Following this setup')).toBeTruthy();
  });

  it('gratis esgotado (402): o cartao nao aparece', async () => {
    const fetchMock = serve({
      'GET /api/setups/alerts/options/analysis00001': () => json(402, { code: 'free_quota_exhausted' }),
      'GET /api/setups/by-analysis/analysis00001': () => json(402, { code: 'free_quota_exhausted' }),
    });
    wrap(<SetupAlertBar analysisId="analysis00001" recommendation="WAIT" base="/dashboard" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText('Alert me when price reaches')).toBeNull();
    expect(screen.queryByRole('button', { name: /Follow setup/ })).toBeNull();
  });
});

describe('Today no inicio do painel', () => {
  const list = (items: SetupAlert[], emailEnabled = true) => ({ paused: false, pausedSymbol: null, items, unseen: items.filter((a) => a.status === 'triggered' && !a.seenAt).length, emailEnabled });

  it('disparado nao visto: hora em UTC, aviso de que nao e sinal; Update chart marca visto e abre a atualizacao', async () => {
    const user = userEvent.setup();
    const fetchMock = serve({ 'POST /api/setups/alerts/alert-aaaaaaaa/seen': () => json(200, { alert: ALERT }) });
    wrap(<TodaySection base="/dashboard" alerts={list([ALERT])} openTrades={[]} />);
    expect(screen.getByText('Price reached your level')).toBeTruthy();
    expect(screen.getByText('Reached 4,180 at 13:42 UTC')).toBeTruthy();
    expect(screen.getByText('This is not a signal to enter.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Update chart/ }));
    expect(track).toHaveBeenCalledWith('setup_alert_opened', { source: 'dashboard', alertId: ALERT.id, setupId: ALERT.setupId });
    expect(track).toHaveBeenCalledWith('setup_alert_update_clicked', { alertId: ALERT.id, setupId: ALERT.setupId, surface: 'today' });
    expect(screen.getByTestId('where').textContent).toBe('/dashboard/new?setup=setup-aaaaaaaa');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/setups/alerts/alert-aaaaaaaa/seen', expect.anything()));
  });

  it('vigiados: nivel, distancia do ultimo preco e "Last checked" em UTC; operacao aberta com atalho', () => {
    const active = { ...ALERT, status: 'active' as const, triggeredAt: null, label: 'entry' as const, level: 4140 };
    wrap(
      <TodaySection
        base="/dashboard"
        alerts={list([active])}
        openTrades={[{ analysisId: 'analysis00009', status: 'in_trade', symbol: 'BTCUSD', timeframe: '1H', direction: 'SELL', updatedAt: '2026-10-27T10:00:00Z' }]}
      />,
    );
    expect(screen.getByText('Entry 4,140 · 0.24% away')).toBeTruthy();
    expect(screen.getByText('Last checked 13:50 UTC')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mark result' }).getAttribute('href')).toBe('/dashboard/analysis/analysis00009');
  });

  it('vazio: so a frase (o New Analysis e o do topo), e o e-mail so com a chave ligada', () => {
    const first = wrap(<TodaySection base="/dashboard" alerts={list([])} openTrades={[]} />);
    expect(screen.getByText("Run an analysis and set an alert. We'll email you when price gets there.")).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    first.unmount();
    wrap(<TodaySection base="/dashboard" alerts={list([], false)} openTrades={[]} />);
    expect(screen.getByText('Run an analysis and set an alert. It shows up here when price gets there.')).toBeTruthy();
  });

});

describe('Paywall dos alertas e limite diario do trial', () => {
  it('surface alerts cita o ativo real', () => {
    wrap(<Paywall surface="alerts" symbol="XAUUSD" onWeekly={vi.fn()} onMonthly={vi.fn()} plansHref="/dashboard/plans" />);
    expect(screen.getByText('Your XAUUSD alert is paused')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('upgrade_cta_viewed', { source: 'paywall', surface: 'alerts' });
  });

  it('limite diario: fala do e-mail so com ele ligado; sem alerta, o texto de sempre', () => {
    const view = wrap(<Paywall surface="new_analysis" variant="daily_limit" alertsOn="email" onWeekly={vi.fn()} onMonthly={vi.fn()} plansHref="/p" />);
    expect(screen.getByText("Your alerts stay on. We'll email you when price reaches your levels. See your trial allowance for your next analyses.")).toBeTruthy();
    view.unmount();
    const screenOnly = wrap(<Paywall surface="new_analysis" variant="daily_limit" alertsOn="screen" onWeekly={vi.fn()} onMonthly={vi.fn()} plansHref="/p" />);
    expect(screen.getByText('Your alerts stay on. See your trial allowance for your next analyses.')).toBeTruthy();
    screenOnly.unmount();
    wrap(<Paywall surface="new_analysis" variant="daily_limit" onWeekly={vi.fn()} onMonthly={vi.fn()} plansHref="/p" />);
    expect(screen.getByText('Today’s analyses are used up. See your trial allowance for availability.')).toBeTruthy();
  });
});

describe('parseAlertLevel', () => {
  it('le os formatos comuns e recusa o resto', () => {
    expect(parseAlertLevel('4180')).toBe(4180);
    expect(parseAlertLevel('4,180.5')).toBe(4180.5);
    expect(parseAlertLevel('4.180,5')).toBe(4180.5);
    expect(parseAlertLevel('1,0952')).toBe(1.0952);
    expect(parseAlertLevel('82,000')).toBe(82000);
    expect(parseAlertLevel(' 0.00012 ')).toBe(0.00012);
    expect(parseAlertLevel('')).toBeNull();
    expect(parseAlertLevel('-5')).toBeNull();
    expect(parseAlertLevel('abc')).toBeNull();
    expect(parseAlertLevel('0')).toBeNull();
  });
});

describe('Setups no inicio do painel', () => {
  const listed = {
    ...SETUP,
    // Passou a seguir em 10/10, mas a 1a analise e de 08/10: o cartao mostra 08/10.
    firstAnalysisAt: '2026-10-08T10:00:00.000Z',
    versions: 2,
    latest: { analysisId: 'analysis00002', createdAt: '2026-10-11T10:00:00.000Z', recommendation: 'WAIT', entryCondition: 'Close above 1.0950' },
  };

  it('cartao: ativo, datas, condicao de espera com a data; Update abre a nova analise com o setup', async () => {
    const user = userEvent.setup();
    serve({ 'GET /api/setups': () => json(200, { items: [listed], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" />);

    expect(await screen.findByText("Setups you're following")).toBeTruthy();
    expect(screen.getByText(/First analysis Oct 8 /)).toBeTruthy();
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
    wrap(<SetupsSection base="/dashboard" />);
    await user.click(await screen.findByRole('button', { name: /Archive/ }));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ status: 'archived' });
  });

  it('sem setup fora do Today: perfil salvo vira uma linha com Edit, sem botao repetido', async () => {
    getStrategy.mockResolvedValue({
      paid: true,
      profile: { instruments: ['forex', 'metals'], timeframes: ['1h', '4h'], setups: ['breakout'], sessions: [], direction: 'both', minRiskReward: 1.5 },
    });
    serve({ 'GET /api/setups': () => json(200, { items: [], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" />);
    expect(await screen.findByText('Forex, Metals · 1h, 4h · Breakout')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/dashboard/strategy');
    expect(screen.queryByRole('button', { name: /New analysis/i })).toBeNull();
  });

  it('sem perfil e sem setup: a secao nao aparece (nada de cartao vazio)', async () => {
    getStrategy.mockResolvedValue({ paid: false, profile: { instruments: ['forex'], timeframes: [], setups: [], sessions: [], direction: 'both', minRiskReward: 1 } });
    serve({ 'GET /api/setups': () => json(200, { items: [], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" />);
    await waitFor(() => expect(getStrategy).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: "Setups you're following" })).toBeNull();
    expect(screen.queryByText(/Your strategy/)).toBeNull();
  });

  it('setup com alerta ativo sai daqui (esta no Today)', async () => {
    serve({ 'GET /api/setups': () => json(200, { items: [listed], nextCursor: null }) });
    wrap(<SetupsSection base="/dashboard" hiddenSetupIds={new Set(['setup-aaaaaaaa'])} />);
    await waitFor(() => expect(getStrategy).toHaveBeenCalled());
    expect(screen.queryByText("Setups you're following")).toBeNull();
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

  it('WATCH encerrado nao repete a condicao antiga nem a invalidacao', async () => {
    const watch = { direction: 'long', level: 100, invalidation: 90, validForCandles: 12,
      expiresAt: '2026-01-01T00:00:00Z', outcome: 'invalidated', alertAvailable: true };
    const latest = { ...versions[1], watch };
    serve({
      'GET /api/setups': () => json(200, { items: [{ ...SETUP, latest, versions: 1 }], nextCursor: null }),
      'GET /api/setups/setup-aaaaaaaa': () => json(200, { setup: SETUP, versions: [latest], nextCursor: null }),
    });
    const list = wrap(<SetupsSection base="/dashboard" />);
    expect(await screen.findByText('Buy level 100')).toBeTruthy();
    expect(screen.queryByText(/Close above 1.0950/)).toBeNull();
    list.unmount();
    wrap(<SetupPage setupId="setup-aaaaaaaa" base="/dashboard" onUpdate={vi.fn()} paywall={() => <p>PAYWALL</p>} />);
    expect(await screen.findByText('Buy level 100')).toBeTruthy();
    expect(screen.queryByText(/Close above 1.0950|Invalidation 90/)).toBeNull();
  });

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

  it('alertas: ativo com cancelar, disparado com a hora em UTC, ultimo preco checado; abrir marca o disparado como visto', async () => {
    const user = userEvent.setup();
    const active = { ...ALERT, id: 'alert-bbbbbbbb', status: 'active', label: 'entry', level: 4140, side: 'below', triggeredAt: null };
    const fetchMock = serve({
      'GET /api/setups/setup-aaaaaaaa': () => json(200, { setup: SETUP, versions, nextCursor: null }),
      'GET /api/setups/alerts': () => json(200, { paused: false, pausedSymbol: null, items: [ALERT, active], unseen: 1, emailEnabled: true }),
      'POST /api/setups/alerts/alert-aaaaaaaa/seen': () => json(200, { alert: ALERT }),
      'POST /api/setups/alerts/alert-bbbbbbbb/cancel': () => json(200, { alert: { ...active, status: 'cancelled' } }),
    });
    wrap(<SetupPage setupId="setup-aaaaaaaa" base="/dashboard" onUpdate={vi.fn()} paywall={() => <p>PAYWALL</p>} />);
    expect(await screen.findByText('Reached 4,180 at 13:42 UTC')).toBeTruthy();
    expect(screen.getByText('Last checked 13:50 UTC · 4,150')).toBeTruthy();
    expect(screen.getByText('if price falls to it')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/setups/alerts/alert-aaaaaaaa/seen', expect.anything()));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('setupId=setup-aaaaaaaa'))).toBe(true);
    await user.click(screen.getByRole('button', { name: /Cancel alert/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'Alert cancelled.' }));
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
