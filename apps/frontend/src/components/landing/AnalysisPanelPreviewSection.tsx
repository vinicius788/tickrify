import { SignInButton } from "@clerk/clerk-react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUp,
  Bot,
  History,
  PlusCircle,
  ShieldCheck,
  Star,
  UploadCloud,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const recentSignals = [
  { symbol: "ETH/USD", timeframe: "4H", bias: "BULLISH", recommendation: "BUY" },
  { symbol: "TSLA", timeframe: "1D", bias: "NEUTRAL", recommendation: "WAIT" },
  { symbol: "XAU/USD", timeframe: "1H", bias: "BEARISH", recommendation: "SELL" },
];

const activeMarkets = [
  { symbol: "BTC/USD", change: "+2.5%", positive: true },
  { symbol: "EUR/USD", change: "-0.1%", positive: false },
  { symbol: "AAPL", change: "+1.2%", positive: true },
];

const quickActions = [
  { icon: PlusCircle, label: "Nova Análise", active: true },
  { icon: History, label: "Meus Trades", active: false },
  { icon: Star, label: "Watchlist", active: false },
];

const signalBadgeClass = (recommendation: string) => {
  if (recommendation === "BUY") return "text-green-400 border-green-400/50 bg-green-400/10";
  if (recommendation === "SELL") return "text-red-400 border-red-400/50 bg-red-400/10";
  return "bg-neutral/20 text-neutral border-neutral/30";
};

const AnalysisPanelPreviewSection = () => {
  return (
    <section id="analysis-preview" className="py-20 md:py-28">
      <div className="container">
        <div className="grid items-start gap-10 lg:grid-cols-[0.95fr_1.25fr]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5 }}
          >
            <Badge className="mb-5 bg-primary/20 text-primary border-primary/30">
              Dentro da Plataforma
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Painel real focado em análise por imagem
            </h2>
            <p className="mt-4 text-muted-foreground md:text-lg">
              Este preview replica o fluxo atual da Tickrify: upload do print do gráfico, leitura da
              IA e entrega de bias, recomendação e níveis operacionais.
            </p>

            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border bg-card/50 p-4">
                <UploadCloud className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">1. Upload do gráfico</p>
                  <p className="text-sm text-muted-foreground">
                    O usuário arrasta ou clica para enviar PNG/JPG do gráfico.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border bg-card/50 p-4">
                <Bot className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">2. Processamento de IA</p>
                  <p className="text-sm text-muted-foreground">
                    A plataforma processa o chart e monta a análise técnica estruturada.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border bg-card/50 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">3. Decisão com risco visível</p>
                  <p className="text-sm text-muted-foreground">
                    Resultado com bias, recomendação (BUY/SELL/WAIT), entrada, stop e take profits.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to="/demo">
                  Ver painel completo <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <Button variant="outline" size="lg">
                  Testar com meu gráfico
                </Button>
              </SignInButton>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.65 }}
            className="rounded-2xl bg-gradient-to-br from-primary/30 via-accent-blue/10 to-transparent p-[1px] shadow-2xl shadow-primary/10 overflow-hidden"
          >
            <div className="rounded-2xl border bg-background/95 p-4 md:p-5 overflow-hidden">
              <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Preview fiel do dashboard</p>
                  <p className="font-semibold">Tickrify • Análise por imagem</p>
                </div>
                <Badge className="bg-primary/20 text-primary border-primary/30">PREVIEW</Badge>
              </div>

              <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
                <div className="hidden lg:flex flex-col gap-3">
                  <Card className="bg-card/60">
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="text-sm">Ações Rápidas</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 pt-0">
                      {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                          <Button
                            key={action.label}
                            size="sm"
                            variant={action.active ? "default" : "outline"}
                            className="justify-start"
                          >
                            <Icon className="h-4 w-4" />
                            {action.label}
                          </Button>
                        );
                      })}
                    </CardContent>
                  </Card>

                  <Card className="bg-card/60">
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="text-sm">Mercados Ativos</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 pt-0 text-sm">
                      {activeMarkets.map((market) => (
                        <div key={market.symbol} className="flex items-center justify-between">
                          <span>{market.symbol}</span>
                          <span className={market.positive ? "text-green-500" : "text-red-500"}>
                            {market.change}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="bg-card/60">
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="text-sm">Últimas Análises</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 p-3 pt-0">
                      {recentSignals.map((signal) => (
                        <div key={signal.symbol} className="text-xs">
                          <p className="font-medium">
                            {signal.symbol} <span className="text-muted-foreground">{signal.timeframe}</span>
                          </p>
                          <p className={signal.recommendation === "BUY" ? "text-green-500" : signal.recommendation === "SELL" ? "text-red-500" : "text-yellow-500"}>
                            {signal.bias} • {signal.recommendation}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-3">
                  <Card className="bg-card/60">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base">Nova Análise por Imagem</CardTitle>
                      <CardDescription>Upload de print do gráfico (PNG, JPG)</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="min-h-[150px] rounded-lg border-2 border-dashed border-border bg-background/60 flex flex-col items-center justify-center text-center p-4">
                        <UploadCloud className="h-10 w-10 text-muted-foreground" />
                        <p className="mt-3 font-medium">Arraste e solte o seu gráfico</p>
                        <p className="text-sm text-muted-foreground">ou clique para fazer upload</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-card/60">
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <CardTitle className="text-base">BTC/USD • 1H • Crypto</CardTitle>
                          <CardDescription>Análise em preview</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-blue-300 border-blue-400/40 bg-blue-500/10">
                            Bias: BULLISH
                          </Badge>
                          <Badge variant="outline" className={signalBadgeClass("BUY")}>
                            <ArrowUp className="mr-1 h-4 w-4" /> BUY (85%)
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                      <div className="min-w-0 aspect-video rounded-lg bg-muted/60 flex items-center justify-center text-sm text-muted-foreground">
                        Gráfico analisado com anotação da IA
                      </div>
                      <div className="min-w-0 rounded-lg border border-border/50 bg-background/50 p-3 font-mono text-xs space-y-2">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Entrada:</span>
                          <span>$42,150</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Stop:</span>
                          <span>$41,800</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">TP1:</span>
                          <span>$42,800</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">TP2:</span>
                          <span>$43,500</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Confluência:</span>
                          <span className="text-primary">8/10</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="rounded-lg border border-border/50 bg-background/50 p-3 text-sm text-muted-foreground">
                    Análise Técnica Detalhada: tendência primária de alta com retração curta e suporte
                    respeitado na região da EMA.
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default AnalysisPanelPreviewSection;
