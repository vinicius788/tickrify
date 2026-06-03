export default {
  // ── Common ──────────────────────────────────────────────────────────────────
  common: {
    loading: 'Carregando...',
    error: 'Erro',
    retry: 'Tentar novamente',
    save: 'Salvar',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    close: 'Fechar',
    back: 'Voltar',
    next: 'Próximo',
    yes: 'Sim',
    no: 'Não',
    or: 'ou',
    and: 'e',
    of: 'de',
    na: 'N/A',
    online: 'Online',
    offline: 'Offline',
  },

  // ── Navigation ───────────────────────────────────────────────────────────────
  nav: {
    newAnalysis: 'Nova Análise',
    myTrades: 'Meus Trades',
    watchlist: 'Watchlist',
    activeMarkets: 'Mercados Ativos',
    recentAnalyses: 'Últimas Análises',
    symbol: 'Símbolo',
    signal: 'Signal',
    conf: 'Conf.',
    time: 'Tempo',
    ago: 'atrás',
  },

  // ── Plan ─────────────────────────────────────────────────────────────────────
  plan: {
    elite: 'Plano Elite',
    ticksAvailable: 'ticks disponíveis',
    renewsMonthly: 'Renova mensalmente',
  },

  // ── Analysis Upload ───────────────────────────────────────────────────────────
  upload: {
    title: 'Análise de Gráfico',
    dropzone: 'Arraste o print do gráfico aqui ou clique para selecionar',
    dropzoneActive: 'Solte a imagem aqui',
    formats: 'PNG, JPG ou WEBP',
    button: 'Analisar Gráfico',
    analyzing: 'Analisando...',
    selectImage: 'Selecione uma imagem para analisar',
    deepAnalysis: 'Análise Profunda',
    deepAnalysisDesc: 'Análise mais detalhada, usa 2 ticks',
  },

  // ── Analysis Result ───────────────────────────────────────────────────────────
  analysis: {
    chartAnalyzed: 'Gráfico analisado',
    bias: 'Bias',
    confidence: 'Confiança',
    levels: 'Níveis de Operação',
    rr: 'R/R',
    confluence: 'Confluência',
    currentPrice: 'Preço Atual',
    entry: 'Entrada',
    stopLoss: 'Stop Loss',
    tp1: 'TP1',
    tp2: 'TP2',
    entryType: 'Tipo de Entrada',
    invalidation: 'Invalidação',
    technicalPanel: 'Painel técnico',
    economicEvents: 'Eventos Econômicos',
    noHighImpactEvents: 'Nenhum evento de alto impacto nas próximas 24h para este ativo.',
    marketSessions: 'Sessões de Mercado',
    sessionNote: 'Horário da análise (UTC) · London+NY abertas = maior liquidez',
    marketStructure: 'Estrutura de Mercado',
    trendStrength: 'Força da tendência',
    mtfAlignment: 'Alinhamento MTF',
    technicalAnalysis: 'Análise Técnica',
    identifiedPatterns: 'Padrões Identificados',
    keyIndicators: 'Indicadores-Chave',
    riskFactors: 'Fatores de Risco',
    partialExit: 'Plano de Saída Parcial',
    planB: 'Plano B — Cenário Alternativo',
    whyNotOpposite: 'Por que não o oposto',
    executiveSummary: 'Resumo Executivo',
    structureValidation: 'Validação Estrutural',
    strongTrend: 'Forte ↑',
    weakTrend: 'Fraca ↓',
    moderateTrend: 'Moderada →',
    buy: 'COMPRA',
    sell: 'VENDA',
    hold: 'AGUARDAR',
    bullish: 'BULLISH',
    bearish: 'BEARISH',
    neutral: 'NEUTRO',
    highConfidence: 'Alta',
    medConfidence: 'Média',
    lowConfidence: 'Baixa',
    demoNotice: '⚠️ ANÁLISE DEMONSTRATIVA',
    invalidAnalysis: 'Esta análise não está mais disponível.',
    processingAnalysis: 'Processando análise...',
    analysisReady: 'Análise pronta',
    noPatterns: 'Nenhum padrão específico identificado.',
    sessions: {
      sydney: 'Sydney',
      tokyo: 'Tóquio',
      london: 'Londres',
      newYork: 'Nova York',
    },
  },

  // ── Trades ────────────────────────────────────────────────────────────────────
  trades: {
    title: 'Meus Trades',
    noTrades: 'Nenhum trade registrado ainda.',
    noTradesDesc: 'Seus trades aparecerão aqui quando você os registrar.',
  },

  // ── Watchlist ──────────────────────────────────────────────────────────────────
  watchlist: {
    title: 'Watchlist',
    empty: 'Sua watchlist está vazia.',
    emptyDesc: 'Adicione ativos para acompanhar.',
  },

  // ── Errors ────────────────────────────────────────────────────────────────────
  errors: {
    notChart: 'A imagem enviada não parece ser um gráfico financeiro.',
    analysisError: 'Erro ao processar análise. Tente novamente.',
    noTicks: 'Ticks insuficientes. Adquira um plano para continuar.',
    uploadError: 'Erro ao enviar imagem.',
  },

  // ── Language ──────────────────────────────────────────────────────────────────
  language: {
    select: 'Idioma',
    pt: 'Português',
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    ja: '日本語',
  },
} as const;
