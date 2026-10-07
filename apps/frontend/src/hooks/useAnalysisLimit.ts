import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { apiClient } from '@/lib/api';
import { setPlanContext } from '@/lib/analytics';

export type UserPlan = 'free' | 'starter' | 'pro' | 'elite' | 'weekly';

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
  /** Cota gratis: analises no total (WAIT incluido) e o teto de 10. `null`
   *  para assinante ou enquanto o backend nao respondeu. `total`/`used`/
   *  `remaining` falam das analises com SINAL (BUY/SELL). */
  totalUsed: number | null;
  totalLimit: number | null;
  /** Gratis esgotado: historico, diario e resultado travados ate assinar. */
  freeLocked: boolean;
  /** true enquanto o backend ainda não confirmou o plano/limite do usuário logado.
   *  Durante esse tempo NÃO se deve tratar o usuário como "free 3 grátis". */
  isLoading: boolean;
}

const FREE_LIMIT = 3;
const ANALYSIS_REFRESH_EVENT = 'tickrify:analysis-created';

// O painel e o contador da barra lateral usam este hook ao mesmo tempo, e cada
// um buscava /api/ai/usage: duas requisicoes identicas a cada abertura e a
// cada analise (medido em producao em 21/09/2026). Pedidos que chegam juntos
// agora dividem a MESMA requisicao. Janela curta: nao e cache, e deduplicacao.
type UsageResponse = Awaited<ReturnType<typeof apiClient.getAnalysisUsage>>;
const SHARE_WINDOW_MS = 1500;
let sharedUsage: { promise: Promise<UsageResponse>; startedAt: number } | null = null;

function fetchUsageShared(token: string): Promise<UsageResponse> {
  if (sharedUsage && Date.now() - sharedUsage.startedAt < SHARE_WINDOW_MS) return sharedUsage.promise;
  const promise = apiClient.getAnalysisUsage(token);
  sharedUsage = { promise, startedAt: Date.now() };
  promise.catch(() => {
    sharedUsage = null;
  });
  return promise;
}

export function useAnalysisLimit(): AnalysisLimitData {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [analysisCount, setAnalysisCount] = useState(0);
  const [analysisLimit, setAnalysisLimit] = useState(FREE_LIMIT);
  const [userPlan, setUserPlan] = useState<UserPlan>('free');
  const [backendUnlimited, setBackendUnlimited] = useState(false);
  // null enquanto nao chegou do backend. O painel cai no contador local nesse caso.
  const [analysesAllTime, setAnalysesAllTime] = useState<number | null>(null);
  const [freeTotal, setFreeTotal] = useState<{ used: number; limit: number } | null>(null);
  const [freeLocked, setFreeLocked] = useState(false);
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
      // Token do cache (instantaneo). Se estiver vencido, o 401 e repetido com
      // token novo dentro do apiClient (fetchWithAuthRetry).
      const token = await getToken();

      if (!token) {
        setUserPlan('free');
        setAnalysisCount(0);
        setAnalysisLimit(FREE_LIMIT);
        setBackendUnlimited(false);
        return;
      }

      const usage = await fetchUsageShared(token);

      const validPlans: UserPlan[] = ['free', 'starter', 'pro', 'elite', 'weekly'];
      setUserPlan(validPlans.includes(usage.plan as UserPlan) ? (usage.plan as UserPlan) : 'free');
      setPlanContext({
        plan: usage.plan,
        billingCycle: usage.billingCycle ?? null,
        isSubscriber: usage.plan !== 'free',
      });
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
      setFreeTotal(
        typeof usage.totalUsed === 'number' && typeof usage.totalLimit === 'number'
          ? { used: usage.totalUsed, limit: usage.totalLimit }
          : null,
      );
      setFreeLocked(usage.freeLocked === true);
      // Só marca resolvido em caso de sucesso — assim canAnalyze fica travado até
      // termos a verdade do backend, evitando gastar grátis por engano.
      setStatusResolved(true);
    } catch {
      setUserPlan('free');
      setAnalysisCount(0);
      setAnalysisLimit(FREE_LIMIT);
      setFreeTotal(null);
      setFreeLocked(false);
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
      setPlanContext(null);
      setAnalysisCount(0);
      setAnalysisLimit(FREE_LIMIT);
      setFreeTotal(null);
      setFreeLocked(false);
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
      totalUsed: null,
      totalLimit: null,
      freeLocked: false,
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
      totalUsed: null,
      totalLimit: null,
      freeLocked: false,
      isLoading: true,
    };
  }

  // Usuário logado, plano confirmado
  const total = isUnlimited ? Infinity : analysisLimit;
  const used = analysisCount;
  // Bater o teto de 10 no total zera o que resta, mesmo com sinal sobrando.
  const totalCapHit = !isUnlimited && freeTotal !== null && freeTotal.used >= freeTotal.limit;
  const remaining = isUnlimited ? Infinity : totalCapHit ? 0 : Math.max(0, analysisLimit - used);
  const canAnalyze = isUnlimited || remaining > 0;

  return {
    total,
    used,
    remaining,
    canAnalyze,
    isUnlimited,
    plan: userPlan,
    analysesAllTime,
    totalUsed: isUnlimited ? null : freeTotal?.used ?? null,
    totalLimit: isUnlimited ? null : freeTotal?.limit ?? null,
    freeLocked: !isUnlimited && freeLocked,
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
