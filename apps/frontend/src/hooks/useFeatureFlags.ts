import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

export type FlagType = 'boolean' | 'number' | 'string';
export type FlagSource = 'banco' | 'ambiente' | 'padrao';

export interface FlagDefinition {
  key: string;
  type: FlagType;
  label: string;
  description: string;
  defaultValue: string;
  risk: 'alto' | 'medio' | 'baixo';
  soldOnSite?: boolean;
}

export interface ResolvedFlag {
  key: string;
  value: string;
  source: FlagSource;
  definition: FlagDefinition;
}

export interface FlagsResponse {
  flags: ResolvedFlag[];
  cache: {
    carregado: boolean;
    carregadoEm: string | null;
    overridesNoBanco: number;
    ultimoErro: string | null;
  };
}

/**
 * Loja de apps interna.
 *
 * O gate real de admin é do SERVIDOR (AuthGuard + AdminGuard). O que este hook
 * faz com o erro 403 é só decidir o que desenhar — nunca conceder acesso.
 */
export function useFeatureFlags() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const authHeaders = async (): Promise<HeadersInit> => {
    const token = await getToken({ skipCache: true });
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const query = useQuery<FlagsResponse, Error>({
    queryKey: ['admin-flags'],
    enabled: Boolean(isSignedIn),
    // Sem cache longo: este painel existe para mostrar o estado REAL agora.
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/flags'), { headers: await authHeaders() });
      if (res.status === 403) throw new Error('SEM_ACESSO');
      if (!res.ok) throw new Error(`Falha ao carregar (${res.status})`);
      return res.json();
    },
  });

  const setFlag = useMutation<ResolvedFlag, Error, { key: string; value: string }>({
    mutationFn: async ({ key, value }) => {
      const res = await fetch(buildApiUrl(`/api/admin/flags/${encodeURIComponent(key)}`), {
        method: 'PATCH',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Falha ao salvar (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-flags'] }),
  });

  const clearFlag = useMutation<ResolvedFlag, Error, string>({
    mutationFn: async (key) => {
      const res = await fetch(buildApiUrl(`/api/admin/flags/${encodeURIComponent(key)}`), {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`Falha ao limpar (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-flags'] }),
  });

  return {
    flags: query.data?.flags ?? [],
    cache: query.data?.cache,
    isLoading: query.isLoading,
    error: query.error,
    semAcesso: query.error?.message === 'SEM_ACESSO',
    refetch: query.refetch,
    setFlag,
    clearFlag,
  };
}
