import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

interface TickBalanceResponse {
  balance: number;
  currency: 'ticks';
}

/** Saldo de ticks do usuario logado (a compra avulsa de pacotes saiu em 21/09/2026). */
export function useTicks() {
  const { getToken } = useAuth();
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const enabled = isLoaded && Boolean(user);

  const balanceQuery = useQuery<TickBalanceResponse>({
    queryKey: ['ticks-balance'],
    queryFn: async () => {
      // Token do cache primeiro (instantaneo); token novo so se o backend
      // recusar. Pedir token novo sempre custava uma ida ao Clerk na abertura.
      const load = (token: string | null) =>
        fetch(buildApiUrl('/api/ticks/balance'), {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      let res = await load(await getToken());
      if (res.status === 401) {
        res = await load(await getToken({ skipCache: true }));
      }

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

  // Atualiza o saldo imediatamente quando uma análise é criada (o débito de
  // ticks acontece na criação) — sem isso o header só atualizava no polling de 30s.
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['ticks-balance'] });
    };
    window.addEventListener('tickrify:analysis-created', refresh);
    return () => window.removeEventListener('tickrify:analysis-created', refresh);
  }, [queryClient]);

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticks-balance'] });
  };

  return {
    balance: balanceQuery.data?.balance ?? 0,
    refetch,
  };
}
