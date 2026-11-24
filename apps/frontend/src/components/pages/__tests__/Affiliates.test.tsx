import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import AffiliatesPage from '@/components/pages/AffiliatesPage';
import AffiliateDashboardPage from '@/components/pages/AffiliateDashboardPage';

const clerkUser = { current: { firstName: 'Eígla' } as { firstName: string | null } };
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: async () => 'tok' }),
  useUser: () => ({ user: clerkUser.current }),
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
    vi.fn(async (url: string, _init?: RequestInit) => {
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      return json(key ? routes[key] : {});
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider><MemoryRouter>{ui}</MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('programa de afiliados na tela', () => {
  afterEach(() => {
    clerkUser.current = { firstName: 'Eígla' };
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
    // Sem oferta de lancamento (EARLY35 saiu em 23/11/2026): o desconto e o do afiliado, sem "at least".
    expect(text).toContain('Your link and your code give them 10% off their first payment.');
    expect(text).not.toMatch(/at least|launch offer|EARLY\d/i);
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

  const joinBody = () => {
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).includes('/api/affiliates/join'));
    return call ? JSON.parse(call[1].body) : null;
  };
  const FREE = { '/api/affiliates/code-check': { available: true } };

  it('codigo sugerido: primeiro nome em maiusculas, sem acento, mais o desconto do cupom (EIGLA10)', async () => {
    renderWith(<AffiliateDashboardPage />, { ...FREE, '/api/affiliates/me': { affiliate: null, program: PROGRAM } });
    const input = (await screen.findByLabelText(/Your coupon code/)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('EIGLA10'));
    await screen.findByText('Available.');
    const send = screen.getByRole('button', { name: 'Send application' });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(joinBody()).toEqual({ couponCode: 'EIGLA10' }));
  });

  it('o campo so aceita A-Z e numeros em maiusculas; curto demais bloqueia o envio', async () => {
    renderWith(<AffiliateDashboardPage />, { ...FREE, '/api/affiliates/me': { affiliate: null, program: PROGRAM } });
    const input = (await screen.findByLabelText(/Your coupon code/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ana-10 é' } });
    expect(input.value).toBe('ANA10E');
    fireEvent.change(input, { target: { value: 'ab1' } });
    await screen.findByText('Use 4 to 20 letters (A to Z) or numbers.');
    expect((screen.getByRole('button', { name: 'Send application' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('codigo em uso: a tela avisa na hora e nao deixa enviar', async () => {
    renderWith(<AffiliateDashboardPage />, {
      '/api/affiliates/code-check': { available: false, reason: 'taken' },
      '/api/affiliates/me': { affiliate: null, program: PROGRAM },
    });
    await screen.findByText('This code is already in use. Try another one.');
    expect((screen.getByRole('button', { name: 'Send application' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('pedido de entrada: link, se vier, precisa ser https; manda o que foi preenchido', async () => {
    renderWith(<AffiliateDashboardPage />, { ...FREE, '/api/affiliates/me': { affiliate: null, program: PROGRAM } });
    const send = await screen.findByRole('button', { name: 'Send application' });
    await screen.findByText('Available.');

    fireEvent.change(screen.getByLabelText(/Where is your audience/), { target: { value: 'telegram' } });
    fireEvent.change(screen.getByLabelText(/Link to your profile/), { target: { value: 't.me/tradersgroup' } });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Link to your profile/), {
      target: { value: 'https://t.me/tradersgroup' },
    });
    fireEvent.change(screen.getByLabelText(/How many followers or members/), { target: { value: '10k_50k' } });
    fireEvent.change(screen.getByLabelText(/Anything you want to tell us/), {
      target: { value: 'Grupo de sinais de ouro, mostraria nas analises da semana.' },
    });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() => {
      expect(joinBody()).toEqual({
        couponCode: 'EIGLA10',
        platform: 'telegram',
        url: 'https://t.me/tradersgroup',
        audience: '10k_50k',
        note: 'Grupo de sinais de ouro, mostraria nas analises da semana.',
      });
    });
  });

  it('afiliado PENDING ve so o aviso de analise, sem link nem cupom', async () => {
    renderWith(<AffiliateDashboardPage />, {
      '/api/affiliates/me': { affiliate: { status: 'PENDING', joinedAt: '2026-09-01' }, program: PROGRAM },
    });
    await screen.findByText("Request received. We'll review it and email you.");
    await waitFor(() => expect(screen.queryByText('Referral link')).toBeNull());
    expect(screen.queryByRole('button', { name: /Request/ })).toBeNull();
  });

  it('afiliado ACTIVE ve o codigo e o link, cada um com botao de copiar', async () => {
    renderWith(<AffiliateDashboardPage />, {
      '/api/affiliates/me': {
        affiliate: { status: 'ACTIVE', joinedAt: '2026-11-23', referralCode: 'EIGLA10', couponCode: 'EIGLA10', commissionPercent: 20 },
        program: PROGRAM,
        stats: { clicks: 0, signups: 0, paidCustomers: 0, revenueCents: 0 },
        balances: { pendingCents: 0, availableCents: 0, inPayoutCents: 0, paidCents: 0, totalEarnedCents: 0 },
        canRequestPayout: false,
        commissions: [],
        payouts: [],
      },
    });
    await screen.findByText(`${window.location.origin}/?ref=EIGLA10`);
    expect(screen.getByText('EIGLA10')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });
});
