import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUser } from "@clerk/clerk-react";
import { ArrowRight, Target } from "lucide-react";

const Watchlist = () => {
  const { user } = useUser();
  const isDemo = !user;

  // Dados fake APENAS para modo demo
  const demoOpportunities = [
    { symbol: "BTC/USD", timeframe: "1H", confidence: "85%", recommendation: "BUY", bias: "BULLISH" },
    { symbol: "AAPL", timeframe: "4H", confidence: "65%", recommendation: "WAIT", bias: "NEUTRAL" },
  ];

  const demoOtherAssets = [
    { symbol: "EUR/USD", timeframe: "1H", status: "Sem setup claro" },
    { symbol: "ETH/USD", timeframe: "4H", status: "Aguardando confirmação" },
    { symbol: "TSLA", timeframe: "1D", status: "Em zona neutra" },
  ];

  // Quando logado, não mostra dados fake
  const opportunities = isDemo ? demoOpportunities : [];
  const otherAssets = isDemo ? demoOtherAssets : [];

  return (
    <div className="space-y-8">
      {isDemo ? (
        // Modo DEMO - mostra dados fake
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Oportunidades Detectadas
              </CardTitle>
              <CardDescription>Ativos com setup de maior probabilidade no momento.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {opportunities.map((op, index) => (
                <Card key={index} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-bold">{op.symbol} <span className="font-normal text-muted-foreground">{op.timeframe}</span></p>
                    <p className={`text-sm font-semibold ${op.recommendation === 'BUY' ? 'text-green-500' : op.recommendation === 'SELL' ? 'text-red-500' : 'text-yellow-500'}`}>
                      {op.bias} | {op.recommendation} ({op.confidence})
                    </p>
                  </div>
                  <Button variant="secondary">
                    Ver Análise
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Outros Ativos</CardTitle>
              <CardDescription>Monitorando outros ativos da sua lista.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {otherAssets.map((asset, index) => (
                  <li key={index} className="flex justify-between items-center text-sm">
                    <p><span className="font-medium">{asset.symbol}</span> <span className="text-muted-foreground">{asset.timeframe}</span></p>
                    <p className="text-muted-foreground">{asset.status}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : (
        // Modo REAL - watchlist vazia (feature futura)
        <Card>
          <CardHeader>
            <CardTitle>Watchlist</CardTitle>
            <CardDescription>Adicione ativos para monitorar e receber alertas.</CardDescription>
          </CardHeader>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">Sua watchlist está vazia</p>
              <p className="text-sm text-muted-foreground">Em breve você poderá adicionar ativos para monitorar!</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Watchlist;
