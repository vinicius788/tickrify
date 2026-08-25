import { useQuery } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

export interface PublicAnalysis {
  id: string;
  recommendation: string;
  confidence: number;
  createdAt: string;
  symbol: string;
  timeframe: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
}

/**
 * Últimas análises públicas (anonimizadas) para a vitrine.
 *
 * REGRA (auditoria 24/07/2026): esta é a ÚNICA fonte de dados de análise da
 * landing. Nada de fallback fabricado — se a API falhar, hibernar ou vier
 * vazia, as seções que consomem este hook simplesmente não renderizam.
 *
 * Cache compartilhado (mesma queryKey) usado por
 * RecentAnalysesSection → uma requisição só por carga de página.
 */
export function useRecentPublicAnalyses() {
  const query = useQuery<PublicAnalysis[]>({
    queryKey: ['public-analyses'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/ai/public-analyses'));
      if (!res.ok) throw new Error(`public-analyses: ${res.status}`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as PublicAnalysis[]) : [];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    analyses: query.data ?? [],
    loading: query.isLoading,
    failed: query.isError,
  };
}
