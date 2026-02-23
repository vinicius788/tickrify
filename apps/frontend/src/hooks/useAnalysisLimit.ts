import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { apiClient } from '@/lib/api';
import { getUserSubscription } from '@/lib/stripe';

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

function isActivePaidSubscription(status?: string): boolean {
  return ['active', 'trialing'].includes(String(status || '').toLowerCase());
}

export function useAnalysisLimit(): AnalysisLimitData {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [analysisCount, setAnalysisCount] = useState(0);
  const [userPlan, setUserPlan] = useState<'free' | 'pro'>('free');

  // Verificar se está no modo demo (rota /demo sem usuário)
  const isDemo = !user;
  const isUnlimited = userPlan === 'pro';

  const refreshLimits = useCallback(async () => {
    if (!isLoaded || !user) {
      return;
    }

    try {
      const token = await getToken();

      if (!token) {
        setUserPlan('free');
        setAnalysisCount(0);
        return;
      }

      const [subscription, analyses] = await Promise.all([
        getUserSubscription(token).catch(() => null),
        apiClient.listAnalyses(token, 100).catch(() => []),
      ]);

      const hasProPlan =
        String(subscription?.plan || '').toLowerCase() === 'pro' ||
        isActivePaidSubscription(subscription?.status);

      setUserPlan(hasProPlan ? 'pro' : 'free');

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthlyUsed = analyses.filter((analysis) => {
        const createdAt = new Date(analysis.createdAt);
        return createdAt >= monthStart;
      }).length;

      setAnalysisCount(monthlyUsed);
    } catch {
      setUserPlan('free');
      setAnalysisCount(0);
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
      setUserPlan('free');
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
  const total = isUnlimited ? Infinity : FREE_LIMIT;
  const used = analysisCount;
  const remaining = isUnlimited ? Infinity : Math.max(0, FREE_LIMIT - used);
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
