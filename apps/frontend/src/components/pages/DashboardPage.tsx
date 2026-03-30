import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { History, Star, PlusCircle, Crown, Check, AlertCircle, FlaskConical, Clock, Wifi, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NewAnalysis from "../dashboard/NewAnalysis";
import MyTrades from "../dashboard/MyTrades";
import Watchlist from "../dashboard/Watchlist";
import AnalysisResult from "../dashboard/AnalysisResult";
import AnalysisLoading from "../dashboard/AnalysisLoading";
import AnalysisCounter from "../dashboard/AnalysisCounter";
import { TicksBadge } from "@/components/TicksBadge";
import { BuyTicksModal } from "@/components/BuyTicksModal";
import { useAnalysisLimit, useIncrementAnalysis } from "@/hooks/useAnalysisLimit";
import { APIError, useAPIClient, type AIAnalysisResponse, type Bias, type Recommendation } from "@/lib/api";
import { createCheckoutSession, type BillingCycle } from "@/lib/stripe";
import { useToast } from "@/hooks/use-toast";
import { normalizeRecommendationLabel, signalToneClass } from "@/lib/trading-ui";
import { useTicks } from "@/hooks/useTicks";
import officialIcon from "@/assets/tickrify-icon-official.png";

type View = 'new-analysis' | 'my-trades' | 'watchlist' | 'analysis-result' | 'loading' | 'error';
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

const ENABLE_ANNUAL_BILLING = import.meta.env.VITE_ENABLE_ANNUAL_BILLING === "true";
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const DashboardPage = () => {
  const [activeView, setActiveView] = useState<View>('new-analysis');
  const [analysisKey, setAnalysisKey] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AIAnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showBuyTicksModal, setShowBuyTicksModal] = useState(false);
  const [buyTicksModalReason, setBuyTicksModalReason] = useState<'insufficient' | 'topup'>('topup');
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const { plan, total, used, isUnlimited } = useAnalysisLimit();
  const incrementAnalysis = useIncrementAnalysis();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { refetch: refetchTicks } = useTicks();
  const apiClient = useAPIClient();
  const isDemo = !user;
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

  // Estados para dados REAIS da API
  const [recentAnalyses, setRecentAnalyses] = useState<RecentAnalysisItem[]>([]);
  const [realActiveMarkets, setRealActiveMarkets] = useState<ActiveMarketItem[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);

  const fetchRecentAnalyses = useCallback(async () => {
    try {
      setLoadingAnalyses(true);
      const analyses = await apiClient.listAnalyses(40);

      const now = Date.now();
      const activeWindowMs = 8 * 60 * 60 * 1000; // 8 horas
      const formatLastSeen = (dateIso: string) => {
        const diffMs = Math.max(0, now - new Date(dateIso).getTime());
        const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
        if (minutes < 60) return `${minutes} min atrás`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h atrás`;
      };

      const completedRecent: RecentAnalysisItem[] = analyses
        .filter((a) => a.status === 'completed')
        .map((a) => ({
        symbol: String(a.symbol || '').trim() || 'N/A',
        timeframe: String(a.timeframe || '').trim() || 'N/A',
        recommendation: normalizeRecommendationLabel(a.recommendation) as Recommendation,
        bias: (a.bias || 'neutral') as Bias,
        confidence:
          Number(a.confidence) >= 0 && Number(a.confidence) <= 1
            ? Number(a.confidence) * 100
            : Number(a.confidence) || 0,
        createdAt: a.createdAt,
      }));
      const withIdentity = completedRecent.filter(
        (item) => item.symbol !== 'N/A' && item.timeframe !== 'N/A',
      );
      const recent = (withIdentity.length > 0 ? withIdentity : completedRecent).slice(0, 3);
      setRecentAnalyses(recent);

      // Mercados ativos = símbolos analisados nas últimas 8 horas
      const recentMarketAnalyses = analyses
        .filter((a) => {
          if (!a.createdAt) return false;
          return now - new Date(a.createdAt).getTime() <= activeWindowMs;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const marketMap = new Map<string, ActiveMarketItem>();
      for (const analysis of recentMarketAnalyses) {
        const symbol = String(analysis.symbol || '').trim();
        if (!symbol || symbol === 'N/A') continue;
        if (!marketMap.has(symbol)) {
          const timeframe = analysis.timeframe ? ` • ${analysis.timeframe}` : '';
          marketMap.set(symbol, {
            name: `${symbol}${timeframe}`,
            lastSeen: formatLastSeen(analysis.createdAt),
          });
        }
      }

      setRealActiveMarkets(Array.from(marketMap.values()).slice(0, 6));
    } catch (error) {
      console.error('Erro ao buscar análises:', error);
    } finally {
      setLoadingAnalyses(false);
    }
  }, [apiClient]);

  // Buscar análises reais quando logado
  useEffect(() => {
    if (!isDemo && user) {
      void fetchRecentAnalyses();
    }
  }, [fetchRecentAnalyses, isDemo, user]);

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

    if (ticksState === 'success') {
      const amount = params.get('amount');
      refetchTicks();
      toast({
        title: 'Ticks adicionados',
        description: amount
          ? `+${amount} Ticks adicionados à sua conta!`
          : 'Ticks adicionados à sua conta!',
      });
      window.history.replaceState({}, '', '/dashboard');
      return;
    }

    if (ticksState === 'cancelled') {
      toast({
        title: 'Compra cancelada',
        description: 'Você pode tentar novamente quando quiser.',
      });
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [refetchTicks, toast]);

  // Usar dados demo ou reais dependendo do modo
  const activeMarkets = isDemo ? demoActiveMarkets : realActiveMarkets;
  const displayRecentAnalyses = isDemo ? demoRecentAnalyses : recentAnalyses;

  const signalColor = (recommendation: Recommendation) => {
    return signalToneClass(recommendation);
  };

  const startUpgradeCheckout = useCallback(async (billingCycle: BillingCycle = 'monthly') => {
    if (!user) {
      setShowUpgradeModal(false);
      return;
    }

    try {
      setIsStartingCheckout(true);
      const token = await getToken({ skipCache: true });

      if (!token) {
        throw new Error('Não foi possível obter token de autenticação');
      }

      const { url } = await createCheckoutSession('pro', token, billingCycle);
      window.location.href = url;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Falha ao iniciar checkout. Tente novamente.';

      toast({
        title: 'Erro ao iniciar pagamento',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsStartingCheckout(false);
    }
  }, [getToken, toast, user]);

  const resetNewAnalysisView = useCallback(() => {
    setActiveView('new-analysis');
    setAnalysisKey((key) => key + 1);
    setAnalysisData(null);
    setErrorMessage('');
    setUploadedImage(null);
  }, []);

  const handleStartAnalysis = async (imageUrl: string | null = null, imageFile: File | null = null) => {
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

      // Chamar API real
      console.log('[Dashboard] Iniciando análise...', { hasImageUrl: !!imageUrl, hasImageFile: !!imageFile });
      
      const response = await apiClient.createAnalysis({
        imageFile: imageFile || undefined,
        base64Image: imageUrl || undefined,
      });

      console.log('[Dashboard] Análise criada:', response);

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
        void fetchRecentAnalyses();
      }
    } catch (error) {
      console.error('[Dashboard] Erro ao criar análise:', error);
      if (error instanceof APIError) {
        let parsedBody: Record<string, unknown> | null = null;
        try {
          parsedBody = JSON.parse(error.message) as Record<string, unknown>;
        } catch {
          parsedBody = null;
        }

        const apiCode = error.code || String(parsedBody?.code || '');
        if (apiCode === 'INSUFFICIENT_TICKS') {
          setBuyTicksModalReason('insufficient');
          setShowBuyTicksModal(true);
          resetNewAnalysisView();
          return;
        }

        if (
          error.status === 402 ||
          error.status === 403 ||
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

  const renderContent = () => {
    switch (activeView) {
      case 'new-analysis':
        return <NewAnalysis key={analysisKey} onStartAnalysis={handleStartAnalysis} />;
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
        return <NewAnalysis key={analysisKey} onStartAnalysis={handleStartAnalysis} />;
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
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden bg-background">
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
      
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
          <Link to={user ? "/dashboard" : "/"} className="flex min-w-0 shrink-0 items-center gap-2">
            <img src={officialIcon} alt="Tickrify" className="h-8 w-auto shrink-0 object-contain" />
            <div className="hidden flex-col leading-none md:flex">
              <span className="text-sm font-bold tracking-wide">TICKRIFY</span>
              <span className="text-xs text-muted-foreground">Institutional Terminal</span>
            </div>
          </Link>

          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm md:gap-3">
            <div className="flex shrink-0 items-center gap-1 text-sm font-medium">
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                  <span className="hidden text-green-500 sm:inline">Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-red-500" />
                  <span className="hidden text-red-500 sm:inline">Offline</span>
                </>
              )}
            </div>

            {user && (
              <TicksBadge
                onClick={() => {
                  setBuyTicksModalReason('topup');
                  setShowBuyTicksModal(true);
                }}
              />
            )}

            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="whitespace-nowrap">{navbarUnlimited ? 'PRO' : quotaText}</span>
              <span className="hidden whitespace-nowrap text-[var(--text-secondary)] md:inline">
                {navbarUnlimited ? '· Ilimitado' : 'análises'}
              </span>
            </div>

            {user && (
              <div className="shrink-0">
                <UserButton afterSignOutUrl="/" />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border md:hidden">
          <div className="flex">
            {(['new-analysis', 'my-trades', 'watchlist'] as const).map((view) => (
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
                {view === 'new-analysis' ? '⊕ Análise' : view === 'my-trades' ? '↺ Trades' : '☆ Watchlist'}
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
          <aside className="hidden w-[280px] min-w-0 flex-col gap-4 overflow-y-auto border-r border-border p-4 md:flex xl:w-[320px]">
            {user && <AnalysisCounter onUpgradeClick={() => setShowUpgradeModal(true)} />}

            <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
              <CardHeader className="px-4 pb-2 pt-4">
                <CardTitle className={sidebarSectionTitleClass}>Ações rápidas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 p-4 pt-0">
                <Button onClick={resetNewAnalysisView} variant={activeView.startsWith('analysis') || activeView === 'loading' || activeView === 'error' ? 'default' : 'outline'} className="justify-start"><PlusCircle className="mr-2 h-4 w-4" /> Nova Análise</Button>
                <Button onClick={() => setActiveView('my-trades')} variant={activeView === 'my-trades' ? 'default' : 'outline'} className="justify-start"><History className="mr-2 h-4 w-4" /> Meus Trades</Button>
                <Button onClick={() => setActiveView('watchlist')} variant={activeView === 'watchlist' ? 'default' : 'outline'} className="justify-start"><Star className="mr-2 h-4 w-4" /> Watchlist</Button>
                {user && plan === 'free' && (
                  <Button onClick={() => setShowUpgradeModal(true)} variant="outline" className="justify-start">
                    <Crown className="mr-2 h-4 w-4" />
                    Fazer Upgrade para Pro
                  </Button>
                )}
              </CardContent>
            </Card>
            <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
              <CardHeader className="px-4 pb-2 pt-4">
                <CardTitle className={sidebarSectionTitleClass}>Mercados ativos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0 text-xs">
                {isDemo ? (
                  demoActiveMarkets.map((market) => (
                    <div key={market.name} className="grid grid-cols-[1fr_auto] items-center rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
                      <span className="font-terminal font-medium">{market.name}</span>
                      <span className={market.isUp ? "text-green-500" : "text-red-500"}>{market.change}</span>
                    </div>
                  ))
                ) : activeMarkets.length > 0 ? (
                  (activeMarkets as ActiveMarketItem[]).map((market) => (
                    <div key={market.name} className="grid grid-cols-[1fr_auto] items-center rounded-sm border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
                      <span className="font-terminal font-medium text-[var(--text-primary)]">{market.name}</span>
                      <span className="font-terminal text-[var(--text-secondary)]">{market.lastSeen}</span>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    Sem mercados ativos nas últimas 8 horas.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="surface-terminal-elevated border border-[var(--border-subtle)]">
              <CardHeader className="px-4 pb-2 pt-4">
                <CardTitle className={sidebarSectionTitleClass}>Últimas análises</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {loadingAnalyses ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Carregando...</p>
                ) : displayRecentAnalyses.length > 0 ? (
                  <div className="overflow-hidden rounded-sm border border-[var(--border-subtle)]">
                    <div className="grid grid-cols-[1fr_58px_52px_62px] bg-[var(--bg-overlay)] px-2 py-1.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
                      <span>Símbolo</span>
                      <span>Signal</span>
                      <span>Conf.</span>
                      <span>Tempo</span>
                    </div>
                    {displayRecentAnalyses.map((analysis, idx) => {
                      const recLabel = normalizeRecommendationLabel(analysis.recommendation);
                      const minutesAgo = Math.max(
                        1,
                        Math.floor((Date.now() - new Date(analysis.createdAt).getTime()) / (1000 * 60)),
                      );
                      return (
                        <div
                          key={idx}
                          className="grid grid-cols-[1fr_58px_52px_62px] items-center border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-2 text-[11px]"
                        >
                          <span className="truncate font-terminal text-[var(--text-primary)]">
                            {analysis.symbol} <span className="font-terminal text-[var(--text-secondary)]">{analysis.timeframe}</span>
                          </span>
                          <span className={`font-semibold ${signalColor(recLabel as Recommendation)}`}>{recLabel}</span>
                          <span className="font-terminal text-[var(--text-secondary)]">{Math.round(Number(analysis.confidence) || 0)}%</span>
                          <span className="font-terminal text-[var(--text-secondary)]">{minutesAgo}m</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma análise ainda. Faça sua primeira!</p>
                )}
              </CardContent>
            </Card>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto p-3 md:p-6">
            <div className="flex flex-col gap-6 md:gap-8">
              {renderContent()}
            </div>
          </main>
        </div>
      </div>

      <BuyTicksModal
        open={showBuyTicksModal}
        onClose={() => setShowBuyTicksModal(false)}
        reason={buyTicksModalReason}
      />

      {/* Modal de Upgrade */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Assine o Plano Pro
            </DialogTitle>
            <DialogDescription>
              {ENABLE_ANNUAL_BILLING
                ? 'Libere análises ilimitadas com IA e escolha entre cobrança mensal ou anual.'
                : 'Libere análises ilimitadas com IA com cobrança mensal.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-lg">Plano Pro</h3>
                <div className="text-right">
                  <span className="text-3xl font-bold">R$80</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
              </div>
              {ENABLE_ANNUAL_BILLING && (
                <p className="text-xs text-muted-foreground mb-3">Ou R$960 no ciclo anual.</p>
              )}
              <ul className="space-y-2">
                <li className="flex items-center text-sm">
                  <Check className="h-4 w-4 text-primary mr-2 flex-shrink-0" />
                  <span>Análises ilimitadas</span>
                </li>
                <li className="flex items-center text-sm">
                  <Check className="h-4 w-4 text-primary mr-2 flex-shrink-0" />
                  <span>Todos os timeframes</span>
                </li>
                <li className="flex items-center text-sm">
                  <Check className="h-4 w-4 text-primary mr-2 flex-shrink-0" />
                  <span>Alertas avançados</span>
                </li>
                <li className="flex items-center text-sm">
                  <Check className="h-4 w-4 text-primary mr-2 flex-shrink-0" />
                  <span>Suporte prioritário</span>
                </li>
              </ul>
            </div>
          </div>

          <DialogFooter className="sm:flex-col gap-2">
            <Button
              className="w-full"
              onClick={() => void startUpgradeCheckout('monthly')}
              disabled={isStartingCheckout}
            >
              {isStartingCheckout ? (
                'Redirecionando para pagamento...'
              ) : (
                <>
                <Crown className="mr-2 h-4 w-4" />
                Fazer Upgrade Agora
                </>
              )}
            </Button>
            <Button variant="outline" className="w-full" asChild onClick={() => setShowUpgradeModal(false)}>
              <Link to="/pricing">
                {ENABLE_ANNUAL_BILLING ? 'Ver plano mensal e anual' : 'Ver detalhes do plano'}
              </Link>
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setShowUpgradeModal(false)}>
              <Crown className="mr-2 h-4 w-4" />
              Continuar depois
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
