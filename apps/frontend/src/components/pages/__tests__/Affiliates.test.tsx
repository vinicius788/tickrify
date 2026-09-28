import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import AffiliatesPage from '@/components/pages/AffiliatesPage';
import AffiliateDashboardPage from '@/components/pages/AffiliateDashboardPage';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: async () => 'tok' }),
}));
// A casca do site (header, rodape, idioma) nao e o que se testa aqui.
vi.mock('@/components/layout/SiteLayout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

const PROGRAM = { commissionMonths: 12, attributionDays: 30, holdDays: 30, minPayoutUsd: 50, customerDiscountPercent: 10 };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function renderWith(ui: ReactNode, routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      return json(key ? routes[key] : {});
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('programa de afiliados na tela', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('pagina publica nao mostra nenhuma porcentagem de comissao', async () => {
    renderWith(<AffiliatesPage />, { '/api/affiliates/program': PROGRAM });
    await screen.findByText(/for 12 months from their first payment/i);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Earn recurring commissions by referring traders to Tickrify.');
    expect(text).toContain('Approved partners receive recurring commissions for eligible customers they refer');
    // So o desconto do CLIENTE (10%) pode aparecer; nenhuma taxa de comissao.
    expect(text.match(/\d+%/g)).toEqual(['10%']);
    expect(text).not.toMatch(/20%|25%|30%|tier/i);
  });

  it('painel do afiliado ativo mostra so a propria taxa', async () => {
    renderWith(<AffiliateDashboardPage />, {
      '/api/affiliates/me': {
        affiliate: { status: 'ACTIVE', joinedAt: '2026-09-01', referralCode: 'PARTNER1', couponCode: 'SAVE10', commissionPercent: 25 },
        program: PROGRAM,
        stats: { clicks: 3, signups: 2, paidCustomers: 1, revenueCents: 1885 },
        balances: { pendingCents: 471, availableCents: 0, inPayoutCents: 0, paidCents: 0, totalEarnedCents: 471 },
        canRequestPayout: false,
        commissions: [],
        payouts: [],
      },
    });
    await screen.findByText(/Your commission: 25%/);
    expect(document.body.textContent?.match(/\d+%/g)).toEqual(['25%']);
  });

  it('afiliado PENDING ve so o aviso de analise, sem link nem cupom', async () => {
    renderWith(<AffiliateDashboardPage />, {
      '/api/affiliates/me': { affiliate: { status: 'PENDING', joinedAt: '2026-09-01' }, program: PROGRAM },
    });
    await screen.findByText('Your application is under review');
    await waitFor(() => expect(screen.queryByText('Referral link')).toBeNull());
    expect(screen.queryByText(/Request/)).toBeNull();
  });
});
