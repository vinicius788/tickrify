import { useUser } from '@clerk/clerk-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAPIClient, type AIAnalysisResponse } from '@/lib/api';

/**
 * Hook compartilhado para buscar análises do usuário com cache via React Query.
 * Evita múltiplas requisições independentes quando vários componentes precisam dos mesmos dados.
 *
 * @param limit - Número máximo de análises a retornar (padrão: 40)
 */
export function useAnalyses(limit = 40) {
  const { user, isLoaded } = useUser();
  const apiClient = useAPIClient();
  const queryClient = useQueryClient();

  const enabled = isLoaded && Boolean(user);

  const query = useQuery<AIAnalysisResponse[]>({
    queryKey: ['analyses', limit],
    queryFn: () => apiClient.listAnalyses(limit),
    staleTime: 30_000,
    enabled,
  });

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['analyses'] });
  };

  return {
    analyses: query.data ?? [],
    loading: query.isLoading,
    refetch,
  };
}
