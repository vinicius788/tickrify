import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

export interface TickPackage {
  id: string;
  name: string;
  ticks: number;
  priceInCents: number;
  highlight?: boolean;
  discountLabel?: string;
}


interface TickBalanceResponse {
  balance: number;
  currency: 'ticks';
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
      const res = await fetch(buildApiUrl('/api/ticks/balance'), {
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
      const res = await fetch(buildApiUrl('/api/ticks/packages'), {
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

  // Atualiza o saldo imediatamente quando uma análise é criada (o débito de
  // ticks acontece na criação) — sem isso o header só atualizava no polling de 30s.
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['ticks-balance'] });
    };
    window.addEventListener('tickrify:analysis-created', refresh);
    return () => window.removeEventListener('tickrify:analysis-created', refresh);
  }, [queryClient]);

  const buyTicks = async (packageId: string) => {
    const token = await getToken({ skipCache: true });
    const res = await fetch(buildApiUrl('/api/ticks/checkout'), {
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
  };

  return {
    balance: balanceQuery.data?.balance ?? 0,
    packages: packagesQuery.data ?? [],
    buyTicks,
    refetch,
  };
}
