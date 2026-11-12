import { useState, useEffect, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/clerk-react';
import { apiClient, type TrialUsage } from '@/lib/api';
import { setPlanContext } from '@/lib/analytics';

export type UserPlan = 'free' | 'starter' | 'pro' | 'elite' | 'weekly';

interface AnalysisLimitData {
  total: number;
  used: number;
  remaining: number;
  canAnalyze: boolean;
  isUnlimited: boolean;
  plan: UserPlan | null;
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
  /** Assinatura encerrada: modo leitura (historico aberto, nova analise travada). */
  formerSubscriber: boolean;
  /** Tem assinatura da Stripe para gerenciar no portal. */
  billingManageable: boolean;
  /** Trial de 3 dias (sem cartao). null = regra antiga ou assinante. */
  trial: TrialUsage | null;
  /** Trial recusado pelo anti-abuso: mensagem do servidor para mostrar. */
  trialBlocked: { code: string; message: string } | null;
  /** Conta sem assinatura que ainda nao enviou a opiniao que vale analises. */
  feedbackRewardAvailable: boolean;
  /** true enquanto o backend ainda não confirmou o plano/limite do usuário logado.
   *  Durante esse tempo NÃO se deve tratar o usuário como "free 3 grátis". */
  isLoading: boolean;
  isUnavailable: boolean;
  retry: () => void;
}

const FREE_LIMIT = 3;
const ANALYSIS_REFRESH_EVENT = 'tickrify:analysis-created';
const USAGE_REFRESH_EVENT = 'tickrify:usage-refresh';
const retryUsage = () => window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
/** Rele o /usage em todo lugar que usa o hook (ex.: depois do credito da opiniao). */
export const refreshUsage = retryUsage;

// O painel e o contador da barra lateral usam este hook ao mesmo tempo, e cada
// um buscava /api/ai/usage: duas requisicoes identicas a cada abertura e a
// cada analise (medido em producao em 21/09/2026). Pedidos que chegam juntos
// agora dividem a MESMA requisicao. Janela curta: nao e cache, e deduplicacao.
type UsageResponse = Awaited<ReturnType<typeof apiClient.getAnalysisUsage>>;
const SHARE_WINDOW_MS = 1500;
let sharedUsage: { token: string; promise: Promise<UsageResponse>; startedAt: number } | null = null;

function fetchUsageShared(token: string): Promise<UsageResponse> {
  if (sharedUsage?.token === token && Date.now() - sharedUsage.startedAt < SHARE_WINDOW_MS) return sharedUsage.promise;
  const promise = apiClient.getAnalysisUsage(token);
  sharedUsage = { token, promise, startedAt: Date.now() };
  promise.catch(() => {
    if (sharedUsage?.promise === promise) sharedUsage = null;
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
  const [formerSubscriber, setFormerSubscriber] = useState(false);
  const [billingManageable, setBillingManageable] = useState(false);
  const [trial, setTrial] = useState<TrialUsage | null>(null);
  const [trialBlocked, setTrialBlocked] = useState<{ code: string; message: string } | null>(null);
  const [feedbackRewardAvailable, setFeedbackRewardAvailable] = useState(false);
  // Começa carregando: o backend (Render hiberna) pode levar segundos a confirmar
  // que a conta é paga. Sem isto, a tela mostrava "3 grátis" no meio-tempo e o
  // assinante conseguia gastar análise grátis antes do plano ser reconhecido.
  const [statusResolved, setStatusResolved] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(false);

  // Verificar se está no modo demo (rota /demo sem usuário)
  const isDemo = !user;
  const isUnlimited = userPlan !== 'free' || backendUnlimited;
  // Logado mas ainda sem resposta do backend = carregando.
  const isLoading = Boolean(user) && !statusResolved;

  const refreshLimits = useCallback(async () => {
    if (!isLoaded || !user) {
      return;
    }

    setIsUnavailable(false);
    try {
      // Token do cache (instantaneo). Se estiver vencido, o 401 e repetido com
      // token novo dentro do apiClient (fetchWithAuthRetry).
      const token = await getToken();

      if (!token) {
        throw new Error('Session token unavailable');
      }

      const usage = await fetchUsageShared(token);

      const validPlans: UserPlan[] = ['free', 'starter', 'pro', 'elite', 'weekly'];
      setUserPlan(validPlans.includes(usage.plan as UserPlan) ? (usage.plan as UserPlan) : 'free');
      setPlanContext({
        plan: usage.plan,
        billingCycle: usage.billingCycle ?? null,
        isSubscriber: usage.plan !== 'free',
        trialDay: usage.trial ? usage.trial.dayIndex : null,
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
      setFormerSubscriber(usage.formerSubscriber === true);
      setBillingManageable(usage.billingManageable === true);
      setTrial(usage.trial ?? null);
      setTrialBlocked(usage.trialBlocked ?? null);
      setFeedbackRewardAvailable(usage.feedbackReward?.available === true);
      // Só marca resolvido em caso de sucesso — assim canAnalyze fica travado até
      // termos a verdade do backend, evitando gastar grátis por engano.
      setStatusResolved(true);
    } catch {
      // Sem resposta valida, o plano e desconhecido, nao gratuito ou encerrado.
      setStatusResolved(false);
      setIsUnavailable(true);
    }
  }, [getToken, isLoaded, user]);

  useEffect(() => {
    void refreshLimits();

    const handleRefresh = () => {
      void refreshLimits();
    };

    window.addEventListener(ANALYSIS_REFRESH_EVENT, handleRefresh);
    window.addEventListener(USAGE_REFRESH_EVENT, handleRefresh);

    return () => {
      window.removeEventListener(ANALYSIS_REFRESH_EVENT, handleRefresh);
      window.removeEventListener(USAGE_REFRESH_EVENT, handleRefresh);
    };
  }, [refreshLimits]);

  // Refresh the server's decision at the boundary shown to the user. No local
  // credit grant: remaining/canAnalyze still come from the usage response.
  useEffect(() => {
    if (!trial || trial.status !== 'active') return;
    const boundary = trial.nextAvailableAt ?? trial.windowEndsAt;
    const delay = new Date(boundary).getTime() - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = window.setTimeout(() => void refreshLimits(), Math.min(Math.max(delay + 1000, SHARE_WINDOW_MS + 100), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [trial, refreshLimits]);

  useEffect(() => {
    if (!user) {
      setPlanContext(null);
      setAnalysisCount(0);
      setAnalysisLimit(FREE_LIMIT);
      setFreeTotal(null);
      setFreeLocked(false);
      setFormerSubscriber(false);
      setBillingManageable(false);
      setTrial(null);
      setTrialBlocked(null);
      setFeedbackRewardAvailable(false);
      setUserPlan('free');
      setBackendUnlimited(false);
      setStatusResolved(false);
      setIsUnavailable(false);
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
      formerSubscriber: false,
      billingManageable: false,
      trial: null,
      trialBlocked: null,
      feedbackRewardAvailable: false,
      isLoading: false,
      isUnavailable: false,
      retry: retryUsage,
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
      plan: null,
      // Ainda nao chegou do backend; o painel usa o contador local ate chegar.
      analysesAllTime: null,
      totalUsed: null,
      totalLimit: null,
      freeLocked: false,
      formerSubscriber: false,
      billingManageable: false,
      trial: null,
      trialBlocked: null,
      feedbackRewardAvailable: false,
      isLoading: true,
      isUnavailable,
      retry: retryUsage,
    };
  }

  // Usuário logado, plano confirmado
  const total = isUnlimited ? Infinity : analysisLimit;
  const used = analysisCount;
  // Bater o teto de 10 no total zera o que resta, mesmo com sinal sobrando.
  const totalCapHit = !isUnlimited && freeTotal !== null && freeTotal.used >= freeTotal.limit;
  // Trial: o servidor ja diz quanto resta HOJE (0 com o dia ou o trial esgotado).
  const activeTrial = isUnlimited ? null : trial;
  const remaining = isUnlimited
    ? Infinity
    : activeTrial
      ? activeTrial.remainingToday
      : trialBlocked || formerSubscriber
        ? 0
        : totalCapHit
          ? 0
          : Math.max(0, analysisLimit - used);
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
    formerSubscriber: !isUnlimited && formerSubscriber,
    billingManageable: isUnlimited && billingManageable,
    trial: activeTrial,
    trialBlocked: isUnlimited ? null : trialBlocked,
    feedbackRewardAvailable: !isUnlimited && feedbackRewardAvailable,
    isLoading: false,
    isUnavailable: false,
    retry: retryUsage,
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
