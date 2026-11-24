import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { errorText } from '@/lib/i18n/messages';
import type { Language, Translations } from '@/lib/i18n';
import { buildApiUrl, fetchWithAuthRetry } from '@/lib/api';

/**
 * Programa de afiliados: pagina publica, painel do afiliado e admin.
 * Todo valor em dinheiro chega do servidor em CENTAVOS de USD; a tela so
 * formata. Nada aqui calcula comissao ou saldo.
 */

/** Regras publicas. Sem taxa de comissao: ela so aparece no painel do proprio afiliado. */
export interface AffiliateProgram {
  commissionMonths: number;
  attributionDays: number;
  holdDays: number;
  minPayoutUsd: number;
  /** null = sem desconto configurado na Stripe (a pagina nao promete). */
  customerDiscountPercent: number | null;
}

export type CommissionStatus = 'PENDING' | 'AVAILABLE' | 'PAID' | 'CANCELLED';
export type PayoutStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID';
export type AffiliateStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

/** Pedido de entrada (mesmas listas do JoinAffiliateDto). So o codigo e obrigatorio; o resto vai se preenchido. */
export interface AffiliateApplication {
  couponCode: string;
  platform?: 'youtube' | 'instagram' | 'tiktok' | 'x' | 'telegram' | 'discord' | 'website' | 'other';
  url?: string;
  audience?: 'under_1k' | '1k_10k' | '10k_50k' | '50k_plus';
  note?: string;
}

export interface AffiliateDashboard {
  /** PENDING/REJECTED chegam so com status e data (sem codigos nem taxa). */
  affiliate: null | {
    status: AffiliateStatus;
    joinedAt: string;
    referralCode?: string;
    couponCode?: string;
    commissionPercent?: number;
  };
  program: AffiliateProgram;
  stats?: { clicks: number; signups: number; paidCustomers: number; revenueCents: number };
  balances?: {
    pendingCents: number;
    availableCents: number;
    inPayoutCents: number;
    paidCents: number;
    totalEarnedCents: number;
  };
  canRequestPayout?: boolean;
  commissions?: Array<{
    id: string;
    customer: string;
    amountPaidCents: number;
    commissionCents: number;
    status: CommissionStatus;
    availableAt: string;
    createdAt: string;
  }>;
  payouts?: Array<{ id: string; amountCents: number; status: PayoutStatus; requestedAt: string; paidAt: string | null }>;
}

export interface AdminAffiliate {
  id: string;
  email: string | null;
  referralCode: string;
  couponCode: string;
  commissionRateBps: number;
  status: AffiliateStatus;
  stripePromotionCodeId: string | null;
  /** Pedido de entrada. null = entrou antes do formulario existir. */
  application: AffiliateApplication | null;
  createdAt: string;
  clicks: number;
  signups: number;
  /** Faturas pagas que geraram comissao (refund/disputa fora). */
  paidSales: number;
  paidCustomers: number;
  pendingCents: number;
  availableCents: number;
  paidCents: number;
  revenueCents: number;
}

export interface AdminAffiliateDetail {
  affiliate: AdminAffiliate;
  referrals: Array<{
    id: string;
    email: string | null;
    source: 'link' | 'coupon';
    createdAt: string;
    firstPaidAt: string | null;
    commissionEndsAt: string | null;
  }>;
  commissions: Array<{
    id: string;
    stripeInvoiceId: string;
    amountPaidCents: number;
    commissionCents: number;
    rateBps: number;
    status: CommissionStatus;
    availableAt: string;
    cancelledReason: string | null;
    createdAt: string;
  }>;
}

export interface AdminPayout {
  id: string;
  amountCents: number;
  status: PayoutStatus;
  method: string;
  adminNote: string | null;
  requestedAt: string;
  paidAt: string | null;
  affiliate: { id: string; referralCode: string; user: { email: string | null } };
}

/** Mesma regra do servidor: A-Z e numeros, 4 a 20, em maiusculas. */
export const AFFILIATE_CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

/** O que a pessoa digita vira codigo: maiusculas, sem acento, so A-Z e numeros, ate 20. */
export function cleanAffiliateCode(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

/** Sugestao do formulario: primeiro nome + percentual do cupom (ex.: EIGLA10). */
export function suggestAffiliateCode(firstName: string | null | undefined, percent: number | null | undefined): string {
  const suffix = percent ? String(percent) : '';
  const name = cleanAffiliateCode(String(firstName ?? '').split(/\s+/)[0] ?? '').replace(/[0-9]/g, '');
  return name ? `${name.slice(0, 20 - suffix.length)}${suffix}` : '';
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

async function errorMessage(res: Response, fallback: string, t: Translations, language: Language): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[]; code?: string; params?: Record<string, string | number> } | null;
  const message = Array.isArray(body?.message) ? body?.message.join(', ') : body?.message;
  return errorText(t, language, { ...body, message }, `${fallback} (${res.status})`);
}

