import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUser } from "@clerk/clerk-react";
import { ArrowRight, Target } from "lucide-react";
import { normalizeRecommendationLabel, signalToneClass } from "@/lib/trading-ui";
import { useLanguage } from "@/lib/i18n/LanguageContext";

// Dados fake APENAS para modo demo
const demoOpportunities = [
  { symbol: "BTC/USD", timeframe: "1H", confidence: "85%", recommendation: "COMPRA", bias: "BULLISH" },
  { symbol: "AAPL", timeframe: "4H", confidence: "65%", recommendation: "AGUARDAR", bias: "NEUTRAL" },
];

const Watchlist = () => {
  const { user } = useUser();
  const isDemo = !user;
  const { t } = useLanguage();
  const w = t.watchlist;

  const demoOtherAssets = [
    { symbol: "EUR/USD", timeframe: "1H", status: w.statusNoSetup },
    { symbol: "ETH/USD", timeframe: "4H", status: w.statusWaiting },
    { symbol: "TSLA", timeframe: "1D", status: w.statusNeutral },
  ];

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
                {w.opportunities}
              </CardTitle>
              <CardDescription>{w.opportunitiesDesc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {opportunities.map((op, index) => (
                <Card key={index} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-bold">{op.symbol} <span className="font-normal text-muted-foreground">{op.timeframe}</span></p>
                    <p className={`text-sm font-semibold ${signalToneClass(op.recommendation)}`}>
                      {op.bias} | {normalizeRecommendationLabel(op.recommendation)} ({op.confidence})
                    </p>
                  </div>
                  <Button variant="secondary">
                    {w.viewAnalysis}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{w.otherAssets}</CardTitle>
              <CardDescription>{w.otherAssetsDesc}</CardDescription>
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
            <CardTitle>{w.title}</CardTitle>
            <CardDescription>{w.realDesc}</CardDescription>
          </CardHeader>
          <CardContent className="py-12">
            <div className="text-center space-y-4">
              <p className="text-muted-foreground">{w.empty}</p>
              <p className="text-sm text-muted-foreground">{w.comingSoon}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Watchlist;
