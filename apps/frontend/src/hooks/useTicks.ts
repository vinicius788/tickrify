import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

import type { Currency } from '@/lib/stripe';

export interface TickPackage {
  id: string;
  name: string;
  ticks: number;
  priceInCents: number;
  pricesInCents?: Record<Currency, number>;
  highlight?: boolean;
  discountLabel?: string;
}


interface TickBalanceResponse {
  balance: number;
  currency: 'ticks';
}

/**
 * `withPackages`: so a tela de compra de pacotes precisa da lista. Antes todo
 * uso do hook (cabecalho, contador, painel) buscava /api/ticks/packages em
 * toda abertura do painel, para uma tela que nem esta no ar.
 */
export function useTicks(options: { withPackages?: boolean } = {}) {
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
    // O saldo so muda numa analise (evento abaixo atualiza na hora) ou na
    // virada do mes. 30s de polling eram 2 requisicoes/min por aba aberta ao
    // Render; 2 min + atualizacao ao voltar para a aba (padrao do React
    // Query) cobrem o resto. Aba escondida nao consulta.
    refetchInterval: 120_000,
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
    enabled: enabled && Boolean(options.withPackages),
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

  const buyTicks = async (packageId: string, currency?: Currency) => {
    const token = await getToken({ skipCache: true });
    const res = await fetch(buildApiUrl('/api/ticks/checkout'), {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ packageId, ...(currency ? { currency } : {}) }),
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(String(errorBody?.message || 'Could not start Ticks purchase'));
    }

    const data = (await res.json()) as { url?: string };

    if (!data?.url) {
      throw new Error('Stripe checkout URL unavailable');
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