function useAuthedFetch() {
  const { t, language } = useLanguage();
  const { getToken } = useAuth();
  return async (path: string, init: RequestInit = {}, fallback = 'Request failed') => {
    const token = await getToken();
    const res = await fetchWithAuthRetry(
      buildApiUrl(path),
      {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      () => getToken({ skipCache: true }),
    );
    if (res.status === 403) {
      const body = await res.clone().json().catch(() => null);
      if (!body?.code) throw new Error('SEM_ACESSO');
    }
    if (!res.ok) throw new Error(await errorMessage(res, fallback, t, language));
    return res.json();
  };
}

/** Regras publicas (so a taxa padrao). */
export function useAffiliateProgram() {
  return useQuery<AffiliateProgram>({
    queryKey: ['affiliate-program'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/affiliates/program'));
      if (!res.ok) throw new Error(`program: ${res.status}`);
      return res.json();
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useAffiliateDashboard() {
  const { isSignedIn } = useAuth();
  const authed = useAuthedFetch();
  const queryClient = useQueryClient();

  const query = useQuery<AffiliateDashboard, Error>({
    queryKey: ['affiliate-me'],
    enabled: Boolean(isSignedIn),
    queryFn: () => authed('/api/affiliates/me', {}, 'Could not load your affiliate dashboard'),
  });

  const join = useMutation<AffiliateDashboard, Error, AffiliateApplication>({
    mutationFn: (application) =>
      authed('/api/affiliates/join', { method: 'POST', body: JSON.stringify(application) }, 'Could not send your application'),
    onSuccess: (data) => queryClient.setQueryData(['affiliate-me'], data),
  });

  const checkCode = (code: string) =>
    authed('/api/affiliates/code-check', { method: 'POST', body: JSON.stringify({ code }) }, 'Could not check the code') as Promise<{
      available: boolean;
      reason?: 'invalid' | 'taken';
    }>;

  const requestPayout = useMutation<unknown, Error, string>({
    mutationFn: (method) =>
      authed('/api/affiliates/payouts', { method: 'POST', body: JSON.stringify({ method }) }, 'Could not request payout'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['affiliate-me'] }),
  });

  return { query, join, requestPayout, checkCode };
}

export function useAffiliateAdmin() {
  const { isSignedIn } = useAuth();
  const authed = useAuthedFetch();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-affiliates'] });

  const affiliates = useQuery<AdminAffiliate[], Error>({
    queryKey: ['admin-affiliates', 'list'],
    enabled: Boolean(isSignedIn),
    retry: false,
    queryFn: () => authed('/api/admin/affiliates', {}, 'Falha ao carregar afiliados'),
  });

  const payouts = useQuery<AdminPayout[], Error>({
    queryKey: ['admin-affiliates', 'payouts'],
    enabled: Boolean(isSignedIn),
    retry: false,
    queryFn: () => authed('/api/admin/affiliates/payouts', {}, 'Falha ao carregar saques'),
  });

  const update = useMutation<
    { stripeSync: 'ok' | 'skipped' | 'failed' },
    Error,
    { id: string; patch: Partial<Pick<AdminAffiliate, 'status' | 'commissionRateBps' | 'referralCode' | 'couponCode'>> }
  >({
    mutationFn: ({ id, patch }) =>
      authed(`/api/admin/affiliates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, 'Não salvou'),
    onSuccess: refresh,
  });

  const decide = useMutation<unknown, Error, { id: string; action: 'approve' | 'reject' | 'mark_paid'; note?: string }>({
    mutationFn: ({ id, action, note }) =>
      authed(
        `/api/admin/affiliates/payouts/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify({ action, ...(note ? { note } : {}) }) },
        'Não salvou',
      ),
    onSuccess: refresh,
  });

  // "Marcar como pago": o dono pagou por fora (Pix) todo o disponivel.
  const settle = useMutation<{ amountCents: number }, Error, { id: string; note?: string }>({
    mutationFn: ({ id, note }) =>
      authed(
        `/api/admin/affiliates/${encodeURIComponent(id)}/settle`,
        { method: 'POST', body: JSON.stringify(note ? { note } : {}) },
        'Não salvou',
      ),
    onSuccess: refresh,
  });

  return { affiliates, payouts, update, decide, settle };
}

export function useAffiliateAdminDetail(id: string | null) {
  const authed = useAuthedFetch();
  return useQuery<AdminAffiliateDetail, Error>({
    queryKey: ['admin-affiliates', 'detail', id],
    enabled: Boolean(id),
    retry: false,
    queryFn: () => authed(`/api/admin/affiliates/${encodeURIComponent(id!)}`, {}, 'Falha ao carregar afiliado'),
  });
}
