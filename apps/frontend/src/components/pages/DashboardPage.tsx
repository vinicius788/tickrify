import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { History, Star, PlusCircle, Crown, Check, AlertCircle, FlaskConical, Clock, Wifi, WifiOff, LayoutGrid, CreditCard } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { UserButton, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NewAnalysis from "../dashboard/NewAnalysis";
import LiveTape from "../dashboard/LiveTape";
import MyTrades from "../dashboard/MyTrades";
import Watchlist from "../dashboard/Watchlist";
import AnalysisResult from "../dashboard/AnalysisResult";
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
import { PLANS } from "@/components/pricing/PricingCards";
import { PageHeader } from "@/components/ui/PageHeader";
import officialIcon from "@/assets/tickrify-icon-official.png";

type View = 'dashboard' | 'new-analysis' | 'my-trades' | 'watchlist' | 'analysis-result' | 'loading' | 'error';
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
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [analysisKey, setAnalysisKey] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AIAnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { plan, total, used, isUnlimited } = useAnalysisLimit();
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
      toast({
        title: 'Plano ativado!',
        description: 'Bem-vindo ao Tickrify. Seus ticks já estão disponíveis.',
      });
      // Dispara re-fetch do limite para refletir o novo plano
      window.dispatchEvent(new Event('tickrify:analysis-created'));
      window.history.replaceState({}, '', '/dashboard');
      return;
    }

  }, [toast]);

  // Usar dados demo ou reais dependendo do modo
  const activeMarkets = isDemo ? demoActiveMarkets : realActiveMarkets;
  const displayRecentAnalyses = isDemo ? demoRecentAnalyses : recentAnalyses;

  const goToPricing = useCallback(() => {
    setShowUpgradeModal(false);
    window.location.href = '/pricing';
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
      setErrorMessage('Por favor, faça upload de uma imagem de gráfico.');
      setActiveView('error');
      return;
    }

    if (imageFile) {
      const normalizedType = String(imageFile.type || '').toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(normalizedType)) {
        setErrorMessage('Formato inválido. Envie uma imagem PNG, JPG/JPEG ou WEBP.');
        setActiveView('error');
        return;
      }

      if (imageFile.size > MAX_IMAGE_FILE_SIZE) {
        setErrorMessage('Arquivo muito grande. O limite é de 10MB.');
        setActiveView('error');
        return;
      }
    }

    try {
      setUploadedImage(imageUrl);
      setActiveView('loading');
      setErrorMessage('');

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
      if (!isDemo && user) {
        refetchAnalyses();
      }
    } catch (error) {
      console.error('[Dashboard] Erro ao criar análise:', error);
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
          toast({
            title: 'Ticks esgotados',
            description: 'Seus ticks do plano se esgotaram. Eles renovam automaticamente no próximo ciclo.',
            variant: 'destructive',
          });
          resetNewAnalysisView();
          return;
        }

        if (apiCode === 'SUBSCRIPTION_REQUIRED' || apiCode === 'DEMO_LIMIT_REACHED' || error.status === 403) {
          // Sem assinatura ativa ou demos esgotadas → redirecionar para página de planos
          navigate('/pricing');
          return;
        }

        if (
          error.status === 402 ||
          error.status === 429 ||
          error.code === 'upgrade_required' ||
          error.code === 'quota_exceeded'
        ) {
          setShowUpgradeModal(true);
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
    return (
      <div className="flex flex-col gap-5">
        <div>
          {viewEyebrow(t.nav.dashboard)}
          <h1 className="tk-display mt-2 text-3xl md:text-4xl">
            {titleHead}{' '}
            {titleLast && <em className="font-serif italic text-[var(--text-secondary)]">{titleLast}</em>}
          </h1>
          <p className="mt-1 max-w-[480px] text-sm text-[var(--text-secondary)]">{t.analysis.upload.subtitle}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
            <div className="tk-stat-label">{t.nav.analysesWord}</div>
            <div className="tk-stat mt-2 text-2xl md:text-3xl">{dashboardKpis.total}</div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
            <div className="tk-stat-label">{t.analysis.confidence}</div>
            <div className="tk-stat mt-2 text-2xl text-[var(--accent-green)] md:text-3xl">{dashboardKpis.avgConfidence}%</div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
            <div className="tk-stat-label">{t.nav.activeMarkets}</div>
            <div className="tk-stat mt-2 text-2xl md:text-3xl">{realActiveMarkets.length}</div>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3">
            <div className="tk-stat-label">Ticks</div>
            <div className="tk-stat mt-2 text-2xl md:text-3xl">{Math.floor(Number(ticksBalance) || 0)}</div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
            <div className="tk-stat-label mb-3">{t.nav.recentAnalyses}</div>
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
            <div className="tk-stat-label">Insight da semana</div>
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
      case 'analysis-result':
        return <AnalysisResult analysisData={analysisData} uploadedImage={uploadedImage} />;
      case 'loading':
        return <AnalysisLoading />;
      case 'error':
        return (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro na Análise</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button onClick={handleRetry}>Tentar Novamente</Button>
              <Button variant="outline" onClick={resetNewAnalysisView}>
                Nova Análise
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
  const sidebarSectionTitleClass = 'text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]';

  return (
    <div className="relative z-10 flex min-h-screen w-full flex-col overflow-x-hidden bg-[#050508]">
      {/* Banner de Demo */}
      {isDemo && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 text-center font-medium sticky top-0 z-50 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center justify-center rounded-full bg-primary/15 p-1.5">
              <FlaskConical className="h-4 w-4 text-primary" />
            </span>
            <span className="text-foreground">Modo Demonstração: explorando a interface sem login</span>
            <Link to="/" className="text-primary underline underline-offset-2 hover:no-underline font-semibold">
              Fazer Login para Análises Reais
            </Link>
          </div>
        </div>
      )}
      
      <header className="sticky top-0 z-40 border-b border-border bg-[#050508]/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
          <Link to={user ? "/dashboard" : "/"} className="flex min-w-0 shrink-0 items-center gap-2">
            <img src={officialIcon} alt="Tickrify" className="h-8 w-auto shrink-0 object-contain" />
            <div className="hidden flex-col leading-none md:flex">
              <span className="text-sm font-bold tracking-wide">TICKRIFY</span>
              <span className="text-xs text-muted-foreground">Institutional Terminal</span>
            </div>
          </Link>

          <div className="flex min-w-0 items-center gap-1.5 overflow-visible text-sm md:gap-3">
            <div className="flex shrink-0 items-center gap-1 text-sm font-medium">
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                  <span className="hidden text-green-500 sm:inline">{t.common.online}</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-red-500" />
                  <span className="hidden text-red-500 sm:inline">{t.common.offline}</span>
                </>
              )}
            </div>

            {user && <TicksBadge />}

            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="whitespace-nowrap">{navbarUnlimited ? plan.toUpperCase() : quotaText}</span>
              <span className="hidden whitespace-nowrap text-[var(--text-secondary)] md:inline">
                {navbarUnlimited ? `· ${t.nav.statusActive}` : t.nav.analysesWord}
              </span>
            </div>

            <LanguageSwitcher />

            {user && (
              <div className="shrink-0">
                <UserButton afterSignOutUrl="/" />
              </div>
            )}
          </div>
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
                onClick={() => setShowUpgradeModal(true)}
              >
                <Crown className="mr-2 h-4 w-4" />
                Fazer Upgrade para Pro
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside className="hidden w-[240px] min-w-0 shrink-0 flex-col overflow-y-auto border-r border-border p-3 md:flex">
            <div className={`${sidebarSectionTitleClass} px-2 pb-1 pt-2`}>{t.nav.workArea}</div>
            <nav className="flex flex-col gap-0.5">
              <button type="button" onClick={() => setActiveView('dashboard')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'dashboard' ? 'bg-white/[0.06] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
                <LayoutGrid className="h-4 w-4" /> {t.nav.dashboard}
              </button>
              <button type="button" onClick={resetNewAnalysisView} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'new-analysis' || activeView === 'analysis-result' || activeView === 'loading' || activeView === 'error' ? 'bg-white/[0.06] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
                <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
              </button>
              <button type="button" onClick={() => setActiveView('my-trades')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'my-trades' ? 'bg-white/[0.06] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
                <History className="h-4 w-4" /> {t.nav.myTrades}
              </button>
              <button type="button" onClick={() => setActiveView('watchlist')} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${activeView === 'watchlist' ? 'bg-white/[0.06] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}>
                <Star className="h-4 w-4" /> {t.nav.watchlist}
              </button>
            </nav>

            <div className={`${sidebarSectionTitleClass} px-2 pb-1 pt-5`}>{t.nav.account}</div>
            <nav className="flex flex-col gap-0.5">
              <Link to="/pricing" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]">
                <CreditCard className="h-4 w-4" /> {t.nav.plans}
              </Link>
              {user && plan === 'free' && (
                <button type="button" onClick={() => setShowUpgradeModal(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]">
                  <Crown className="h-4 w-4 text-[var(--accent-green)]" /> Fazer Upgrade para Pro
                </button>
              )}
            </nav>

            {user && plan === 'free' && (
              <div className="mt-4">
                <AnalysisCounter onUpgradeClick={() => setShowUpgradeModal(true)} />
              </div>
            )}
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto p-3 md:p-6">
            <div className="flex flex-col gap-6 md:gap-8">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>

      {/* Modal de Upgrade */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Escolha seu plano
            </DialogTitle>
            <DialogDescription>
              Ticks mensais renovados automaticamente. Sem surpresas.
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
                  <div className="text-sm font-bold">{plan.prices.monthly.brl}/mês</div>
                  <div className="text-xs text-muted-foreground">{plan.ticks}</div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="sm:flex-col gap-2">
            <Button className="w-full" onClick={goToPricing}>
              <Crown className="mr-2 h-4 w-4" />
              Ver planos e assinar
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setShowUpgradeModal(false)}>
              Continuar depois
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
