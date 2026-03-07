import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { apiClient } from '@/lib/api';

interface AnalysisLimitData {
  total: number;
  used: number;
  remaining: number;
  canAnalyze: boolean;
  isUnlimited: boolean;
  plan: 'free' | 'pro';
}

const FREE_LIMIT = 3;
const ANALYSIS_REFRESH_EVENT = 'tickrify:analysis-created';

export function useAnalysisLimit(): AnalysisLimitData {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [analysisCount, setAnalysisCount] = useState(0);
  const [analysisLimit, setAnalysisLimit] = useState(FREE_LIMIT);
  const [userPlan, setUserPlan] = useState<'free' | 'pro'>('free');
  const [backendUnlimited, setBackendUnlimited] = useState(false);

  // Verificar se está no modo demo (rota /demo sem usuário)
  const isDemo = !user;
  const isUnlimited = userPlan === 'pro' || backendUnlimited;

  const refreshLimits = useCallback(async () => {
    if (!isLoaded || !user) {
      return;
    }

    try {
      const token = await getToken();

      if (!token) {
        setUserPlan('free');
        setAnalysisCount(0);
        setAnalysisLimit(FREE_LIMIT);
        setBackendUnlimited(false);
        return;
      }

      const usage = await apiClient.getAnalysisUsage(token);

      setUserPlan(usage.plan === 'pro' ? 'pro' : 'free');
      setBackendUnlimited(Boolean(usage.isUnlimited));
      setAnalysisCount(usage.used);
      setAnalysisLimit(
        typeof usage.total === 'number' && Number.isFinite(usage.total) && usage.total > 0
          ? usage.total
          : FREE_LIMIT,
      );
    } catch {
      setUserPlan('free');
      setAnalysisCount(0);
      setAnalysisLimit(FREE_LIMIT);
      setBackendUnlimited(false);
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
      plan: 'pro',
    };
  }

  // Usuário logado
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
