import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUser } from "@clerk/clerk-react";
import { ArrowRight, Star, Target } from "lucide-react";
import { confidenceToPercent, normalizeRecommendationLabel, signalToneClass } from "@/lib/trading-ui";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useAnalyses } from "@/hooks/useAnalyses";
import { useAPIClient, type AIAnalysisResponse } from "@/lib/api";

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

  // Modo real: análises favoritadas (estrela em Meus Trades).
  // Mesmo limite do Dashboard/My Trades (40) → cache compartilhado: abre na hora.
  const { analyses, loading, refetch } = useAnalyses(40);
  const { setFavorite } = useAPIClient();
  const [removed, setRemoved] = useState<Record<string, boolean>>({});

  const favorites = analyses.filter(
    (a) =>
      a.status === 'completed' &&
      (a as unknown as Record<string, unknown>).isFavorite === true &&
      !removed[a.id],
  );

  const handleRemove = (a: AIAnalysisResponse) => {
    setRemoved((prev) => ({ ...prev, [a.id]: true }));
    void setFavorite(a.id, false)
      .then(() => refetch())
      .catch(() => {
        setRemoved((prev) => ({ ...prev, [a.id]: false }));
      });
  };

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
        // Modo REAL — análises favoritadas via estrela em Meus Trades
        <Card className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 tk-display text-lg">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              {w.favoritesTitle}
            </CardTitle>
            <CardDescription>{w.favHint}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t.trades.loadingAnalyses}</p>
            ) : favorites.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <p className="text-muted-foreground">{w.empty}</p>
                <p className="text-sm text-muted-foreground">{w.favHint}</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {favorites.map((a) => {
                  const rec = String(a.recommendation || '');
                  const confidence = confidenceToPercent(a.confidence);
                  const created = a.createdAt ? new Date(a.createdAt) : null;
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-terminal font-bold text-[var(--text-primary)]">
                          {String((a as unknown as Record<string, unknown>).symbol || 'N/A')}{' '}
                          <span className="font-normal text-xs text-muted-foreground">
                            {String((a as unknown as Record<string, unknown>).timeframe || '')}
                          </span>
                        </p>
                        <p className={`text-sm font-semibold ${signalToneClass(rec)}`}>
                          {normalizeRecommendationLabel(rec)}
                          {confidence > 0 ? ` (${confidence}%)` : ''}
                          {created ? (
                            <span className="ml-2 font-normal text-xs text-muted-foreground">
                              {created.toLocaleDateString()}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemove(a)}
                        title={t.trades.unfavorite}
                        aria-label={t.trades.unfavorite}
                        className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--bg-overlay)]"
                      >
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Watchlist;
