import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Bot } from "lucide-react";
import { useEffect, useState } from "react";

const LOADING_MESSAGES = [
  "Analisando tendências macro...",
  "Calculando indicadores técnicos...",
  "Identificando padrões de candlestick...",
  "Avaliando volume e volatilidade...",
  "Cruzando dados multi-timeframe...",
  "Compilando o relatório final..."
];

const AnalysisLoading = () => {
  const [progress, setProgress] = useState(10);
  const [currentMessage, setCurrentMessage] = useState(LOADING_MESSAGES[0]);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => (prev >= 95 ? 95 : prev + 5));
    }, 150);

    const messageTimer = setInterval(() => {
        setCurrentMessage(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    }, 500);

    return () => {
      clearInterval(timer);
      clearInterval(messageTimer);
    };
  }, []);

  return (
    <Card className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center text-center p-8">
      <CardContent className="flex flex-col items-center justify-center">
        <div className="relative w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary to-accent-purple rounded-full blur-xl opacity-70 animate-pulse"></div>
            <Bot className="relative w-full h-full text-primary" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">Analisando com a IA</h2>
        <p className="text-muted-foreground mb-6">Aguarde um momento, estamos processando os dados para você.</p>
        <Progress value={progress} className="w-full mb-4" />
        <p className="text-sm text-muted-foreground font-mono h-5">{currentMessage}</p>
      </CardContent>
    </Card>
  );
};

export default AnalysisLoading;
