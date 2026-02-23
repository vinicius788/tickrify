import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowUp, ArrowDown, Minus, ShieldAlert, AlertCircle, Target, DollarSign, CheckCircle2, ImageOff, Zap } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AIAnalysisResponse, Bias, Recommendation } from "@/lib/api";

interface AnalysisResultProps {
    analysisData: AIAnalysisResponse | null;
    uploadedImage: string | null;
}

const AnalysisResult = ({ analysisData, uploadedImage }: AnalysisResultProps) => {
    // Se não há dados de análise, mostrar modo demo
    if (!analysisData) {
        return (
            <div className="space-y-8">
                {/* Alerta de Demo */}
                <Alert className="border-primary/30 bg-primary/5">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    <AlertTitle>Análise de Demonstração</AlertTitle>
                    <AlertDescription>
                        Esta é uma análise simulada para fins de demonstração. 
                        Faça login para obter análises reais geradas por IA.
                    </AlertDescription>
                </Alert>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="text-2xl">
                                BTC/USD • 1H • Crypto
                                <span className="text-sm text-primary ml-2">(DEMO)</span>
                            </CardTitle>
                            <CardDescription>Análise de demonstração</CardDescription>
                        </div>
                        <Badge variant="outline" className="text-green-400 border-green-400/50 bg-green-400/10 text-lg py-1 px-4">
                            <ArrowUp className="mr-2 h-5 w-5" /> BULLISH • BUY (85%)
                        </Badge>
                    </CardHeader>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                        <Card>
                            <CardHeader>
                                <CardTitle>Gráfico Interativo</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="aspect-video w-full rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                                    {uploadedImage ? (
                                        <img src={uploadedImage} alt="Gráfico analisado" className="w-full h-full object-contain" />
                                    ) : (
                                        <p className="text-muted-foreground">Simulação de Gráfico TradingView</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Análise Técnica Detalhada</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4 text-sm text-muted-foreground">
                                <p>Faça login para ver análise técnica completa gerada por IA.</p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="lg:col-span-1 space-y-8">
                        <Card className="sticky top-24">
                            <CardHeader>
                                <CardTitle>Resumo Executivo</CardTitle>
                                <CardDescription>Risco/Recompensa: 1:3.2</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 font-mono text-sm pb-6">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <Target className="h-3.5 w-3.5" />
                                        Entrada
                                    </span>
                                    <span>$42,150</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <ShieldAlert className="h-3.5 w-3.5" />
                                        Stop
                                    </span>
                                    <span>$41,800 <span className="text-red-500">(-0.8%)</span></span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        TP1
                                    </span>
                                    <span>$42,800 <span className="text-green-500">(+1.5%)</span></span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        TP2
                                    </span>
                                    <span>$43,500 <span className="text-green-500">(+3.2%)</span></span>
                                </div>
                                <Separator />
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <Zap className="h-3.5 w-3.5" />
                                        Confluência
                                    </span>
                                    <span className="text-primary">8/10</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    // REAL MODE: Use real analysis data
    const analysis = analysisData.fullResponse?.analysis;
    const recommendation = (analysisData.recommendation || 'WAIT') as Recommendation;
    const bias = (analysisData.bias ||
        analysisData.fullResponse?.bias ||
        analysisData.fullResponse?.analysis?.marketStructure?.bias ||
        'neutral') as Bias;
    const confidence = analysisData.confidence || 0;
    const annotatedImageUrl =
        analysisData.annotated_image_url || analysisData.fullResponse?.annotated_image_url || null;
    const originalImageUrl =
        analysisData.original_image_url ||
        analysisData.fullResponse?.original_image_url ||
        analysisData.imageUrl ||
        uploadedImage;
    const displayImage = annotatedImageUrl || originalImageUrl || uploadedImage;

    // Format functions
    const formatPrice = (price: number | null | undefined) => {
        if (!price) return 'N/A';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
        }).format(price);
    };

    const formatPercent = (percent: number | null | undefined) => {
        if (percent === null || percent === undefined) return '';
        return `(${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Recommendation badge config
    const getBadgeConfig = () => {
        switch (recommendation) {
            case 'BUY':
                return {
                    label: 'BUY',
                    icon: ArrowUp,
                    className: 'text-green-400 border-green-400/50 bg-green-400/10',
                };
            case 'SELL':
                return {
                    label: 'SELL',
                    icon: ArrowDown,
                    className: 'text-red-400 border-red-400/50 bg-red-400/10',
                };
            case 'WAIT':
                return {
                    label: 'WAIT',
                    icon: Minus,
                    className: 'text-yellow-400 border-yellow-400/50 bg-yellow-400/10',
                };
            default:
                return {
                    label: 'WAIT',
                    icon: Minus,
                    className: 'text-yellow-400 border-yellow-400/50 bg-yellow-400/10',
                };
        }
    };

    const badgeConfig = getBadgeConfig();
    const BadgeIcon = badgeConfig.icon;

    return (
        <div className="space-y-8">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-2xl">
                            {analysis?.symbol || 'N/A'} • {analysis?.timeframe || 'N/A'}
                        </CardTitle>
                        <CardDescription>
                            Análise gerada em: {formatDate(analysisData.createdAt)}
                        </CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <Badge variant="outline" className="text-blue-300 border-blue-400/40 bg-blue-500/10 text-sm py-1 px-3">
                            Bias: {String(bias).toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className={`${badgeConfig.className} text-lg py-1 px-4`}>
                            <BadgeIcon className="mr-2 h-5 w-5" /> Recommendation: {badgeConfig.label} ({confidence}%)
                        </Badge>
                    </div>
                </CardHeader>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>Gráfico Analisado</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="aspect-video w-full rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                                {displayImage ? (
                                    <img 
                                        src={displayImage} 
                                        alt="Gráfico analisado" 
                                        className="w-full h-full object-contain" 
                                    />
                                ) : (
                                    <div className="text-center p-8">
                                        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                                            <ImageOff className="h-8 w-8 text-muted-foreground" />
                                        </div>
                                        <p className="text-muted-foreground font-medium mb-2">
                                            Imagem não disponível
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            Para economizar espaço, a imagem não é salva no histórico.
                                            <br />
                                            Apenas os resultados da análise são mantidos.
                                        </p>
                                    </div>
                                )}
                            </div>
                            {analysisData.drawing_failed && (
                                <p className="text-xs text-yellow-500 mt-3">
                                    Drawing failed: análise entregue sem anotação visual nesta tentativa.
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Análise Técnica Detalhada</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 text-sm leading-relaxed whitespace-pre-wrap">
                            {analysis?.technicalAnalysis || analysisData.reasoning || 'Análise não disponível'}
                        </CardContent>
                    </Card>

                    {analysis?.keyIndicators && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Indicadores-Chave</CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
                                {analysis.keyIndicators}
                            </CardContent>
                        </Card>
                    )}

                    {analysis?.identifiedPatterns && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Padrões Identificados</CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
                                {analysis.identifiedPatterns}
                            </CardContent>
                        </Card>
                    )}

                    {analysis?.riskFactors && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Fatores de Risco</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex items-start gap-3 text-sm leading-relaxed whitespace-pre-wrap">
                                    <ShieldAlert className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                                    <div>{analysis.riskFactors}</div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {analysis?.executiveSummary && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Resumo Executivo</CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
                                {analysis.executiveSummary}
                            </CardContent>
                        </Card>
                    )}
                </div>

                <div className="lg:col-span-1 space-y-8">
                    <Card className="sticky top-24">
                        <CardHeader>
                            <CardTitle>Níveis de Operação</CardTitle>
                            <CardDescription>
                                {analysis?.riskRewardRatio ? `Risco/Recompensa: ${analysis.riskRewardRatio}` : 'R:R não disponível'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 font-mono text-sm pb-6">
                            {analysis?.currentPrice && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <DollarSign className="h-3.5 w-3.5" />
                                        Preço Atual
                                    </span>
                                    <span className="font-semibold">{formatPrice(analysis.currentPrice)}</span>
                                </div>
                            )}
                            
                            {analysis?.entry && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <Target className="h-3.5 w-3.5" />
                                        Entrada
                                    </span>
                                    <span className="font-semibold">{formatPrice(analysis.entry)}</span>
                                </div>
                            )}

                            {analysis?.stopLoss && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <ShieldAlert className="h-3.5 w-3.5" />
                                        Stop
                                    </span>
                                    <span>
                                        {formatPrice(analysis.stopLoss)}{' '}
                                        <span className="text-red-500">{formatPercent(analysis.stopLossPercent)}</span>
                                    </span>
                                </div>
                            )}

                            {analysis?.takeProfit1 && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        TP1
                                    </span>
                                    <span>
                                        {formatPrice(analysis.takeProfit1)}{' '}
                                        <span className="text-green-500">{formatPercent(analysis.takeProfit1Percent)}</span>
                                    </span>
                                </div>
                            )}

                            {analysis?.takeProfit2 && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        TP2
                                    </span>
                                    <span>
                                        {formatPrice(analysis.takeProfit2)}{' '}
                                        <span className="text-green-500">{formatPercent(analysis.takeProfit2Percent)}</span>
                                    </span>
                                </div>
                            )}

                            <Separator />

                            {analysis?.confluenceScore !== undefined && (
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground inline-flex items-center gap-1.5">
                                        <Zap className="h-3.5 w-3.5" />
                                        Confluência
                                    </span>
                                    <span className="text-primary font-semibold">{analysis.confluenceScore}%</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default AnalysisResult;
