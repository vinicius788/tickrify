import { useAuth, useUser } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const API = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');

export interface TickPackage {
  id: string;
  name: string;
  ticks: number;
  priceInCents: number;
  highlight?: boolean;
  discountLabel?: string;
}

export interface TickTransaction {
  id: string;
  amount: number;
  type: 'PURCHASE' | 'USAGE' | 'REFUND' | 'BONUS';
  description: string;
  stripePaymentIntentId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface TickBalanceResponse {
  balance: number;
  currency: 'ticks';
}

function normalizeApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API}${normalizedPath}`;
}

export function useTicks() {
  const { getToken } = useAuth();
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const enabled = isLoaded && Boolean(user);

  const balanceQuery = useQuery<TickBalanceResponse>({
    queryKey: ['ticks-balance'],
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(normalizeApiUrl('/api/ticks/balance'), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!res.ok) {
        return { balance: 0, currency: 'ticks' };
      }

      return res.json() as Promise<TickBalanceResponse>;
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled,
  });

  const packagesQuery = useQuery<TickPackage[]>({
    queryKey: ['ticks-packages'],
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(normalizeApiUrl('/api/ticks/packages'), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!res.ok) {
        return [];
      }

      return res.json() as Promise<TickPackage[]>;
    },
    staleTime: 5 * 60_000,
    enabled,
  });

  const historyQuery = useQuery<TickTransaction[]>({
    queryKey: ['ticks-history'],
    queryFn: async () => {
      const token = await getToken({ skipCache: true });
      const res = await fetch(normalizeApiUrl('/api/ticks/history'), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (!res.ok) {
        return [];
      }

      return res.json() as Promise<TickTransaction[]>;
    },
    staleTime: 30_000,
    enabled,
  });

  const buyTicks = async (packageId: string) => {
    const token = await getToken({ skipCache: true });
    const res = await fetch(normalizeApiUrl('/api/ticks/checkout'), {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ packageId }),
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(String(errorBody?.message || 'Falha ao iniciar compra de Ticks'));
    }

    const data = (await res.json()) as { url?: string };

    if (!data?.url) {
      throw new Error('Stripe checkout URL não disponível');
    }

    window.location.href = data.url;
  };

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticks-balance'] });
    void queryClient.invalidateQueries({ queryKey: ['ticks-history'] });
  };

  return {
    balance: balanceQuery.data?.balance ?? 0,
    packages: packagesQuery.data ?? [],
    history: historyQuery.data ?? [],
    loadingBalance: balanceQuery.isLoading,
    buyTicks,
    refetch,
  };
}
