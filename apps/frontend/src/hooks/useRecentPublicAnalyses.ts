import { useQuery } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

export interface PublicAnalysis {
  id: string;
  recommendation: string;
  bias?: 'bullish' | 'bearish' | 'neutral' | null;
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

/** Um plano de trade que o sweeper já pontuou, com os níveis que ele usou. */
export interface ScoredPublicAnalysis {
  id: string;
  recommendation: string;
  createdAt: string;
  outcome: 'WIN' | 'LOSS' | 'NO_FILL' | 'TIMEOUT';
  outcomeAt: string | null;
  symbol: string;
  timeframe: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
}

/**
 * Os últimos planos já pontuados 48h depois (30/09/2026). É o recibo da lista
 * de leituras recentes: mesma regra de nunca inventar, se a API falhar a
 * parte some.
 */
export function useScoredPublicAnalyses() {
  const query = useQuery<ScoredPublicAnalysis[]>({
    queryKey: ['public-analyses-scored'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/ai/public-analyses/scored'));
      if (!res.ok) throw new Error(`public-analyses/scored: ${res.status}`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as ScoredPublicAnalysis[]) : [];
    },
    staleTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    scored: query.data ?? [],
    loading: query.isLoading,
    failed: query.isError,
  };
}
