import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useUser } from "@clerk/clerk-react";
import { useAPIClient, type AIAnalysisResponse } from "@/lib/api";
import { useState, useEffect, useCallback } from "react";

type TradeRow = {
  id: string;
  date: string;
  symbol: string;
  type: string;
  bias: string;
  result: string;
};

const MyTrades = () => {
  const { user } = useUser();
  const apiClient = useAPIClient();
  const isDemo = !user;
  
  const [analyses, setAnalyses] = useState<AIAnalysisResponse[]>([]);
  const [loading, setLoading] = useState(false);

  // Dados fake APENAS para modo demo
  const demoTrades = [
    { date: "01/11/25", symbol: "BTC/USD", type: "BUY", bias: "BULLISH", result: "+3.2%", status: "WIN" },
    { date: "31/10/25", symbol: "EUR/USD", type: "SELL", bias: "BEARISH", result: "-0.9%", status: "LOSS" },
    { date: "30/10/25", symbol: "AAPL", type: "WAIT", bias: "NEUTRAL", result: "+5.1%", status: "WIN" },
  ];

  const fetchAnalyses = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.listAnalyses();
      setAnalyses(data);
    } catch (error) {
      console.error('Erro ao buscar análises:', error);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  // Buscar análises REAIS quando logado
  useEffect(() => {
    if (!isDemo && user) {
      void fetchAnalyses();
    }
  }, [fetchAnalyses, isDemo, user]);

  const trades: TradeRow[] = isDemo
    ? demoTrades.map((trade) => ({
        id: `${trade.date}-${trade.symbol}-${trade.type}`,
        date: trade.date,
        symbol: trade.symbol,
        type: trade.type,
        bias: trade.bias,
        result: trade.result,
      }))
    : analyses.map((analysis) => ({
        id: analysis.id,
        date: new Date(analysis.createdAt).toLocaleDateString('pt-BR'),
        symbol: analysis.symbol || ('Análise #' + analysis.id.slice(0, 8)),
        type: analysis.recommendation || 'WAIT',
        bias: String(analysis.bias || 'neutral').toUpperCase(),
        result: analysis.confidence ? `${analysis.confidence}% confiança` : '-',
      }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meus Trades</CardTitle>
        <CardDescription>Histórico de todas as suas operações.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-center py-8 text-muted-foreground">Carregando análises...</p>
        ) : trades.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Análise</TableHead>
                <TableHead>Recomendação</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell>{trade.date}</TableCell>
                  <TableCell className="font-medium">{trade.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      trade.type === 'BUY'
                        ? 'text-green-400 border-green-400/50' 
                        : trade.type === 'SELL'
                        ? 'text-red-400 border-red-400/50'
                        : 'text-yellow-400 border-yellow-400/50'
                    }>
                      {trade.bias} • {trade.type}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right font-mono ${trade.type === 'BUY' ? 'text-green-500' : trade.type === 'SELL' ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {trade.result}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-center py-8 text-muted-foreground">
            {isDemo ? "Dados de demonstração" : "Nenhuma análise ainda. Comece fazendo sua primeira análise!"}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default MyTrades;
