import { useUser } from '@clerk/clerk-react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAPIClient, type AIAnalysisResponse } from '@/lib/api';

/**
 * Hook compartilhado para buscar análises do usuário com cache via React Query.
 * Evita múltiplas requisições independentes quando vários componentes precisam dos mesmos dados.
 *
 * PAGINAÇÃO (03/09/2026): antes este hook buscava UMA página e pronto. O
 * backend limita a 100 por requisição e não tinha cursor, então o histórico de
 * quem tem centenas de análises era inalcançável: uma conta com 403 análises só
 * conseguia abrir 40.
 *
 * Agora usa `useInfiniteQuery`, mas continua devolvendo `analyses` como um array
 * ACHATADO. Isso é deliberado: quem só quer a primeira página (o Dashboard) não
 * mudou uma linha, e quem quer o histórico inteiro (My Trades) chama `loadMore`.
 *
 * @param limit - Tamanho da página (padrão: 40)
 */
export function useAnalyses(limit = 40) {
  const { user, isLoaded } = useUser();
  const apiClient = useAPIClient();
  const queryClient = useQueryClient();

  const enabled = isLoaded && Boolean(user);

  const query = useInfiniteQuery<AIAnalysisResponse[]>({
    queryKey: ['analyses', limit],
    queryFn: ({ pageParam }) => apiClient.listAnalyses(limit, (pageParam as string | null) ?? null),
    initialPageParam: null,
    // O cursor é o id do ÚLTIMO item da página recebida. Página menor que o
    // limite significa fim do histórico, e devolver undefined desliga o "carregar
    // mais" em vez de pedir uma página vazia para sempre.
    getNextPageParam: (lastPage) =>
      lastPage.length < limit ? undefined : (lastPage[lastPage.length - 1]?.id ?? undefined),
    // Cache "fresco" por 2 min e sem refetch ao focar a janela → trocar de aba
    // (Dashboard → My Trades) reaproveita os dados, sem nova busca.
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    enabled,
  });

  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['analyses'] });
  };

  return {
    analyses: (query.data?.pages ?? []).flat(),
    loading: query.isLoading,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refetch,
  };
}
