import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { buildApiUrl } from '@/lib/api';

export type ReportStatus = 'aberto' | 'investigando' | 'resolvido' | 'descartado';

export interface ProblemReport {
  id: string;
  userId: string | null;
  userEmail: string | null;
  message: string;
  route: string | null;
  analysisId: string | null;
  context: Record<string, unknown> | null;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export function useProblemReports(filtro: ReportStatus | 'todos') {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const authHeaders = async (): Promise<HeadersInit> => {
    const token = await getToken({ skipCache: true });
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const query = useQuery<{ itens: ProblemReport[]; contagem: Record<string, number> }, Error>({
    queryKey: ['admin-reports', filtro],
    enabled: Boolean(isSignedIn),
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/reports?status=${filtro}`), {
        headers: await authHeaders(),
      });
      if (res.status === 403) throw new Error('SEM_ACESSO');
      if (!res.ok) throw new Error(`Falha ao carregar (${res.status})`);
      return res.json();
    },
  });

  const setStatus = useMutation<unknown, Error, { id: string; status: ReportStatus }>({
    mutationFn: async ({ id, status }) => {
      const res = await fetch(buildApiUrl(`/api/admin/reports/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Falha ao atualizar (${res.status})`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
  });

  return {
    relatos: query.data?.itens ?? [],
    contagem: query.data?.contagem ?? {},
    isLoading: query.isLoading,
    error: query.error,
    setStatus,
  };
}
