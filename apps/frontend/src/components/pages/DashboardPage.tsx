import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { History, Star, PlusCircle, Crown, Check, AlertCircle, FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";
import { UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NewAnalysis from "../dashboard/NewAnalysis";
import MyTrades from "../dashboard/MyTrades";
import Watchlist from "../dashboard/Watchlist";
import AnalysisResult from "../dashboard/AnalysisResult";
import AnalysisLoading from "../dashboard/AnalysisLoading";
import AnalysisCounter from "../dashboard/AnalysisCounter";
import { useAnalysisLimit, useIncrementAnalysis } from "@/hooks/useAnalysisLimit";
import { APIError, useAPIClient, type AIAnalysisResponse, type Bias, type Recommendation } from "@/lib/api";
import { createCheckoutSession, type BillingCycle } from "@/lib/stripe";
import { useToast } from "@/hooks/use-toast";

type View = 'new-analysis' | 'my-trades' | 'watchlist' | 'analysis-result' | 'loading' | 'error';
type RecentAnalysisItem = {
  symbol: string;
  timeframe: string;
  recommendation: Recommendation;
  bias: Bias;
  createdAt: string;
};
type ActiveMarketItem = {
  name: string;
  lastSeen: string;
};

const ENABLE_ANNUAL_BILLING = import.meta.env.VITE_ENABLE_ANNUAL_BILLING === "true";

const DashboardPage = () => {
  const [activeView, setActiveView] = useState<View>('new-analysis');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AIAnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const { plan } = useAnalysisLimit();
  const incrementAnalysis = useIncrementAnalysis();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const apiClient = useAPIClient();
  const isDemo = !user;

  // Dados de exemplo APENAS para modo DEMO
  const demoActiveMarkets = [
    { name: "BTC/USD", change: "+2.5%", isUp: true },
    { name: "EUR/USD", change: "-0.1%", isUp: false },
    { name: "AAPL", change: "+1.2%", isUp: true },
  ];

  const demoRecentAnalyses = [
    { symbol: "ETH/USD", timeframe: "4H", recommendation: "BUY", bias: "bullish" },
    { symbol: "TSLA", timeframe: "1D", recommendation: "WAIT", bias: "neutral" },
    { symbol: "XAU/USD", timeframe: "1H", recommendation: "SELL", bias: "bearish" },
  ];

  // Estados para dados REAIS da API
  const [recentAnalyses, setRecentAnalyses] = useState<RecentAnalysisItem[]>([]);
  const [realActiveMarkets, setRealActiveMarkets] = useState<ActiveMarketItem[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(false);

  const fetchRecentAnalyses = useCallback(async () => {
    try {
      setLoadingAnalyses(true);
      const analyses = await apiClient.listAnalyses(100);

      const now = Date.now();
      const activeWindowMs = 8 * 60 * 60 * 1000; // 8 horas
      const formatLastSeen = (dateIso: string) => {
        const diffMs = Math.max(0, now - new Date(dateIso).getTime());
        const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
        if (minutes < 60) return `${minutes} min atrás`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h atrás`;
      };

      // Pegar as 3 mais recentes
      const recent: RecentAnalysisItem[] = analyses.slice(0, 3).map((a) => ({
        symbol: a.symbol || ('Análise #' + a.id.slice(0, 8)),
        timeframe: a.timeframe || new Date(a.createdAt).toLocaleDateString('pt-BR'),
        recommendation: (a.recommendation || 'WAIT') as Recommendation,
        bias: (a.bias || 'neutral') as Bias,
        createdAt: a.createdAt,
      }));
      setRecentAnalyses(recent);

      // Mercados ativos = símbolos analisados nas últimas 8 horas
      const recentMarketAnalyses = analyses
        .filter((a) => {
          if (!a.symbol || !a.createdAt) return false;
          return now - new Date(a.createdAt).getTime() <= activeWindowMs;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const marketMap = new Map<string, ActiveMarketItem>();
      for (const analysis of recentMarketAnalyses) {
        const symbol = String(analysis.symbol).trim();
        if (!symbol) continue;
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

  // Usar dados demo ou reais dependendo do modo
  const activeMarkets = isDemo ? demoActiveMarkets : realActiveMarkets;
  const displayRecentAnalyses = isDemo ? demoRecentAnalyses : recentAnalyses;

  const signalColor = (recommendation: Recommendation) => {
    if (recommendation === 'BUY') return 'text-green-500';
    if (recommendation === 'SELL') return 'text-red-500';
    return 'text-yellow-500';
  };

  const startUpgradeCheckout = useCallback(async (billingCycle: BillingCycle = 'monthly') => {
    if (!user) {
      setShowUpgradeModal(false);
      return;
    }

    try {
      setIsStartingCheckout(true);
      const token = await getToken();

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

      // Poll para verificar status da análise
      let analysis = response;
      let pollCount = 0;
      const maxPolls = 60; // 60 * 2s = 120 segundos max

      while (analysis.status === 'pending' || analysis.status === 'processing') {
        if (pollCount >= maxPolls) {
          throw new Error('Tempo limite de análise excedido. Tente novamente.');
        }

        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 segundos
        analysis = await apiClient.getAnalysis(analysis.id);
        console.log('[Dashboard] Poll status:', analysis.status);
        pollCount++;
      }

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

      setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido ao processar análise');
      setActiveView('error');
    }
  };

  const handleRetry = () => {
    setActiveView('new-analysis');
    setErrorMessage('');
    setAnalysisData(null);
  };

  const renderContent = () => {
    switch (activeView) {
      case 'new-analysis':
        return <NewAnalysis onStartAnalysis={handleStartAnalysis} />;
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
              <Button variant="outline" onClick={() => setActiveView('new-analysis')}>
                Nova Análise
              </Button>
            </div>
          </div>
        );
      default:
        return <NewAnalysis onStartAnalysis={handleStartAnalysis} />;
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
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
      
      <header className="sticky top-0 flex h-16 items-center gap-4 border-b bg-background px-4 md:px-6 z-40">
        {/* Logo - se logado vai para dashboard, senão vai para home */}
        <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-2">
          <img src="/icon.png" alt="Tickrify" className="h-8 w-8" />
          <span className="sr-only">Tickrify</span>
        </Link>
        
        <div className="flex w-full items-center gap-4 ml-auto md:gap-2 lg:gap-4">
          <div className="ml-auto flex-1 sm:flex-initial">
            {/* Search can be added here later */}
          </div>
          {user && <UserButton afterSignOutUrl="/" />}
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        
        {/* Mobile Navigation */}
        <div className="md:hidden">
          <Tabs 
            value={activeView === 'new-analysis' || activeView === 'analysis-result' || activeView === 'loading' || activeView === 'error' ? 'new-analysis' : activeView} 
            onValueChange={(value) => {
              if (value === 'new-analysis') {
                // Resetar para nova análise quando clicar no tab
                setActiveView('new-analysis');
                setAnalysisData(null);
                setErrorMessage('');
                setUploadedImage(null);
              } else {
                setActiveView(value as View);
              }
            }} 
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="new-analysis">
                <PlusCircle className="mr-2 h-4 w-4" />
                Análise
              </TabsTrigger>
              <TabsTrigger value="my-trades">
                <History className="mr-2 h-4 w-4" />
                Trades
              </TabsTrigger>
              <TabsTrigger value="watchlist">
                <Star className="mr-2 h-4 w-4" />
                Watchlist
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {user && plan === 'free' && (
            <Button
              className="w-full mt-3"
              variant="outline"
              onClick={() => setShowUpgradeModal(true)}
            >
              <Crown className="mr-2 h-4 w-4" />
              Fazer Upgrade para Pro
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-[240px_1fr] lg:grid-cols-[280px_1fr]">
          <div className="hidden md:flex flex-col gap-6">
            {/* Contador de Análises */}
            {user && <AnalysisCounter onUpgradeClick={() => setShowUpgradeModal(true)} />}
            
            <Card>
              <CardHeader>
                <CardTitle>Ações Rápidas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button onClick={() => setActiveView('new-analysis')} variant={activeView.startsWith('analysis') || activeView === 'loading' || activeView === 'error' ? 'default' : 'outline'}><PlusCircle className="mr-2 h-4 w-4" /> Nova Análise</Button>
                <Button onClick={() => setActiveView('my-trades')} variant={activeView === 'my-trades' ? 'default' : 'outline'}><History className="mr-2 h-4 w-4" /> Meus Trades</Button>
                <Button onClick={() => setActiveView('watchlist')} variant={activeView === 'watchlist' ? 'default' : 'outline'}><Star className="mr-2 h-4 w-4" /> Watchlist</Button>
                {user && plan === 'free' && (
                  <Button onClick={() => setShowUpgradeModal(true)} variant="outline">
                    <Crown className="mr-2 h-4 w-4" />
                    Fazer Upgrade para Pro
                  </Button>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Mercados Ativos</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {isDemo ? (
                  demoActiveMarkets.map((market) => (
                    <div key={market.name} className="flex items-center justify-between">
                      <span className="font-medium">{market.name}</span>
                      <span className={market.isUp ? "text-green-500" : "text-red-500"}>{market.change}</span>
                    </div>
                  ))
                ) : activeMarkets.length > 0 ? (
                  (activeMarkets as ActiveMarketItem[]).map((market) => (
                    <div key={market.name} className="flex items-center justify-between">
                      <span className="font-medium">{market.name}</span>
                      <span className="text-muted-foreground text-xs">{market.lastSeen}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Sem mercados ativos nas últimas 8 horas.
                  </p>
                )}
              </CardContent>
            </Card>
            {!isDemo && (
              <Card>
                <CardHeader>
                  <CardTitle>Últimas Análises</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {loadingAnalyses ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
                  ) : displayRecentAnalyses.length > 0 ? (
                    displayRecentAnalyses.map((analysis, idx) => (
                      <div key={idx} className="flex items-center justify-between text-sm">
                        <span className="font-medium">{analysis.symbol} <span className="text-muted-foreground">{analysis.timeframe}</span></span>
                        <span className={`font-semibold ${signalColor(analysis.recommendation as Recommendation)}`}>
                          {String(analysis.bias || 'neutral').toUpperCase()} • {analysis.recommendation}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhuma análise ainda. Faça sua primeira!</p>
                  )}
                </CardContent>
              </Card>
            )}
            {isDemo && (
              <Card>
                <CardHeader>
                  <CardTitle>Últimas Análises</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {displayRecentAnalyses.map((analysis, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{analysis.symbol} <span className="text-muted-foreground">{analysis.timeframe}</span></span>
                      <span className={`font-semibold ${signalColor(analysis.recommendation as Recommendation)}`}>
                        {String(analysis.bias || 'neutral').toUpperCase()} • {analysis.recommendation}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-8">
            {renderContent()}
          </div>
        </div>
      </main>

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
