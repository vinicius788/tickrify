import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { History, Star, PlusCircle, Crown, Check, AlertCircle, FlaskConical, Clock, Wifi, WifiOff, LayoutGrid, CreditCard, BarChart3, Target, Activity, Zap } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { UserButton, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NewAnalysis from "../dashboard/NewAnalysis";
import LiveTape from "../dashboard/LiveTape";
import MyTrades from "../dashboard/MyTrades";
import Watchlist from "../dashboard/Watchlist";
import AnalysisResult from "../dashboard/AnalysisResult";
import LockedAnalysis from "../dashboard/LockedAnalysis";
import AnalysisLoading from "../dashboard/AnalysisLoading";
import AnalysisCounter from "../dashboard/AnalysisCounter";
import { TicksBadge } from "@/components/dashboard/TicksBadge";
import { useAnalysisLimit, useIncrementAnalysis } from "@/hooks/useAnalysisLimit";
import { APIError, useAPIClient, type AIAnalysisResponse, type Bias, type Recommendation } from "@/lib/api";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { confidenceToPercent, normalizeRecommendationLabel, signalToneClass } from "@/lib/trading-ui";
import { useAnalyses } from "@/hooks/useAnalyses";
import { useTicks } from "@/hooks/useTicks";
import { track } from "@/lib/analytics";
import { PLANS } from "@/components/pricing/PricingCards";
import { detectCurrency } from "@/lib/stripe";
import { PageHeader } from "@/components/ui/PageHeader";

// Textos do dashboard que estavam hardcoded em PT — agora EN por padrão (público global),
// PT quando o idioma for português. Contido neste arquivo (sem mexer nos 6 locales).
const DASH_COPY = {
  en: {
    planActivatedTitle: 'Plan activated!',
    planActivatedDesc: 'Welcome to Tickrify. Your ticks are now available.',
    uploadRequired: 'Please upload a chart image.',
    invalidFormat: 'Invalid format. Upload a PNG, JPG/JPEG or WEBP image.',
    tooLarge: 'File too large. The limit is 10MB.',
    ticksOutTitle: 'Ticks used up',
    ticksOutDesc: 'Your plan ticks are used up. They renew automatically next cycle.',
    weeklyInsight: 'This week',
    analysisError: 'Analysis error',
    tryAgain: 'Try again',
    upgradeToPro: 'Upgrade to Pro',
    demoMode: 'Demo mode: exploring the interface without login',
    demoLogin: 'Log in for real analyses',
    choosePlan: 'Choose your plan',
    planSub: 'Monthly ticks, renewed automatically. No surprises.',
    seePlans: 'See plans & subscribe',
    later: 'Maybe later',
    perMonth: '/mo',
  },
  pt: {
    planActivatedTitle: 'Plano ativado!',
    planActivatedDesc: 'Bem-vindo ao Tickrify. Seus ticks já estão disponíveis.',
    uploadRequired: 'Por favor, faça upload de uma imagem de gráfico.',
    invalidFormat: 'Formato inválido. Envie uma imagem PNG, JPG/JPEG ou WEBP.',
    tooLarge: 'Arquivo muito grande. O limite é de 10MB.',
    ticksOutTitle: 'Ticks esgotados',
    ticksOutDesc: 'Seus ticks do plano se esgotaram. Eles renovam automaticamente no próximo ciclo.',
    weeklyInsight: 'Insight da semana',
    analysisError: 'Erro na Análise',
    tryAgain: 'Tentar Novamente',
    upgradeToPro: 'Fazer Upgrade para Pro',
    demoMode: 'Modo Demonstração: explorando a interface sem login',
    demoLogin: 'Fazer Login para Análises Reais',
    choosePlan: 'Escolha seu plano',
    planSub: 'Ticks mensais renovados automaticamente. Sem surpresas.',
    seePlans: 'Ver planos e assinar',
    later: 'Continuar depois',
    perMonth: '/mês',
  },
} as const;
import officialIcon from "@/assets/tickrify-icon-official.png";

type View = 'dashboard' | 'new-analysis' | 'my-trades' | 'watchlist' | 'analysis-result' | 'loading' | 'error' | 'locked';
type RecentAnalysisItem = {
  symbol: string;
  timeframe: string;
  recommendation: Recommendation;
  bias: Bias;
  confidence: number;
  createdAt: string;
};
type ActiveMarketItem = {
  name: string;
  lastSeen: string;
};

const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const DashboardPage = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const dc = language === 'pt' ? DASH_COPY.pt : DASH_COPY.en;
  const modalCurrency = detectCurrency(typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [analysisKey, setAnalysisKey] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AIAnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { plan, total, used, isUnlimited, remaining } = useAnalysisLimit();
  const incrementAnalysis = useIncrementAnalysis();
  const { user } = useUser();
  const { toast } = useToast();
  const apiClient = useAPIClient();
  const isDemo = !user;
  const { analyses: rawAnalyses, loading: loadingAnalyses, refetch: refetchAnalyses } = useAnalyses(40);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // Dados de exemplo APENAS para modo DEMO
  const demoActiveMarkets = [
    { name: "BTC/USD", change: "+2.5%", isUp: true },
    { name: "EUR/USD", change: "-0.1%", isUp: false },
    { name: "AAPL", change: "+1.2%", isUp: true },
  ];

  const demoRecentAnalyses = [
    { symbol: "ETH/USD", timeframe: "4H", recommendation: "COMPRA", bias: "bullish", confidence: 82, createdAt: new Date().toISOString() },
    { symbol: "TSLA", timeframe: "1D", recommendation: "AGUARDAR", bias: "neutral", confidence: 58, createdAt: new Date().toISOString() },
    { symbol: "XAU/USD", timeframe: "1H", recommendation: "VENDA", bias: "bearish", confidence: 77, createdAt: new Date().toISOString() },
  ];

  // Derivar análises recentes e mercados ativos via useMemo (sem estado manual)
  const recentAnalyses = useMemo<RecentAnalysisItem[]>(() => {
    if (isDemo || rawAnalyses.length === 0) return [];
    const completed = rawAnalyses
      .filter((a) => a.status === 'completed')
      .map((a) => ({
        symbol: String(a.symbol || '').trim() || 'N/A',
        timeframe: String(a.timeframe || '').trim() || 'N/A',
        recommendation: normalizeRecommendationLabel(a.recommendation) as Recommendation,
        bias: (a.bias || 'neutral') as Bias,
        confidence: confidenceToPercent(a.confidence),
        createdAt: a.createdAt,
      }));
    const withIdentity = completed.filter((item) => item.symbol !== 'N/A' && item.timeframe !== 'N/A');
    return (withIdentity.length > 0 ? withIdentity : completed).slice(0, 3);
  }, [rawAnalyses, isDemo]);

  const realActiveMarkets = useMemo<ActiveMarketItem[]>(() => {
    if (isDemo || rawAnalyses.length === 0) return [];
    const now = Date.now();
    const activeWindowMs = 8 * 60 * 60 * 1000;
    const formatLastSeen = (dateIso: string) => {
      const diffMs = Math.max(0, now - new Date(dateIso).getTime());
      const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
      if (minutes < 60) return `${minutes} min ${t.nav.ago}`;
      return `${Math.floor(minutes / 60)}h ${t.nav.ago}`;
    };
    const recent = rawAnalyses
      .filter((a) => a.createdAt && now - new Date(a.createdAt).getTime() <= activeWindowMs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const marketMap = new Map<string, ActiveMarketItem>();
    for (const analysis of recent) {
      const symbol = String(analysis.symbol || '').trim();
      if (!symbol || symbol === 'N/A') continue;
      if (!marketMap.has(symbol)) {
        const timeframe = analysis.timeframe ? ` • ${analysis.timeframe}` : '';
        marketMap.set(symbol, { name: `${symbol}${timeframe}`, lastSeen: formatLastSeen(analysis.createdAt) });
      }
    }
    return Array.from(marketMap.values()).slice(0, 6);
  }, [rawAnalyses, isDemo]);

  // KPIs do cockpit — derivados das análises já carregadas (sem fetch novo).
  const dashboardKpis = useMemo(() => {
    const completed = rawAnalyses.filter((a) => a.status === 'completed');
    const confidences = completed
      .map((a) => confidenceToPercent(a.confidence))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avgConfidence = confidences.length
      ? Math.round(confidences.reduce((sum, n) => sum + n, 0) / confidences.length)
      : 0;
    return { total: completed.length, avgConfidence };
  }, [rawAnalyses]);

  const { balance: ticksBalance } = useTicks();

  // Insight da semana — bullish vs bearish nas análises dos últimos 7 dias.
  const weeklyInsight = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let bull = 0;
    let bear = 0;
    for (const a of rawAnalyses) {
      if (a.status !== 'completed' || !a.createdAt) continue;
      if (new Date(a.createdAt).getTime() < weekAgo) continue;
      const r = String(a.recommendation || '').toUpperCase();
      if (/BUY|COMPRA|BULL|ALTA/.test(r)) bull += 1;
      else if (/SELL|VENDA|BEAR|BAIXA/.test(r)) bear += 1;
    }
    return { bull, bear, total: bull + bear };
  }, [rawAnalyses]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticksState = params.get('ticks');
    const successState = params.get('success');

    if (successState === 'true') {
      // RECEITA: confirmação client-side (best effort). Fonte de verdade = webhook do Stripe.
      track('subscription_activated', { source: 'redirect' });
      toast({
        title: dc.planActivatedTitle,
        description: dc.planActivatedDesc,
      });
      // Dispara re-fetch do limite para refletir o novo plano
      window.dispatchEvent(new Event('tickrify:analysis-created'));
      window.history.replaceState({}, '', '/dashboard');
      return;
    }

  }, [toast, dc]);

  // Ativação do funil: usuário entrou no modo demo (sem login).
  useEffect(() => {
    if (isDemo) track('demo_opened');
  }, [isDemo]);

  // Ativação: usuário NOVO (logado, ainda sem nenhuma análise) cai direto na tela
  // de subir o gráfico — não no painel vazio com KPIs zerados. Roteia uma única vez,
  // e só para quem nunca fez uma análise (usuário recorrente continua caindo no painel).
  const [autoRoutedNewUser, setAutoRoutedNewUser] = useState(false);
  useEffect(() => {
    if (autoRoutedNewUser || isDemo || !user || loadingAnalyses) return;
    const hasAnalysis = rawAnalyses.some((a) => a.status === 'completed');
    if (!hasAnalysis) {
      setActiveView('new-analysis');
    }
    setAutoRoutedNewUser(true);
  }, [autoRoutedNewUser, isDemo, user, loadingAnalyses, rawAnalyses]);

  // Usar dados demo ou reais dependendo do modo
  const activeMarkets = isDemo ? demoActiveMarkets : realActiveMarkets;
  const displayRecentAnalyses = isDemo ? demoRecentAnalyses : recentAnalyses;

  const goToPricing = useCallback(() => {
    setShowUpgradeModal(false);
    window.location.href = '/pricing';
  }, []);

  const openUpgradeModal = useCallback((trigger: string) => {
    track('upgrade_modal_viewed', { trigger });
    setShowUpgradeModal(true);
  }, []);

  const resetNewAnalysisView = useCallback(() => {
    setActiveView('new-analysis');
    setAnalysisKey((key) => key + 1);
    setAnalysisData(null);
    setErrorMessage('');
    setUploadedImage(null);
  }, []);

  const handleStartAnalysis = async (
    imageUrl: string | null = null,
    imageFile: File | null = null,
    htfBase64Images: string[] = [],
    analysisType: 'quick' | 'deep' = 'quick',
  ) => {
    // Modo DEMO: apenas simula, não faz análise real
    if (isDemo) {
      setUploadedImage(imageUrl);
      setActiveView('loading');
      setTimeout(() => {
        setAnalysisData(null);
        setActiveView('analysis-result');
      }, 2000); // Simulação mais rápida no demo
      return;
    }

    // Validar se tem imagem
    if (!imageUrl && !imageFile) {
      setErrorMessage(dc.uploadRequired);
      setActiveView('error');
      return;
    }

    if (imageFile) {
      const normalizedType = String(imageFile.type || '').toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(normalizedType)) {
        setErrorMessage(dc.invalidFormat);
        setActiveView('error');
        return;
      }

      if (imageFile.size > MAX_IMAGE_FILE_SIZE) {
        setErrorMessage(dc.tooLarge);
        setActiveView('error');
        return;
      }
    }

    // Grátis sem análises restantes → mostra o valor trancado, sem gastar uma chamada de API.
    if (!isDemo && !isUnlimited && Number.isFinite(remaining) && remaining <= 0) {
      setUploadedImage(imageUrl);
      track('free_limit_reached', { reason: 'no_free_left' });
      track('upgrade_modal_viewed', { trigger: 'locked_value' });
      setActiveView('locked');
      return;
    }

    const startedAt = performance.now();
    try {
      setUploadedImage(imageUrl);
      setActiveView('loading');
      setErrorMessage('');

      track('analysis_started', { analysisType });

      const response = await apiClient.createAnalysis({
        imageFile: imageFile || undefined,
        base64Image: imageUrl || undefined,
        userLanguage: language,
        htfBase64Images: htfBase64Images.length > 0 ? htfBase64Images : undefined,
        analysisType,
      });

      // Incrementar contador (apenas quando logado)
      incrementAnalysis();

      const analysis = await apiClient.waitForAnalysisCompletion(response.id, response);

      if (analysis.status === 'failed') {
        throw new Error(analysis.reasoning || 'Falha ao processar análise');
      }

      // Análise concluída
      setAnalysisData(analysis);
      setActiveView('analysis-result');
      // ATIVAÇÃO: resultado renderizado com sucesso (apenas usuário logado).
      track('analysis_completed', {
        analysisType,
        recommendation: analysis.recommendation ?? 'unknown',
        confidence: analysis.confidence ?? null,
        symbol: analysis.symbol ?? null,
        plan,
        // Posição da análise na escada grátis (1, 2 ou 3). null para plano pago/ilimitado.
        // `used` vem do backend (count antes desta análise), então esta é a (used+1)-ésima.
        analysisNumber: isUnlimited ? null : used + 1,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (!isDemo && user) {
        refetchAnalyses();
      }
    } catch (error) {
      console.error('[Dashboard] Erro ao criar análise:', error);
      track('analysis_failed', {
        code: error instanceof APIError ? (error.code || error.status || 'api_error') : 'unknown',
        analysisType,
        durationMs: Math.round(performance.now() - startedAt),
      });
      // Reconcilia o contador com o backend: falhas não consomem análise grátis,
      // então o slot precisa voltar caso a IA tenha falhado.
      incrementAnalysis();
      if (error instanceof APIError) {
        let parsedBody: Record<string, unknown> | null = null;
        try {
          parsedBody = JSON.parse(error.message) as Record<string, unknown>;
        } catch {
          parsedBody = null;
        }

        const apiCode = error.code || String(parsedBody?.code || '');
        if (apiCode === 'INSUFFICIENT_TICKS') {
          track('free_limit_reached', { reason: 'insufficient_ticks' });
          toast({
            title: dc.ticksOutTitle,
            description: dc.ticksOutDesc,
            variant: 'destructive',
          });
          resetNewAnalysisView();
          return;
        }

        if (apiCode === 'SUBSCRIPTION_REQUIRED' || apiCode === 'DEMO_LIMIT_REACHED' || error.status === 403) {
          // Sem análises grátis restantes → mostra o valor trancado (paywall com preview borrado).
          track('free_limit_reached', { reason: apiCode || 'forbidden' });
          track('upgrade_modal_viewed', { trigger: 'locked_value' });
          setActiveView('locked');
          return;
        }

        if (
          error.status === 402 ||
          error.status === 429 ||
          error.code === 'upgrade_required' ||
          error.code === 'quota_exceeded'
        ) {
          openUpgradeModal('quota');
        }
      }

      if (error instanceof APIError && error.code === 'analysis_timeout') {
        setErrorMessage('A análise demorou mais que o esperado, tente novamente.');
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido ao processar análise');
      }
      setActiveView('error');
    }
  };

  const handleRetry = () => {
    resetNewAnalysisView();
  };

  const viewEyebrow = (label: string) => (
    <div className="tk-eyebrow flex items-center gap-2 text-[11px]">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
      {t.nav.workspace} / {label}
    </div>
  );

  const renderDashboardHome = () => {
    const titleWords = t.nav.centralTitle.split(' ');
    const titleLast = titleWords.length > 1 ? titleWords.pop() : '';
    const titleHead = titleWords.join(' ');
    const bullPct = weeklyInsight.total > 0 ? Math.round((weeklyInsight.bull / weeklyInsight.total) * 100) : 0;
    const firstName = user?.firstName || 'Trader';
    const ticksNum = Math.floor(Number(ticksBalance) || 0);
    const kpis: Array<{ label: string; value: string; sub: string; Icon: typeof BarChart3; accent?: boolean }> = [
      { label: t.nav.analysesWord, value: String(dashboardKpis.total), sub: t.nav.kpiSubTotal, Icon: BarChart3 },
      { label: t.analysis.confidence, value: `${dashboardKpis.avgConfidence}%`, sub: t.nav.kpiSubConf, Icon: Target, accent: true },
      { label: t.nav.activeMarkets, value: String(realActiveMarkets.length), sub: t.nav.kpiSubMarkets, Icon: Activity },
      { label: 'Ticks', value: String(ticksNum), sub: t.nav.kpiSubTicks, Icon: Zap },
    ];
    return (
      <div className="flex flex-col gap-4">
        {/* Cockpit hero */}
        <div
          className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 md:p-8"
          style={{ backgroundImage: 'radial-gradient(ellipse 720px 320px at 100% 0%, rgba(0,232,122,0.06), transparent 60%)' }}
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="tk-eyebrow flex items-center gap-2 text-[11px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
                {t.nav.greeting}, {firstName}
              </div>
              <h1 className="tk-display mt-2 text-4xl md:text-5xl">
                {titleHead}{' '}
                {titleLast && <em className="font-serif italic text-[var(--text-secondary)]">{titleLast}</em>}
              </h1>
              <p className="mt-3 font-terminal text-xs text-[var(--text-secondary)]">
                {ticksNum} ticks · {dashboardKpis.total} {t.nav.analysesWord} · {t.analysis.confidence} {dashboardKpis.avgConfidence}%
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveView('watchlist')}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-white/[0.04]"
              >
                <Star className="h-4 w-4" /> {t.nav.watchlist}
              </button>
              <button
                type="button"
                onClick={resetNewAnalysisView}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90"
              >
                <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
              </button>
            </div>
          </div>
        </div>

        {/* KPIs — painel único dividido */}
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] md:grid-cols-4 md:divide-y-0">
          {kpis.map((k) => (
            <div key={k.label} className="p-5">
              <div className="flex items-start justify-between">
                <div className="tk-stat-label">{k.label}</div>
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-subtle)]">
                  <k.Icon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                </span>
              </div>
              <div className={`tk-stat mt-3 text-3xl ${k.accent ? 'text-[var(--accent-green)]' : ''}`}>{k.value}</div>
              <div className="tk-stat-label mt-1 opacity-60">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Recent + Insight */}
        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="tk-stat-label">{t.nav.recentAnalyses}</div>
              <button
                type="button"
                onClick={() => setActiveView('my-trades')}
                className="font-terminal text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                aria-label={t.nav.recentAnalyses}
              >
                →
              </button>
            </div>
            {displayRecentAnalyses.length > 0 ? (
              displayRecentAnalyses.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between border-t border-[var(--border-subtle)] py-2 first:border-t-0"
                >
                  <span className="font-terminal text-xs text-[var(--text-primary)]">
                    {item.symbol} <span className="text-[var(--text-secondary)]">{item.timeframe}</span>
                  </span>
                  <span className={`font-terminal text-[11px] font-semibold ${signalToneClass(item.recommendation)}`}>
                    {item.recommendation} {item.confidence}%
                  </span>
                </div>
              ))
            ) : (
              <p className="py-3 text-xs text-[var(--text-secondary)]">{loadingAnalyses ? t.common.loading : '—'}</p>
            )}
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
            <div className="tk-stat-label">{dc.weeklyInsight}</div>
            <div className="mt-4 flex gap-6">
              <div>
                <div className="tk-stat text-2xl text-[var(--accent-green)]">{weeklyInsight.bull}</div>
                <div className="tk-stat-label mt-1">Bullish</div>
              </div>
              <div>
                <div className="tk-stat text-2xl text-[var(--signal-sell)]">{weeklyInsight.bear}</div>
                <div className="tk-stat-label mt-1">Bearish</div>
              </div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(248,113,113,0.25)' }}>
              <div className="h-full" style={{ width: `${bullPct}%`, background: 'var(--accent-green)' }} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return renderDashboardHome();
      case 'new-analysis':
        return (
          <div className="flex flex-col gap-4">
            <div>
              {viewEyebrow(t.nav.newAnalysis)}
              <h1 className="tk-display mt-2 text-3xl md:text-4xl">{t.nav.newAnalysis}</h1>
            </div>
            <NewAnalysis key={analysisKey} onStartAnalysis={handleStartAnalysis} allowHigherTimeframes={!isDemo && isUnlimited} />
          </div>
        );
      case 'my-trades':
        return <MyTrades />;
      case 'watchlist':
        return <Watchlist />;
      case 'analysis-result': {
        // Gancho de retorno: depois do resultado, dar um próximo passo claro
        // (analisar outro / quantas grátis restam / assinar) — sem beco sem saída.
        const freeLeftKnown = !isUnlimited && Number.isFinite(remaining);
        const exhausted = freeLeftKnown && remaining <= 0;
        return (
          <div className="flex flex-col gap-4">
            <AnalysisResult analysisData={analysisData} uploadedImage={uploadedImage} />
            {!isDemo && (
              <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {freeLeftKnown && !exhausted && (
                    <p className="text-sm text-[var(--text-primary)]">
                      <span className="font-semibold text-[var(--accent-green)]">{remaining}</span>{' '}
                      {t.counter.remainingFree}
                    </p>
                  )}
                  {exhausted && <p className="text-sm text-amber-500">{t.counter.exhausted}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {exhausted ? (
                    <Link to="/pricing">
                      <Button size="sm">
                        <Crown className="mr-2 h-4 w-4" />
                        {t.counter.subscribe}
                      </Button>
                    </Link>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={resetNewAnalysisView}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90"
                      >
                        <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
                      </button>
                      {freeLeftKnown && (
                        <Link
                          to="/pricing"
                          className="text-xs text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline"
                        >
                          {t.counter.viewPlans}
                        </Link>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'locked':
        return <LockedAnalysis onUnlock={() => navigate('/pricing')} />;
      case 'loading':
        return <AnalysisLoading />;
      case 'error':
        return (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{dc.analysisError}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button onClick={handleRetry}>{dc.tryAgain}</Button>
              <Button variant="outline" onClick={resetNewAnalysisView}>
                {t.nav.newAnalysis}
              </Button>
            </div>
          </div>
        );
      default:
        return renderDashboardHome();
    }
  };

  const safeTotal = Number.isFinite(total) ? Math.max(0, Number(total)) : null;
  const safeUsed = Number.isFinite(used) ? Math.max(0, Number(used)) : 0;
  const navbarUnlimited =
    isUnlimited ||
    total === null ||
    total === undefined ||
    total === -1 ||
    !Number.isFinite(total);
  const quotaText = safeTotal === null ? `${safeUsed}/-` : `${Math.min(safeUsed, safeTotal)}/${safeTotal}`;
  const mobileActiveView =
    activeView === 'analysis-result' || activeView === 'loading' || activeView === 'error'
      ? 'new-analysis'
      : activeView;
  const currentViewLabel =
    activeView === 'my-trades'
      ? t.nav.myTrades
      : activeView === 'watchlist'
        ? t.nav.watchlist
        : activeView === 'dashboard'
          ? t.nav.dashboard
          : t.nav.newAnalysis;
  const sidebarSectionTitleClass = 'text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]';

  return (
    <div className="relative z-10 flex min-h-screen w-full overflow-x-hidden bg-[#050508]">
      {/* SIDEBAR (desktop) */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[var(--border-subtle)] md:flex">
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
          <img src={officialIcon} alt="Tickrify" className="h-8 w-auto shrink-0 object-contain" />
          <div className="leading-none">
            <div className="text-sm font-bold tracking-wide text-[var(--text-primary)]">TICKRIFY</div>
            <div className="mt-1 font-terminal text-[8px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Institutional Terminal</div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-3">
          <div className={`${sidebarSectionTitleClass} px-2 pb-1 pt-2`}>{t.nav.workArea}</div>
          <nav className="flex flex-col gap-0.5">
            <button type="button" onClick={() => setActiveView('dashboard')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'dashboard' ? 'bg-white text-[#050508]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
              <LayoutGrid className="h-4 w-4" /> {t.nav.dashboard}
            </button>
            <button type="button" onClick={resetNewAnalysisView} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'new-analysis' || activeView === 'analysis-result' || activeView === 'loading' || activeView === 'error' ? 'bg-white text-[#050508]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
              <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
            </button>
            <button type="button" onClick={() => setActiveView('my-trades')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'my-trades' ? 'bg-white text-[#050508]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
              <History className="h-4 w-4" /> {t.nav.myTrades}
            </button>
            <button type="button" onClick={() => setActiveView('watchlist')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'watchlist' ? 'bg-white text-[#050508]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
              <Star className="h-4 w-4" /> {t.nav.watchlist}
            </button>
          </nav>

          <div className={`${sidebarSectionTitleClass} px-2 pb-1 pt-5`}>{t.nav.account}</div>
          <nav className="flex flex-col gap-0.5">
            <Link to="/pricing" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]">
              <CreditCard className="h-4 w-4" /> {t.nav.plans}
            </Link>
            {user && plan === 'free' && (
              <button type="button" onClick={() => openUpgradeModal('sidebar')} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]">
                <Crown className="h-4 w-4 text-[var(--accent-green)]" /> {dc.upgradeToPro}
              </button>
            )}
          </nav>

          {user && plan === 'free' && (
            <div className="mt-4">
              <AnalysisCounter />
            </div>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2.5 border-t border-[var(--border-subtle)] p-3">
            <UserButton afterSignOutUrl="/" />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs text-[var(--text-primary)]">{user.firstName || user.fullName || 'Trader'}</div>
              <div className="font-terminal text-[8px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">{plan.toUpperCase()}{navbarUnlimited ? ` · ${t.nav.statusActive}` : ''}</div>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Banner de Demo */}
      {isDemo && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 text-center font-medium sticky top-0 z-50 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center justify-center rounded-full bg-primary/15 p-1.5">
              <FlaskConical className="h-4 w-4 text-primary" />
            </span>
            <span className="text-foreground">{dc.demoMode}</span>
            <Link to="/" className="text-primary underline underline-offset-2 hover:no-underline font-semibold">
              {dc.demoLogin}
            </Link>
          </div>
        </div>
      )}
      
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[#050508]/95 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={user ? "/dashboard" : "/"} className="md:hidden">
            <img src={officialIcon} alt="Tickrify" className="h-7 w-auto shrink-0 object-contain" />
          </Link>
          <span className="hidden items-center gap-2 font-terminal text-[11px] uppercase tracking-[0.14em] md:flex">
            <span className="text-[var(--text-secondary)]">{t.nav.workspace}</span>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-primary)]">{currentViewLabel}</span>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 overflow-visible text-sm md:gap-3">
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-[var(--accent-green)]' : 'bg-red-500'}`} />
            <span className={`font-terminal text-[11px] ${isOnline ? 'text-[var(--accent-green)]' : 'text-red-500'}`}>
              {isOnline ? t.common.online : t.common.offline}
            </span>
          </div>

          {user && <TicksBadge />}

          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-sm font-medium">
            <Zap className="h-3.5 w-3.5 text-[var(--accent-green)]" />
            <span className="whitespace-nowrap">{navbarUnlimited ? plan.toUpperCase() : quotaText}</span>
            <span className="hidden whitespace-nowrap text-[var(--text-secondary)] md:inline">
              {navbarUnlimited ? `· ${t.nav.statusActive}` : t.nav.analysesWord}
            </span>
          </div>

          <LanguageSwitcher />

          {user && (
            <div className="shrink-0 md:hidden">
              <UserButton afterSignOutUrl="/" />
            </div>
          )}
        </div>
      </header>

      <LiveTape />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border md:hidden">
          <div className="flex">
            {(['dashboard', 'new-analysis', 'my-trades', 'watchlist'] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => {
                  if (view === 'new-analysis') {
                    resetNewAnalysisView();
                  } else {
                    setActiveView(view);
                  }
                }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  mobileActiveView === view
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                {view === 'dashboard' ? '▦ Painel' : view === 'new-analysis' ? '⊕ Análise' : view === 'my-trades' ? '↺ Trades' : '☆ Watchlist'}
              </button>
            ))}
          </div>
          {user && plan === 'free' && (
            <div className="p-3">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => openUpgradeModal('cta')}
              >
                <Crown className="mr-2 h-4 w-4" />
                {dc.upgradeToPro}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-y-auto p-3 md:p-6">
            <div className="flex flex-col gap-6 md:gap-8">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
      </div>

      {/* Modal de Upgrade */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              {dc.choosePlan}
            </DialogTitle>
            <DialogDescription>
              {dc.planSub}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`flex items-center justify-between rounded-lg px-4 py-3 border ${
                  plan.featured
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-muted/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  {plan.featured && <Crown className="h-4 w-4 text-primary flex-shrink-0" />}
                  <div>
                    <span className="font-semibold text-sm">{plan.name}</span>
                    {plan.featured && (
                      <span className="ml-2 text-xs text-primary font-medium">{plan.badge}</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold">{plan.prices.monthly[modalCurrency]}{dc.perMonth}</div>
                  <div className="text-xs text-muted-foreground">{plan.ticks}</div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="sm:flex-col gap-2">
            <Button className="w-full" onClick={goToPricing}>
              <Crown className="mr-2 h-4 w-4" />
              {dc.seePlans}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setShowUpgradeModal(false)}>
              {dc.later}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
