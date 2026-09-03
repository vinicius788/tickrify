import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { apiClient } from '@/lib/api';

export type UserPlan = 'free' | 'starter' | 'pro' | 'elite';

interface AnalysisLimitData {
  total: number;
  used: number;
  remaining: number;
  canAnalyze: boolean;
  isUnlimited: boolean;
  plan: UserPlan;
  /** Contagem REAL de análises concluídas, de todos os tempos, vinda de um
   *  count() no banco. `null` enquanto o backend não respondeu, e nesse caso o
   *  painel cai no contador local da lista carregada. NÃO confundir com `used`,
   *  que é o consumo do período. */
  analysesAllTime: number | null;
  /** true enquanto o backend ainda não confirmou o plano/limite do usuário logado.
   *  Durante esse tempo NÃO se deve tratar o usuário como "free 3 grátis". */
  isLoading: boolean;
}

const FREE_LIMIT = 3;
const ANALYSIS_REFRESH_EVENT = 'tickrify:analysis-created';

export function useAnalysisLimit(): AnalysisLimitData {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [analysisCount, setAnalysisCount] = useState(0);
  const [analysisLimit, setAnalysisLimit] = useState(FREE_LIMIT);
  const [userPlan, setUserPlan] = useState<UserPlan>('free');
  const [backendUnlimited, setBackendUnlimited] = useState(false);
  // null enquanto nao chegou do backend. O painel cai no contador local nesse caso.
  const [analysesAllTime, setAnalysesAllTime] = useState<number | null>(null);
  // Começa carregando: o backend (Render hiberna) pode levar segundos a confirmar
  // que a conta é paga. Sem isto, a tela mostrava "3 grátis" no meio-tempo e o
  // assinante conseguia gastar análise grátis antes do plano ser reconhecido.
  const [statusResolved, setStatusResolved] = useState(false);

  // Verificar se está no modo demo (rota /demo sem usuário)
  const isDemo = !user;
  const isUnlimited = userPlan !== 'free' || backendUnlimited;
  // Logado mas ainda sem resposta do backend = carregando.
  const isLoading = Boolean(user) && !statusResolved;

  const refreshLimits = useCallback(async () => {
    if (!isLoaded || !user) {
      return;
    }

    try {
      const token = await getToken({ skipCache: true });

      if (!token) {
        setUserPlan('free');
        setAnalysisCount(0);
        setAnalysisLimit(FREE_LIMIT);
        setBackendUnlimited(false);
        return;
      }

      const usage = await apiClient.getAnalysisUsage(token);

      const validPlans: UserPlan[] = ['free', 'starter', 'pro', 'elite'];
      setUserPlan(validPlans.includes(usage.plan as UserPlan) ? (usage.plan as UserPlan) : 'free');
      setBackendUnlimited(Boolean(usage.isUnlimited));
      setAnalysisCount(usage.used);
      setAnalysesAllTime(
        typeof usage.analysesAllTime === 'number' && Number.isFinite(usage.analysesAllTime)
          ? usage.analysesAllTime
          : null,
      );
      setAnalysisLimit(
        typeof usage.total === 'number' && Number.isFinite(usage.total) && usage.total > 0
          ? usage.total
          : FREE_LIMIT,
      );
      // Só marca resolvido em caso de sucesso — assim canAnalyze fica travado até
      // termos a verdade do backend, evitando gastar grátis por engano.
      setStatusResolved(true);
    } catch {
      setUserPlan('free');
      setAnalysisCount(0);
      setAnalysisLimit(FREE_LIMIT);
      setBackendUnlimited(false);
      // Falha de rede: libera a UI para não travar pra sempre, mas o backend ainda
      // é a fonte da verdade na hora de criar a análise (bloqueia grátis indevido).
      setStatusResolved(true);
    }
  }, [getToken, isLoaded, user]);

  useEffect(() => {
    void refreshLimits();

    const handleRefresh = () => {
      void refreshLimits();
    };

    window.addEventListener(ANALYSIS_REFRESH_EVENT, handleRefresh);

    return () => {
      window.removeEventListener(ANALYSIS_REFRESH_EVENT, handleRefresh);
    };
  }, [refreshLimits]);

  useEffect(() => {
    if (!user) {
      setAnalysisCount(0);
      setAnalysisLimit(FREE_LIMIT);
      setUserPlan('free');
      setBackendUnlimited(false);
      setStatusResolved(false);
    }
  }, [user]);

  // Se é demo, retorna valores que não importam (demo não usa limite)
  if (isDemo) {
    return {
      total: Infinity,
      used: 0,
      remaining: Infinity,
      canAnalyze: true,
      isUnlimited: true,
      plan: 'elite' as UserPlan,
      // Demo nao tem conta, entao nao ha historico para contar.
      analysesAllTime: null,
      isLoading: false,
    };
  }

  // Enquanto o backend não confirmou o plano: NÃO afirmar que é free/3 grátis e
  // NÃO liberar análise. A UI mostra "carregando seu plano" (ver DashboardPage).
  if (isLoading) {
    return {
      total: 0,
      used: 0,
      remaining: 0,
      canAnalyze: false,
      isUnlimited: false,
      plan: userPlan,
      // Ainda nao chegou do backend; o painel usa o contador local ate chegar.
      analysesAllTime: null,
      isLoading: true,
    };
  }

  // Usuário logado, plano confirmado
  const total = isUnlimited ? Infinity : analysisLimit;
  const used = analysisCount;
  const remaining = isUnlimited ? Infinity : Math.max(0, analysisLimit - used);
  const canAnalyze = isUnlimited || remaining > 0;

  return {
    total,
    used,
    remaining,
    canAnalyze,
    isUnlimited,
    plan: userPlan,
    analysesAllTime,
    isLoading: false,
  };
}

// Hook auxiliar para incrementar análises
export function useIncrementAnalysis() {
  return () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ANALYSIS_REFRESH_EVENT));
    }
  };
}
