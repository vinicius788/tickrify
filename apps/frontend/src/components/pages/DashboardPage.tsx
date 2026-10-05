import { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { History, CalendarDays, PlusCircle, Crown, AlertCircle, FlaskConical, LayoutGrid, CreditCard, BarChart3, Target, Activity, Zap, Upload, Sliders, Handshake } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NewAnalysis from "../dashboard/NewAnalysis";
import EmptyState from '@/components/dashboard/EmptyState';
import AcquisitionSurvey from '@/components/dashboard/AcquisitionSurvey';
import FeedbackCard from '@/components/dashboard/FeedbackCard';
import {
  VERDICT_MAX_ROWS,
  VERDICT_MIN_AGE_MS,
  isVerdictPromptSnoozed,
  outcomeFromVerdict,
  isTradeCall,
  resolveVerdict,
  withoutPending,
  snoozeVerdictPrompt,
  type Verdict,
} from '@/lib/verdict';
import ActivityHeatmap from "../dashboard/ActivityHeatmap";
import LiveTape from "../dashboard/LiveTape";
import MyTrades from "../dashboard/MyTrades";
import JournalCalendar from "../dashboard/JournalCalendar";
import StrategyProfile from "../dashboard/StrategyProfile";
import AnalysisResult from "../dashboard/AnalysisResult";
import Paywall, { type PaywallSurface } from "../dashboard/Paywall";
import AnalysisLoading from "../dashboard/AnalysisLoading";
import AnalysisCounter from "../dashboard/AnalysisCounter";
import { TicksBadge } from "@/components/dashboard/TicksBadge";
import { useAnalysisLimit, useIncrementAnalysis } from "@/hooks/useAnalysisLimit";
import { APIError, isFreeQuotaExhausted, useAPIClient, type AIAnalysisResponse, type Bias, type Recommendation } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { AnalysisProcessingError, analysisFailureTelemetry } from "@/lib/analysis-failure";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { asRecord, isPageTranslated, scrollToTop } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { getRecommendationMeta, getScenarioMeta, normalizeRecommendationLabel } from "@/lib/trading-ui";
import { useAnalyses } from "@/hooks/useAnalyses";
import { useTicks } from "@/hooks/useTicks";
import { track, trackAdConversion } from "@/lib/analytics";
import { CheckoutError, createCheckoutSession, getCheckoutStatus } from "@/lib/stripe";
import { checkoutReturnPath, loadCheckoutIntent } from "@/lib/checkoutIntent";
import { useFoundingOffer } from "@/hooks/useFoundingOffer";
import UpgradeVideo from "../dashboard/UpgradeVideo";
import { SampleAnalysisView, SamplePicker } from "../dashboard/SampleAnalyses";
import { SAMPLE_ANALYSES, type SampleKind } from "@/lib/sample-analyses";
import { PricingCards } from "@/components/pricing/PricingCards";
import { useSeo } from "@/hooks/useSeo";
import { loadSavedDemoResult } from "@/lib/demo-api";

// Textos do dashboard que estavam hardcoded em PT — agora EN por padrão (público global),
// PT quando o idioma for português. Contido neste arquivo (sem mexer nos 6 locales).
const DASH_COPY = {
  en: {
    planActivatedTitle: 'Plan activated!',
    checkoutErrorTitle: 'Could not open checkout',
    allowanceNoticeTitle: 'Your Ticks now reset every month',
    allowanceNoticeDesc: 'At the start of each billing month your balance goes back to 200 Ticks. Unused Ticks do not carry over.',
    alreadySubscribedTitle: 'You are already subscribed',
    planActivatedDesc: 'Welcome to Tickrify. Your ticks are now available.',
    uploadRequired: 'Please upload a chart image.',
    invalidFormat: 'Invalid format. Upload a PNG, JPG/JPEG or WEBP image.',
    tooLarge: 'File too large. The limit is 10MB.',
    ticksOutTitle: 'Ticks used up',
    ticksOutDesc: 'Your plan ticks are used up. They renew automatically next cycle.',
    weeklyInsight: 'This week',
    analysisError: 'Analysis error',
    tryAgain: 'Try again',
    loadingPlanTitle: 'Loading your plan…',
    loadingPlanDesc: 'Confirming your subscription. This takes a couple of seconds, try again in a moment.',
    analysisTimeout: 'The analysis took longer than expected. Please try again.',
    analysisUnknownError: 'Unexpected error while processing the analysis.',
    analysisFailed: 'The analysis could not be completed.',
    networkError: 'Could not reach Tickrify. Check your internet connection and try again.',
    authTokenFailed: 'We could not confirm your session. Reload the page and try again. If it keeps happening, sign out and sign in again.',
    subscribeCta: 'Subscribe',
    demoMode: 'Demo mode: exploring the interface without login',
    demoLogin: 'Log in for real analyses',
    choosePlan: 'Choose your plan',
    planSub: 'Start with one week or go monthly. Cancel anytime.',
    later: 'Maybe later',
    perMonth: '/mo',
    modalMonthly: 'Monthly, 200 analyses',
    modalMonthlyOffer: '{price} first month, then $29/month',
    modalWeekly: 'One week, 25 analyses',
    modalCompare: 'Compare all plans',
    modalVideoCaption: 'What subscribers get: the entry chart plus up to two higher timeframes, read as one market. 20 seconds.',
    waitNudge: 'This WAIT did not use a trade call. You still have {left} of {limit}.',
    waitNudgeHint: 'Try another pair or a different timeframe.',
    waitNudgeCta: 'Analyze another chart',
    waitNudgeWhy: 'Why WAIT? (22 s video)',
    plansTitle: 'Plans',
    plansSub: 'Same engine on every plan. Cancel anytime.',
  },
  pt: {
    planActivatedTitle: 'Plano ativado!',
    checkoutErrorTitle: 'Não foi possível abrir o checkout',
    allowanceNoticeTitle: 'Seus Ticks agora renovam todo mês',
    allowanceNoticeDesc: 'No início de cada mês de cobrança seu saldo volta para 200 Ticks. Ticks não usados não acumulam.',
    alreadySubscribedTitle: 'Você já é assinante',
    planActivatedDesc: 'Bem-vindo ao Tickrify. Seus ticks já estão disponíveis.',
    uploadRequired: 'Por favor, faça upload de uma imagem de gráfico.',
    invalidFormat: 'Formato inválido. Envie uma imagem PNG, JPG/JPEG ou WEBP.',
    tooLarge: 'Arquivo muito grande. O limite é de 10MB.',
    ticksOutTitle: 'Ticks esgotados',
    ticksOutDesc: 'Seus ticks do plano se esgotaram. Eles renovam automaticamente no próximo ciclo.',
    weeklyInsight: 'Insight da semana',
    analysisError: 'Erro na Análise',
    tryAgain: 'Tentar Novamente',
    loadingPlanTitle: 'Carregando seu plano…',
    loadingPlanDesc: 'Confirmando sua assinatura. Leva alguns segundos, tente de novo em instantes.',
    analysisTimeout: 'A análise demorou mais que o esperado, tente novamente.',
    analysisUnknownError: 'Erro desconhecido ao processar análise.',
    analysisFailed: 'Não foi possível concluir a análise.',
    networkError: 'Não foi possível conectar ao Tickrify. Confira sua internet e tente novamente.',
    authTokenFailed: 'Não conseguimos confirmar sua sessão. Recarregue a página e tente novamente. Se continuar, saia e entre de novo na conta.',
    subscribeCta: 'Assinar',
    demoMode: 'Modo Demonstração: explorando a interface sem login',
    demoLogin: 'Fazer Login para Análises Reais',
    choosePlan: 'Escolha seu plano',
    planSub: 'Comece com uma semana ou vá de mensal. Cancele quando quiser.',
    later: 'Continuar depois',
    perMonth: '/mês',
    modalMonthly: 'Mensal, 200 análises',
    modalMonthlyOffer: '{price} no primeiro mês, depois US$ 29/mês',
    modalWeekly: 'Uma semana, 25 análises',
    modalCompare: 'Comparar todos os planos',
    modalVideoCaption: 'O que o assinante recebe: o gráfico de entrada mais até dois tempos maiores, lidos como um mercado só. 20 segundos.',
    waitNudge: 'Este WAIT não gastou uma análise com entrada. Você ainda tem {left} de {limit}.',
    waitNudgeHint: 'Tente outro par ou outro tempo gráfico.',
    waitNudgeCta: 'Analisar outro gráfico',
    waitNudgeWhy: 'Por que WAIT? (vídeo de 22 s)',
    plansTitle: 'Planos',
    plansSub: 'O mesmo motor em todos os planos. Cancele quando quiser.',
  },
} as const;
import officialIcon from "@/assets/tickrify-icon-official.png";
import BrandLoader from "../ui/BrandLoader";

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type View = 'dashboard' | 'new-analysis' | 'sample' | 'my-trades' | 'journal' | 'strategy' | 'plans' | 'analysis-result' | 'loading' | 'error' | 'locked';

/**
 * Rotas do painel (05/10/2026). Antes era UMA rota so e as areas eram estado
 * interno: o voltar do navegador saia do app e o PostHog via tudo como
 * /dashboard. Agora cada area tem URL propria, o item ativo do menu sai da URL
 * e colar o endereco na barra abre a area certa. `/demo` usa o mesmo mapa.
 *
 *   /dashboard                    inicio (KPIs, recentes)
 *   /dashboard/new                nova analise (envio, carregando, erro, paywall)
 *   /dashboard/new/example/:kind  uma das 3 analises de exemplo
 *   /dashboard/analysis/:id       resultado de uma analise
 *   /dashboard/trades             My Trades (o historico)
 *   /dashboard/journal            diario
 *   /dashboard/strategy           perfil de estrategia
 *   /dashboard/plans              planos, sem sair do painel
 */
type Section = 'home' | 'new' | 'sample' | 'analysis' | 'trades' | 'journal' | 'strategy' | 'plans';
type NavSection = 'home' | 'new' | 'trades' | 'journal' | 'strategy' | 'plans';
const SECTION_PATH: Record<NavSection, string> = {
  home: '',
  new: '/new',
  trades: '/trades',
  journal: '/journal',
  strategy: '/strategy',
  plans: '/plans',
};

function parseDashboardPath(pathname: string): { base: string; section: Section | null; param: string | null } {
  const [, root = 'dashboard', ...rest] = pathname.replace(/\/+$/, '').split('/');
  const base = root === 'demo' ? '/demo' : '/dashboard';
  const [first, second, third] = rest;
  if (!first) return { base, section: 'home', param: null };
  if (first === 'new' && !second) return { base, section: 'new', param: null };
  if (first === 'new' && second === 'example' && third && rest.length === 3) return { base, section: 'sample', param: third };
  if (first === 'analysis' && second && rest.length === 2) return { base, section: 'analysis', param: decodeURIComponent(second) };
  if (rest.length === 1 && ['trades', 'journal', 'strategy', 'plans'].includes(first)) {
    return { base, section: first as Section, param: null };
  }
  return { base, section: null, param: null };
}

/** Estado da tela de nova analise, que nao tem URL propria (e passageiro). */
type NewFlow = 'idle' | 'loading' | 'error' | 'locked' | 'result';
type MyTradesFilter = 'all' | 'pending' | 'favorites' | Verdict;
type RecentAnalysisItem = {
  symbol: string;
  timeframe: string;
  recommendation: Recommendation;
  bias?: Bias;
  createdAt: string;
};
type ActiveMarketItem = {
  name: string;
  lastSeen: string;
};

/** Exemplos que a pessoa ja abriu, para o "Vista" sobreviver a recarga. */
const SAMPLES_VIEWED_KEY = 'tickrify_samples_viewed';

function loadViewedSamples(): Set<SampleKind> {
  try {
    const raw = JSON.parse(localStorage.getItem(SAMPLES_VIEWED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((k): k is SampleKind => SAMPLE_ANALYSES.some((s) => s.kind === k)) : []);
  } catch {
    return new Set();
  }
}

const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const DashboardPage = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const dc = language === 'pt' ? DASH_COPY.pt : DASH_COPY.en;
  // Preço do 1º mês com o EARLY35, só quando a Stripe diz que o cupom está ativo.
  const foundingOffer = useFoundingOffer();
  const modalFirstMonth = foundingOffer?.percentOff ? (29 * (1 - foundingOffer.percentOff / 100)).toFixed(2) : null;
  const location = useLocation();
  const route = parseDashboardPath(location.pathname);
  const { base } = route;
  const [flow, setFlow] = useState<NewFlow>('idle');
  const goTo = useCallback(
    (section: NavSection, options?: { replace?: boolean; state?: unknown }) =>
      navigate(`${base}${SECTION_PATH[section]}`, options),
    [navigate, base],
  );

  // A tela de nova analise troca de estado (carregando, erro, paywall) sem
  // trocar de rota, entao o ScrollToTopOnRouteChange do App nao alcanca aqui.
  useEffect(() => {
    scrollToTop();
  }, [flow]);
  // Erro e paywall sao da tentativa que acabou de falhar: quem sai da tela e
  // volta pelo voltar do navegador encontra o envio limpo. "Carregando" fica,
  // porque a analise continua rodando.
  useEffect(() => {
    if (route.section !== 'new') setFlow((current) => (current === 'error' || current === 'locked' ? 'idle' : current));
  }, [route.section]);
  const [analysisKey, setAnalysisKey] = useState(0);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AIAnalysisResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { plan, total, used, isUnlimited, remaining, analysesAllTime, totalUsed, totalLimit, freeLocked, isLoading: isPlanLoading } = useAnalysisLimit();
  const queryClient = useQueryClient();
  const incrementAnalysis = useIncrementAnalysis();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const apiClient = useAPIClient();
  const isDemo = !user;
  const { analyses: rawAnalyses, loading: loadingAnalyses, refetch: refetchAnalyses } = useAnalyses(40);

  // Logo de carregamento ate o plano e a lista chegarem, para o painel abrir ja
  // preenchido em vez de aparecer vazio e se completar 1-2 s depois (24/09/2026).
  // Teto de 4 s: se o backend demorar, abre o painel com o que tiver. A trava
  // `bootDone` garante que isto so vale na ABERTURA; um refetch depois nunca
  // volta a esconder o painel atras da logo.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  const bootDone = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setBootTimedOut(true), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  // Aviso da regra nova de ticks (21/09/2026): saldo volta para 200 a cada mes
  // de cobranca, sem acumular. Os assinantes de setembro assinaram quando o
  // saldo so crescia, entao eles precisam ser avisados. Uma vez por navegador,
  // so para assinante, e so ate o fim de outubro (depois vira regra conhecida).
  useEffect(() => {
    if (isDemo || isPlanLoading || plan === 'free' || plan === 'weekly') return;
    if (Date.now() > Date.UTC(2026, 9, 31, 23, 59)) return;
    const key = 'tickrify_notice_monthly_allowance_v1';
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, String(Date.now()));
    } catch {
      return;
    }
    toast({ title: dc.allowanceNoticeTitle, description: dc.allowanceNoticeDesc });
  }, [isDemo, isPlanLoading, plan, toast, dc]);

  // Aviso deixado por outra pagina antes de redirecionar para ca (ex.: "voce
  // ja e assinante" vindo da /pricing). Mostra uma vez e apaga.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('tickrify_flash');
      if (!raw) return;
      sessionStorage.removeItem('tickrify_flash');
      const flash = JSON.parse(raw) as { title?: string; description?: string };
      if (flash?.title) toast({ title: flash.title, description: flash.description });
    } catch {
      /* noop */
    }
  }, [toast]);

  // Intencao de compra que se perdeu no login. O caminho normal volta direto
  // para /dashboard/plans?checkout=... pelo `redirect_url`; alguns nao carregam a URL
  // (One Tap, verificacao de e-mail aberta em outra aba no celular) e caem
  // aqui. Com intencao recente (30 min) no storage, segue para o checkout em
  // vez de largar a pessoa no painel.
  useEffect(() => {
    if (!user || route.section === 'plans') return;
    const intent = loadCheckoutIntent();
    if (intent) navigate(checkoutReturnPath(intent), { replace: true });
    // So na entrada no painel; os Planos ja retomam a compra sozinhos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate]);

  // ── Loop do veredito ────────────────────────────────────────────────────
  // O produto precisa PEDIR o veredito na hora certa; ninguém volta sozinho
  // numa aba secundária pra marcar como o trade terminou.
  //
  // A contagem é feita aqui, sobre a mesma lista do useAnalyses(40) que as
  // outras telas usam — de propósito, e não via GET /api/ai/performance:
  //   1. o Render hiberna, e a UI não pode depender de resposta pra renderizar;
  //   2. o endpoint conta até 1000 análises e esta tela carrega 40 — os números
  //      discordariam ("5 em aberto" com 2 linhas na lista);
  //   3. mesma fonte de verdade do My Trades = os dois nunca divergem.
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [verdictSnoozed, setVerdictSnoozed] = useState<boolean>(isVerdictPromptSnoozed);
  const [askDismissed, setAskDismissed] = useState(false);
  // Id da análise que está sendo exibida no resultado. Vem do `createAnalysis`,
  // que é a única fonte exata — não dá pra deduzir "a mais recente da lista",
  // porque o refetch pode trocar quem é a mais recente no meio do caminho e a
  // marcação cai na análise errada (aconteceu em produção em 28/07).
  const [lastAnalysisId, setLastAnalysisId] = useState<string | null>(null);
  // Filtro com que o My Trades abre. Só é 'OPEN' quando o usuário chega pelo
  // "ver todas" do bloco de cobrança; entrar pelo menu tem que mostrar TUDO.
  // (Antes eu aplicava 'OPEN' sempre que existisse trade em aberto, o que
  // escondia o histórico inteiro de quem clicasse em My Trades no menu.)
  // O filtro viaja no `state` da navegacao: entrar pelo menu (sem state)
  // mostra tudo, e o voltar do navegador restaura o filtro com que se entrou.
  const myTradesFilter = (location.state as { filter?: MyTradesFilter } | null)?.filter;
  const openMyTrades = useCallback((filter?: MyTradesFilter) => {
    goTo('trades', filter ? { state: { filter } } : undefined);
  }, [goTo]);

  // O modal de upgrade e declarado mais abaixo; o ref deixa o applyVerdict
  // abri-lo sem depender da ordem das declaracoes.
  const openUpgradeModalRef = useRef<(trigger: string) => void>(() => undefined);

  // Escrita otimista: a tela muda no clique e o servidor grava em seguida. O
  // servidor e a fonte da verdade (lib/verdict.ts): depois que ele confirma e a
  // lista e relida, a marcacao otimista sai. Se ele recusar, a tela desfaz e
  // avisa, em vez de fingir que gravou (antes a falha era calada e o aviso de
  // "trade aberto" voltava sozinho).
  const applyVerdict = useCallback((id: string, v: Verdict) => {
    setVerdicts((prev) => ({ ...prev, [id]: v }));
    if (isDemo) return;
    void apiClient.setOutcome(id, { outcome: outcomeFromVerdict(v) })
      .then(() => refetchAnalyses())
      .then(() => setVerdicts((prev) => withoutPending(prev, id)))
      .catch((error) => {
        setVerdicts((prev) => withoutPending(prev, id));
        // Gratis esgotado: marcar resultado e da assinatura. Tela velha (antes
        // do /usage avisar) cai aqui; em vez de "falhou", oferece o plano.
        if (isFreeQuotaExhausted(error)) {
          openUpgradeModalRef.current('outcome');
          return;
        }
        toast({ title: t.trades.resultSaveFailed, variant: 'destructive' });
      });
  }, [isDemo, apiClient, refetchAnalyses, toast, t]);

  // Só cobra o que o usuário marcou como "vou operar" E que já tem idade
  // suficiente pra ter desfecho. Cobrar análise de 5 minutos atrás treina o
  // usuário a ignorar o bloco.
  const openVerdictRows = useMemo(() => {
    if (isDemo) return [];
    const cutoff = Date.now() - VERDICT_MIN_AGE_MS;
    return rawAnalyses
      .filter((a) => a.status === 'completed' && resolveVerdict(a, verdicts) === 'OPEN')
      .filter((a) => {
        const created = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        return created > 0 && created < cutoff;
      })
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  }, [rawAnalyses, verdicts, isDemo]);

  // Estatística só aparece com amostra mínima, e SEMPRE com o n visível.
  const verdictStats = useMemo(() => {
    let wins = 0, losses = 0, rrSum = 0, rrCount = 0;
    for (const a of rawAnalyses) {
      if (a.status !== 'completed') continue;
      const v = resolveVerdict(a, verdicts);
      if (v === 'TP1' || v === 'TP2') wins += 1;
      else if (v === 'SL') losses += 1;
      const raw = a as unknown as Record<string, unknown>;
      const rr = Number(raw.riskRewardTp2 ?? raw.riskRewardTp1);
      if (Number.isFinite(rr) && rr > 0) { rrSum += rr; rrCount += 1; }
    }
    const decided = wins + losses;
    return {
      decided,
      winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
      avgRr: rrCount > 0 ? Math.round((rrSum / rrCount) * 100) / 100 : null,
    };
  }, [rawAnalyses, verdicts]);
  const [showAcquisitionSurvey, setShowAcquisitionSurvey] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // Dados de exemplo APENAS para modo DEMO
  // (o array `demoActiveMarkets` foi removido em 19/08/2026: ficou órfão quando
  //  o KPI passou a ler `realActiveMarkets` direto. Era dado inventado sem uso —
  //  exatamente o tipo de coisa que já apareceu como número falso na vitrine.)

  const demoRecentAnalyses = [
    { symbol: "ETH/USD", timeframe: "4H", recommendation: "COMPRA", bias: "bullish", createdAt: new Date().toISOString() },
    { symbol: "TSLA", timeframe: "1D", recommendation: "AGUARDAR", bias: "neutral", createdAt: new Date().toISOString() },
    { symbol: "XAU/USD", timeframe: "1H", recommendation: "VENDA", bias: "bearish", createdAt: new Date().toISOString() },
  ];

  // Derivar análises recentes e mercados ativos via useMemo (sem estado manual)
  const recentAnalyses = useMemo<RecentAnalysisItem[]>(() => {
    if (isDemo || rawAnalyses.length === 0) return [];
    const completed = rawAnalyses
      .filter((a) => a.status === 'completed')
      .map((a) => ({
        symbol: String(a.symbol || '').trim() || 'N/A',
        timeframe: String(a.timeframe || '').trim() || 'N/A',
        recommendation: normalizeRecommendationLabel(a.recommendation) as Recommendation,
        bias: a.bias,
        createdAt: a.createdAt,
      }));
    const withIdentity = completed.filter((item) => item.symbol !== 'N/A' && item.timeframe !== 'N/A');
    return (withIdentity.length > 0 ? withIdentity : completed).slice(0, 3);
  }, [rawAnalyses, isDemo]);

  const realActiveMarkets = useMemo<ActiveMarketItem[]>(() => {
    if (isDemo || rawAnalyses.length === 0) return [];
    const now = Date.now();
    const activeWindowMs = 8 * 60 * 60 * 1000;
    const formatLastSeen = (dateIso: string) => {
      const diffMs = Math.max(0, now - new Date(dateIso).getTime());
      const minutes = Math.max(1, Math.floor(diffMs / (60 * 1000)));
      if (minutes < 60) return `${minutes} min ${t.nav.ago}`;
      return `${Math.floor(minutes / 60)}h ${t.nav.ago}`;
    };
    const recent = rawAnalyses
      .filter((a) => a.createdAt && now - new Date(a.createdAt).getTime() <= activeWindowMs)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const marketMap = new Map<string, ActiveMarketItem>();
    for (const analysis of recent) {
      const symbol = String(analysis.symbol || '').trim();
      if (!symbol || symbol === 'N/A') continue;
      if (!marketMap.has(symbol)) {
        const timeframe = analysis.timeframe ? ` • ${analysis.timeframe}` : '';
        marketMap.set(symbol, { name: `${symbol}${timeframe}`, lastSeen: formatLastSeen(analysis.createdAt) });
      }
    }
    return Array.from(marketMap.values()).slice(0, 6);
  }, [rawAnalyses, isDemo, t.nav.ago]);

  // KPIs do cockpit — derivados das análises já carregadas (sem fetch novo).
  const dashboardKpis = useMemo(() => {
    const completed = rawAnalyses.filter((a) => a.status === 'completed');
    // Era a "confiança média". Saiu em 30/09/2026 junto com o score: a
    // confiança era pedida ao modelo como chance de bater o TP1 e, medida em
    // produção, não separou acerto de erro. No lugar, quantas das leituras
    // recentes viraram plano de trade (BUY/SELL) e quantas foram WAIT.
    const tradePlans = completed.filter((a) => {
      const tone = getRecommendationMeta(a.recommendation).tone;
      return tone === 'buy' || tone === 'sell';
    }).length;
    // `total` do KPI: contagem REAL do banco quando ela chega, senao o que der
    // para contar da lista carregada.
    //
    // O contador local sozinho era um numero FALSO: `rawAnalyses` vem de
    // useAnalyses(40), entao uma conta com 403 analises exibia 38 para sempre,
    // sob um rotulo que diz "all time". Analise nova entrava no topo e uma
    // antiga saia embaixo, e o numero nunca se mexia.
    //
    // O fallback local continua existindo de proposito: o Render hiberna, e a
    // tela precisa mostrar algo enquanto o /usage nao responde. Ele so nao pode
    // ser a fonte final.
    return { total: analysesAllTime ?? completed.length, tradePlans, recentCount: completed.length };
  }, [rawAnalyses, analysesAllTime]);

  const { balance: ticksBalance } = useTicks();

  // Insight da semana: cenário de mercado, inclusive WAIT com viés direcional.
  const weeklyInsight = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let bull = 0;
    let bear = 0;
    let neutral = 0;
    for (const a of rawAnalyses) {
      if (a.status !== 'completed' || !a.createdAt) continue;
      if (new Date(a.createdAt).getTime() < weekAgo) continue;
      const scenario = getScenarioMeta(a.bias, a.recommendation).label;
      if (scenario === 'BULLISH') bull += 1;
      else if (scenario === 'BEARISH') bear += 1;
      else neutral += 1;
    }
    return { bull, bear, neutral, total: bull + bear + neutral };
  }, [rawAnalyses]);

  // Dispara o backfill de e-mail + boas-vindas no backend (GET /api/auth/me).
  //
  // ⚠️ Este efeito e a CORRECAO de um bug silencioso de julho: o endpoint existia,
  // o backfill existia, o e-mail de boas-vindas existia — e NADA no frontend
  // chamava a rota. Por isso `User.email` estava NULL em 20 de 20 contas de
  // producao e nenhum e-mail jamais saiu. O painel e o lugar certo: todo usuario
  // autenticado passa por aqui.
  //
  // Roda UMA vez por montagem, fora do caminho de render, e engole erro de
  // proposito — o e-mail nunca pode atrapalhar o carregamento do painel.
  useEffect(() => {
    if (isDemo) return;
    /* O sync ja existia (e o unico gatilho do backfill de e-mail). Agora ele
     * tambem diz se a pergunta de origem ja foi respondida, sem custar uma
     * requisicao a mais. */
    void apiClient
      .syncUserProfile()
      .then((perfil) => {
        if (perfil && !perfil.acquisitionSource) setShowAcquisitionSurvey(true);
      })
      .catch(() => undefined);
  }, [isDemo, apiClient]);

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
    const successState = params.get('success');

    if (successState === 'true') {
      // Volta da Stripe. No PostHog e so UX (`checkout_success_viewed`): a receita
      // confirmada e o `checkout_completed` do backend. Antes este evento se
      // chamava `subscription_activated`, o mesmo nome do backend, e a receita
      // contava em dobro. Os pixels de anuncio so existem no navegador, entao
      // a conversao de compra deles continua saindo daqui.
      const sessionId = params.get('session_id');
      track('checkout_success_viewed', { sessionId });
      // Purchase do pixel SO depois que o servidor confirma a sessao paga (e
      // desta pessoa), com o valor real e o mesmo event_id do servidor. Voltar
      // para esta URL sem ter pago nao conta compra.
      void getToken().then(async (token) => {
        if (!token) return;
        const status = await getCheckoutStatus(token, { sessionId, outcome: 'success' });
        if (status?.paid && status.sessionId) {
          trackAdConversion('purchase', {
            eventId: `purchase_${status.sessionId}`,
            transactionId: status.sessionId,
            value: status.value ?? 0,
            currency: status.currency ?? 'USD',
          });
        }
      });
      toast({
        title: dc.planActivatedTitle,
        description: dc.planActivatedDesc,
      });
      // Dispara re-fetch do limite para refletir o novo plano e rele tudo que
      // estava travado para o gratis (historico, diario): quem assina volta a
      // ver tudo na hora, sem recarregar.
      window.dispatchEvent(new Event('tickrify:analysis-created'));
      void queryClient.invalidateQueries();
      navigate(location.pathname, { replace: true });
      return;
    }
    // Roda so na montagem: a volta da Stripe e uma entrada nova no painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, dc, getToken]);

  // Ativação do funil: usuário entrou no modo demo (sem login).
  useEffect(() => {
    if (isDemo) track('demo_opened');
  }, [isDemo]);

  // Ativação: usuário NOVO (logado, ainda sem nenhuma análise) cai direto na tela
  // de subir o gráfico — não no painel vazio com KPIs zerados. Roteia uma única vez,
  // e só para quem nunca fez uma análise (usuário recorrente continua caindo no painel).
  const [autoRoutedNewUser, setAutoRoutedNewUser] = useState(false);
  useEffect(() => {
    if (autoRoutedNewUser || isDemo || !user || loadingAnalyses) return;
    const hasAnalysis = rawAnalyses.some((a) => a.status === 'completed');
    // So quem abriu o inicio: um link direto para outra area e respeitado.
    if (!hasAnalysis && route.section === 'home') {
      goTo('new', { replace: true });
    }
    setAutoRoutedNewUser(true);
  }, [autoRoutedNewUser, isDemo, user, loadingAnalyses, rawAnalyses, route.section, goTo]);

  // Tres analises de exemplo fixas antes das gratis, so para quem esta no
  // plano gratis e ainda nao concluiu nenhuma. Sao dados do bundle: abrir nao
  // chama a API e nao mexe na cota (ver SampleAnalyses.tsx).
  const showSamples =
    !isDemo &&
    Boolean(user) &&
    !isUnlimited &&
    SAMPLE_ANALYSES.length > 0 &&
    !loadingAnalyses &&
    !rawAnalyses.some((a) => a.status === 'completed');
  const [viewedSamples, setViewedSamples] = useState<Set<SampleKind>>(loadViewedSamples);
  // Leitura feita no /try antes do cadastro (fica so neste aparelho).
  const [savedDemo] = useState(loadSavedDemoResult);
  const openSampleAnalysis = useCallback((kind: SampleKind) => {
    track('sample_analysis_opened', { sample: kind });
    navigate(`${base}/new/example/${kind}`);
    setViewedSamples((prev) => {
      if (prev.has(kind)) return prev;
      const next = new Set(prev).add(kind);
      try {
        localStorage.setItem(SAMPLES_VIEWED_KEY, JSON.stringify([...next]));
      } catch {
        /* noop */
      }
      return next;
    });
  }, [navigate, base]);
  // Sinais gratis que ainda restam (o /usage ja desconta); 3 enquanto carrega.
  const samplesFreeLeft = Number.isFinite(remaining) ? Math.max(0, remaining) : (total ?? 3);

  // Resultado aberto pela URL (recarregar, voltar do navegador, link colado):
  // busca a analise no servidor. Logo depois de uma analise nova ela ja esta
  // em memoria e nada e buscado.
  const routeAnalysisId = route.section === 'analysis' ? route.param : null;
  const [resultLoad, setResultLoad] = useState<'idle' | 'loading' | 'failed' | 'locked'>('idle');
  const analysisInMemory = Boolean(
    routeAnalysisId && analysisData && (analysisData.id === routeAnalysisId || lastAnalysisId === routeAnalysisId),
  );
  useEffect(() => {
    if (!routeAnalysisId || isDemo || analysisInMemory) return;
    let cancelled = false;
    setResultLoad('loading');
    apiClient
      .getAnalysis(routeAnalysisId)
      .then((analysis) => {
        if (cancelled) return;
        if (analysis.status !== 'completed') {
          setResultLoad('failed');
          return;
        }
        setAnalysisData({ ...analysis, id: routeAnalysisId });
        setUploadedImage(null);
        setLastAnalysisId(routeAnalysisId);
        setAskDismissed(false);
        setResultLoad('idle');
      })
      .catch((error) => {
        if (!cancelled) setResultLoad(isFreeQuotaExhausted(error) ? 'locked' : 'failed');
      });
    return () => {
      cancelled = true;
    };
  }, [routeAnalysisId, isDemo, analysisInMemory, apiClient]);

  // A tela atual sai da URL; so a nova analise tem estados sem endereco.
  const activeView: View | null = (() => {
    switch (route.section) {
      case 'home':
        return 'dashboard';
      case 'new':
        return flow === 'idle' ? 'new-analysis' : flow === 'result' ? 'analysis-result' : flow;
      case 'sample':
        return 'sample';
      case 'analysis':
        return 'analysis-result';
      case 'trades':
        return 'my-trades';
      case 'journal':
        return 'journal';
      case 'strategy':
        return 'strategy';
      case 'plans':
        return 'plans';
      default:
        return null;
    }
  })();

  // Usar dados demo ou reais dependendo do modo
  const displayRecentAnalyses = isDemo ? demoRecentAnalyses : recentAnalyses;

  const goToPlans = useCallback(() => {
    setShowUpgradeModal(false);
    goTo('plans');
  }, [goTo]);

  const openUpgradeModal = useCallback((trigger: string) => {
    track('upgrade_modal_viewed', { trigger });
    setShowUpgradeModal(true);
  }, []);
  openUpgradeModalRef.current = openUpgradeModal;

  // Paywall → Stripe em 1 clique, com EARLY35 já aplicado. O momento de maior
  // intenção do funil não pode passar pela página de pricing genérica.
  const [unlockPending, setUnlockPending] = useState(false);
  // `source` diz de onde veio o clique: paywall da 4a tentativa
  // (`locked_value`) ou o CTA no resultado da ultima gratis (`last_free_result`).
  // Os dois abrem o MESMO checkout: foi o paywall que converteu 12 de 12 em
  // setembro, e 15 de 27 pessoas que usaram a 3a gratis nunca chegaram a ve-lo.
  // `cycle`: o semanal (US$ 7,99, 25 ticks) sai sem o EARLY35, que e do
  // primeiro MES; o servidor tambem descarta o cupom nesse caso.
  const startCheckout = useCallback(async (
    source: 'locked_value' | 'last_free_result' | 'upgrade_modal',
    cycle: 'monthly' | 'weekly' = 'monthly',
    surface: PaywallSurface | null = null,
  ) => {
    if (unlockPending) return;
    setUnlockPending(true);
    try {
      const token = await getToken();
      if (!token) {
        track('checkout_failed', { source, plan: 'starter', code: 'no_token' });
        goTo('plans');
        return;
      }
      // `starter` é o plano da vitrine (200 ticks). Este botão vendia `pro`
      // (LEGADO, 150 ticks) pelo mesmo US$ 29 — quem entrasse pelo paywall
      // pagava igual e recebia 50 ticks a menos que quem passou pelo /pricing.
      // A moeda é USD fixo: o `detectCurrency` daqui mandava navegador pt-BR
      // para o price BRL congelado em jun/2026.
      // EARLY35 so no mensal (regra do servidor, 05/10/2026).
      const coupon = cycle === 'monthly' ? 'EARLY35' : undefined;
      track('upgrade_clicked', { source, cycle, coupon: coupon ?? null, surface });
      const { url, sessionId } = await createCheckoutSession('starter', token, cycle, 'usd', coupon, source);
      track('checkout_started', { plan: 'starter', billingCycle: cycle, currency: 'usd', coupon: coupon ?? null, source, surface, sessionId });
      window.location.href = url;
    } catch (error) {
      // Este catch era silencioso: a falha virava um desvio para /pricing sem
      // aviso na tela e sem rastro no funil.
      const code = error instanceof CheckoutError ? error.code : undefined;
      const message = error instanceof Error ? error.message : '';
      track('checkout_failed', {
        source,
        plan: 'starter',
        code: code ?? 'unknown',
        message: message.slice(0, 200) || 'unknown',
      });
      if (code === 'already_subscribed') {
        // Ja paga: mandar para a pagina de precos seria vender de novo. O
        // painel ja e o lugar certo, entao so avisa.
        toast({ title: dc.alreadySubscribedTitle, description: message });
        return;
      }
      toast({ title: dc.checkoutErrorTitle, description: message, variant: 'destructive' });
      // Cai nos Planos do painel, nunca num beco: la tem o mesmo botao.
      goTo('plans');
    } finally {
      setUnlockPending(false);
    }
  }, [unlockPending, getToken, goTo, toast, dc]);

  // Todo paywall fecha no mesmo checkout (`locked_value` na Stripe); a area de
  // onde veio vai junto para o PostHog.
  const paywallFor = (surface: PaywallSurface, children?: ReactNode) => (
    <Paywall
      surface={surface}
      onWeekly={() => void startCheckout('locked_value', 'weekly', surface)}
      onMonthly={() => void startCheckout('locked_value', 'monthly', surface)}
      unlockPending={unlockPending}
      plansHref={`${base}${SECTION_PATH.plans}`}
    >
      {children}
    </Paywall>
  );
  // Janela de upgrade: checkout direto, como no paywall. Antes o unico botao
  // levava para a /pricing (um passo a mais) e so mostrava o mensal de US$ 29.
  const handleModalMonthly = useCallback(() => void startCheckout('upgrade_modal'), [startCheckout]);
  const handleModalWeekly = useCallback(() => void startCheckout('upgrade_modal', 'weekly'), [startCheckout]);

  // A pessoa VIU a oferta depois da ultima gratis? Uma vez por analise. Sem
  // isto so dava para medir o clique, nunca quem viu e ignorou. Enquanto o plano
  // carrega, `remaining` e 0 para todo mundo (ate assinante): sem esperar, o
  // recarregar de /dashboard/analysis/:id contava uma oferta que ninguem viu.
  const lastFreeCtaSeenFor = useRef<string | null>(null);
  useEffect(() => {
    if (activeView !== 'analysis-result' || isDemo || isUnlimited || isPlanLoading) return;
    if (!Number.isFinite(remaining) || remaining > 0) return;
    const key = lastAnalysisId || 'unknown';
    if (lastFreeCtaSeenFor.current === key) return;
    lastFreeCtaSeenFor.current = key;
    track('upgrade_cta_viewed', { source: 'last_free_result' });
  }, [activeView, isDemo, isUnlimited, isPlanLoading, remaining, lastAnalysisId]);
  // Barra do WAIT (topo do resultado): vista uma vez por analise.
  const isWaitResult = ['WAIT', 'HOLD'].includes(String(analysisData?.recommendation || '').toUpperCase());
  const waitNudgeSeenFor = useRef<string | null>(null);
  useEffect(() => {
    if (activeView !== 'analysis-result' || isDemo || isUnlimited || !isWaitResult) return;
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const key = lastAnalysisId || 'unknown';
    if (waitNudgeSeenFor.current === key) return;
    waitNudgeSeenFor.current = key;
    track('wait_nudge_viewed', { freeRemaining: remaining });
  }, [activeView, isDemo, isUnlimited, isWaitResult, remaining, lastAnalysisId]);

  const handleLastFreeCheckout = useCallback(() => {
    track('upgrade_cta_clicked', { source: 'last_free_result', destination: 'checkout' });
    // Semanal primeiro (05/10/2026), como o paywall: a entrada mais barata.
    void startCheckout('last_free_result', 'weekly');
  }, [startCheckout]);

  const resetNewAnalysisView = useCallback(() => {
    setFlow('idle');
    // Ja na nova analise: troca a entrada em vez de empilhar outra igual.
    goTo('new', { replace: route.section === 'new' });
    setAnalysisKey((key) => key + 1);
    // `analysisData` fica: e o resultado anterior, que o voltar do navegador
    // reabre sem buscar de novo. A proxima analise substitui.
    setErrorMessage('');
    setUploadedImage(null);
    setLastAnalysisId(null);
    setAskDismissed(false);
  }, [goTo, route.section]);

  // Guarda o último envio para o "Try again" refazer a análise sem perder o gráfico.
  const lastAnalysisParamsRef = useRef<{
    imageUrl: string | null;
    imageFile: File | null;
    htfBase64Images: string[];
    analysisType: 'quick' | 'deep';
  } | null>(null);

  const handleStartAnalysis = async (
    imageUrl: string | null = null,
    imageFile: File | null = null,
    htfBase64Images: string[] = [],
    analysisType: 'quick' | 'deep' = 'quick',
  ) => {
    // Modo DEMO: apenas simula, não faz análise real
    if (isDemo) {
      setUploadedImage(imageUrl);
      setFlow('loading');
      setTimeout(() => {
        setAnalysisData(null);
        setFlow('result');
      }, 2000); // Simulação mais rápida no demo
      return;
    }

    // Plano ainda não confirmado pelo backend (conta paga demora a resolver no
    // cold start do Render). Não deixa analisar até saber — senão assinante
    // gastava uma análise grátis por engano.
    if (isPlanLoading) {
      toast({ title: dc.loadingPlanTitle, description: dc.loadingPlanDesc });
      return;
    }

    // Validar se tem imagem
    if (!imageUrl && !imageFile) {
      setErrorMessage(dc.uploadRequired);
      setFlow('error');
      return;
    }

    if (imageFile) {
      const normalizedType = String(imageFile.type || '').toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(normalizedType)) {
        setErrorMessage(dc.invalidFormat);
        setFlow('error');
        return;
      }

      if (imageFile.size > MAX_IMAGE_FILE_SIZE) {
        setErrorMessage(dc.tooLarge);
        setFlow('error');
        return;
      }
    }

    // Grátis sem análises restantes → mostra o valor trancado, sem gastar uma chamada de API.
    if (!isDemo && !isUnlimited && Number.isFinite(remaining) && remaining <= 0) {
      setUploadedImage(imageUrl);
      track('free_limit_reached', { reason: 'no_free_left' });
      setFlow('locked');
      return;
    }

    // Memoriza o envio para o retry manter o mesmo gráfico e contexto.
    lastAnalysisParamsRef.current = { imageUrl, imageFile, htfBase64Images, analysisType };

    const startedAt = performance.now();
    try {
      setUploadedImage(imageUrl);
      setFlow('loading');
      setErrorMessage('');

      track('analysis_started', {
        analysisType,
        plan,
        // Qual gratis esta comecando (1, 2 ou 3). O backend emite o mesmo fato
        // como `free_analysis_started`, numerado pelo banco e sem depender de
        // cookie; este serve para ver o funil no navegador lado a lado.
        analysisNumber: isUnlimited ? null : used + 1,
        freeRemainingBefore: isUnlimited || !Number.isFinite(remaining) ? null : remaining,
      });

      const response = await apiClient.createAnalysis({
        imageFile: imageFile || undefined,
        base64Image: imageUrl || undefined,
        userLanguage: language,
        htfBase64Images: htfBase64Images.length > 0 ? htfBase64Images : undefined,
        analysisType,
      });

      // Incrementar contador (apenas quando logado)
      incrementAnalysis();

      setLastAnalysisId(response.id);
      const analysis = await apiClient.waitForAnalysisCompletion(response.id, response);

      if (analysis.status === 'failed') {
        throw new AnalysisProcessingError(
          analysis.errorMessage || analysis.reasoning || dc.analysisFailed,
          analysis.errorCode,
        );
      }

      // Análise concluída: o resultado ganha URL propria (recarregar a pagina
      // ou voltar do navegador reabre a mesma analise).
      const resultId = analysis.id || response.id;
      setAnalysisData(resultId ? { ...analysis, id: resultId } : analysis);
      if (resultId) {
        setFlow('idle');
        navigate(`${base}/analysis/${encodeURIComponent(resultId)}`);
      } else {
        setFlow('result');
      }
      // ATIVAÇÃO: resultado renderizado com sucesso (apenas usuário logado).
      track('analysis_completed', {
        analysisType,
        recommendation: analysis.recommendation ?? 'unknown',
        confidence: analysis.confidence ?? null,
        // O par e o timeframe vem dentro de fullResponse.analysis; o topo da
        // resposta costuma vir sem eles (o PostHog recebia symbol: null sempre).
        ...(() => {
          const resposta = asRecord(analysis.fullResponse);
          const bloco = asRecord(resposta.analysis);
          const pick = (...values: unknown[]) =>
            String(values.find((v) => typeof v === 'string' && v.trim()) ?? '').trim() || null;
          return {
            symbol: pick(analysis.symbol, bloco.symbol, bloco.ticker, bloco.asset, resposta.symbol, resposta.ticker),
            timeframe: pick(analysis.timeframe, bloco.timeframe, bloco.period, resposta.timeframe),
          };
        })(),
        plan,
        // Posição da análise na escada grátis (1, 2 ou 3). null para plano pago/ilimitado.
        // `used` vem do backend (count antes desta análise), então esta é a (used+1)-ésima.
        analysisNumber: isUnlimited ? null : used + 1,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (!isDemo && user) {
        refetchAnalyses();
      }
    } catch (error) {
      console.error('[Dashboard] Erro ao criar análise:', error);
      track('analysis_failed', {
        ...analysisFailureTelemetry(error),
        analysisType,
        durationMs: Math.round(performance.now() - startedAt),
        // Separa "sem internet" de "arquivo ilegivel" nas falhas de rede.
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        fileBytes: imageFile?.size ?? null,
        fileType: imageFile?.type || null,
      });
      // Reconcilia o contador com o backend: falhas não consomem análise grátis,
      // então o slot precisa voltar caso a IA tenha falhado.
      incrementAnalysis();
      if (error instanceof APIError) {
        let parsedBody: Record<string, unknown> | null = null;
        try {
          parsedBody = JSON.parse(error.message) as Record<string, unknown>;
        } catch {
          parsedBody = null;
        }

        const apiCode = error.code || String(parsedBody?.code || '');
        if (apiCode === 'INSUFFICIENT_TICKS') {
          track('free_limit_reached', { reason: 'insufficient_ticks' });
          toast({
            title: dc.ticksOutTitle,
            description: dc.ticksOutDesc,
            variant: 'destructive',
          });
          resetNewAnalysisView();
          return;
        }

        if (apiCode === 'SUBSCRIPTION_REQUIRED' || apiCode === 'DEMO_LIMIT_REACHED' || error.status === 403) {
          // Sem análises grátis restantes → mostra o valor trancado (paywall com preview borrado).
          track('free_limit_reached', { reason: apiCode || 'forbidden' });
          setFlow('locked');
          return;
        }

        if (
          error.status === 402 ||
          error.status === 429 ||
          error.code === 'upgrade_required' ||
          error.code === 'quota_exceeded'
        ) {
          openUpgradeModal('quota');
        }
      }

      if (error instanceof APIError && error.code === 'analysis_timeout') {
        setErrorMessage(dc.analysisTimeout);
      } else if (error instanceof APIError && (error.code === 'network_error' || error.code === 'timeout')) {
        // A mensagem do APIError e tecnica (fala de VITE_API_URL e CORS): serve
        // para o console e a telemetria, nao para a pessoa.
        setErrorMessage(dc.networkError);
      } else if (error instanceof APIError && error.code === 'auth_token_failed') {
        setErrorMessage(dc.authTokenFailed);
      } else {
        setErrorMessage(error instanceof Error ? error.message : dc.analysisUnknownError);
      }
      setFlow('error');
    }
  };

  const handleRetry = () => {
    const last = lastAnalysisParamsRef.current;
    if (last && (last.imageUrl || last.imageFile)) {
      // Reenvia a mesma análise — o usuário não perde o gráfico que subiu.
      void handleStartAnalysis(last.imageUrl, last.imageFile, last.htfBase64Images, last.analysisType);
      return;
    }
    resetNewAnalysisView();
  };

  const viewEyebrow = (label: string) => (
    <div className="tk-eyebrow flex items-center gap-2 text-[11px]">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
      {t.nav.workspace} / {label}
    </div>
  );

  // A mesma pergunta em dois lugares: inicio do painel e logo abaixo do
  // resultado de uma analise (05/10/2026: 208 de 226 cadastros nao respondiam,
  // porque quem cai direto em "nova analise" nunca via o inicio). Respondeu ou
  // dispensou num lugar, some dos dois.
  const acquisitionSurvey = (
    <AcquisitionSurvey
      onAnswer={async (payload) => {
        try {
          await apiClient.setAcquisitionSource(payload);
        } catch {
          /* engolido de proposito: medicao nunca quebra o painel */
        }
      }}
      onDismiss={() => setShowAcquisitionSurvey(false)}
    />
  );

  const renderDashboardHome = () => {
    const titleWords = t.nav.centralTitle.split(' ');
    const titleLast = titleWords.length > 1 ? titleWords.pop() : '';
    const titleHead = titleWords.join(' ');
    const bullPct = weeklyInsight.total > 0 ? (weeklyInsight.bull / weeklyInsight.total) * 100 : 0;
    const bearPct = weeklyInsight.total > 0 ? (weeklyInsight.bear / weeklyInsight.total) * 100 : 0;
    const neutralPct = weeklyInsight.total > 0 ? (weeklyInsight.neutral / weeklyInsight.total) * 100 : 0;
    const firstName = user?.firstName || 'Trader';
    const ticksNum = Math.floor(Number(ticksBalance) || 0);
    const kpis: Array<{ label: string; value: string; sub: string; Icon: typeof BarChart3; accent?: boolean }> = [
      { label: t.nav.analysesWord, value: String(dashboardKpis.total), sub: t.nav.kpiSubTotal, Icon: BarChart3 },
      {
        label: t.nav.kpiTradePlans,
        value: String(dashboardKpis.tradePlans),
        sub: t.nav.kpiSubTradePlans.replace('{n}', String(dashboardKpis.recentCount)),
        Icon: Target,
        accent: true,
      },
      { label: t.nav.activeMarkets, value: String(realActiveMarkets.length), sub: t.nav.kpiSubMarkets, Icon: Activity },
      { label: 'Ticks', value: String(ticksNum), sub: t.nav.kpiSubTicks, Icon: Zap },
    ];
    return (
      <div className="flex flex-col gap-4">
        {/* De onde a pessoa veio, perguntado a ela. A atribuicao tecnica
            (PostHog + UTM) nao respondeu isso para os tres primeiros
            assinantes; ver o cabecalho do AcquisitionSurvey. */}
        {!isDemo && showAcquisitionSurvey && acquisitionSurvey}

        {/* Onda 2.3 — o motivo de voltar amanhã. Só aparece com trades que o
            próprio usuário marcou como "vou operar" e que já passaram de 12h.
            Nunca cobra análise WAIT: não houve trade pra fechar. */}
        {!isDemo && !freeLocked && !verdictSnoozed && openVerdictRows.length > 0 && (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {openVerdictRows.length} {t.verdict.chaseOpen}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.verdict.chaseDesc}</p>
              </div>
              <button
                type="button"
                onClick={() => { snoozeVerdictPrompt(); setVerdictSnoozed(true); }}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {t.verdict.notNow}
              </button>
            </div>

            <div className="mt-4 divide-y divide-[var(--border-subtle)]">
              {openVerdictRows.slice(0, VERDICT_MAX_ROWS).map((a) => {
                const raw = a as unknown as Record<string, unknown>;
                const created = a.createdAt ? new Date(a.createdAt) : null;
                return (
                  <div key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-terminal text-sm text-[var(--text-primary)]">
                        {String(raw.symbol || 'N/A')}{' '}
                        <span className="text-xs text-[var(--text-secondary)]">{String(raw.timeframe || '')}</span>
                      </p>
                      {created && (
                        <p className="font-terminal text-[11px] text-[var(--text-secondary)]">
                          {created.toLocaleDateString(DATE_LOCALES[language] ?? 'en-US')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" onClick={() => applyVerdict(a.id, 'TP1')} className="rounded-lg border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--signal-buy)] transition-opacity hover:opacity-80">{t.trades.tp1Hit}</button>
                      <button type="button" onClick={() => applyVerdict(a.id, 'TP2')} className="rounded-lg border border-[var(--signal-buy-border)] bg-[var(--signal-buy-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--signal-buy)] transition-opacity hover:opacity-80">{t.trades.tp2Hit}</button>
                      <button type="button" onClick={() => applyVerdict(a.id, 'SL')} className="rounded-lg border border-[var(--signal-sell-border)] bg-[var(--signal-sell-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--signal-sell)] transition-opacity hover:opacity-80">{t.trades.slHit}</button>
                      <button type="button" onClick={() => applyVerdict(a.id, 'NO_FILL')} className="rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">{t.trades.noFill}</button>
                      <button type="button" onClick={() => applyVerdict(a.id, null)} className="rounded-lg border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">{t.verdict.notTaken}</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {openVerdictRows.length > VERDICT_MAX_ROWS && (
              <button
                type="button"
                onClick={() => openMyTrades('OPEN')}
                className="mt-3 font-terminal text-xs text-[var(--accent-green)] underline-offset-2 hover:underline"
              >
                {t.verdict.seeAll} ({openVerdictRows.length})
              </button>
            )}
          </div>
        )}

        {/* Onda 2.4 — o dado devolvido pro usuário. Amostra SEMPRE visível;
            abaixo de 5 decididos não mostramos nada, porque taxa de acerto com
            2 trades não é informação, é ruído com cara de estatística. */}
        {!isDemo && verdictStats.decided >= 5 && verdictStats.winRate !== null && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
            <span className="text-sm text-[var(--text-secondary)]">{t.verdict.statsLabel}</span>
            <span className="font-terminal text-xl font-semibold text-[var(--text-primary)]">{verdictStats.winRate}%</span>
            {verdictStats.avgRr !== null && (
              <span className="font-terminal text-xs text-[var(--text-secondary)]">
                {t.verdict.statsRr} {verdictStats.avgRr.toFixed(1)}:1
              </span>
            )}
            <span className="font-terminal text-xs text-[var(--text-muted)]">
              {t.verdict.statsBasedOn} {verdictStats.decided} {t.verdict.statsSample}
            </span>
          </div>
        )}

        {/* Cockpit hero */}
        <div
          className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 md:p-8"
          style={{ backgroundImage: 'radial-gradient(ellipse 720px 320px at 100% 0%, rgba(0,232,122,0.06), transparent 60%)' }}
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="tk-eyebrow flex items-center gap-2 text-[11px]">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
                {t.nav.greeting}, {firstName}
              </div>
              <h1 className="tk-display mt-2 text-4xl md:text-5xl">
                {titleHead}{' '}
                {titleLast && <em className="font-serif italic text-[var(--text-secondary)]">{titleLast}</em>}
              </h1>
              <p className="mt-3 font-terminal text-xs text-[var(--text-secondary)]">
                {ticksNum} ticks · {dashboardKpis.total} {t.nav.analysesWord}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => goTo('journal')}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-white/[0.04]"
              >
                <CalendarDays className="h-4 w-4" /> {t.nav.journal}
              </button>
              <button
                type="button"
                onClick={resetNewAnalysisView}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90"
              >
                <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
              </button>
            </div>
          </div>
        </div>

        {/* Usuário sem nenhuma análise: KPI zerado não ensina nada e ainda passa
            a impressão de produto vazio. Troca por um estado que explica o que
            a tela vira e oferece UMA ação. Também é aqui que a promessa do
            "valor no minuto 1" se repete dentro do painel (Onda 1.2). */}
        {!isDemo && dashboardKpis.total === 0 && !loadingAnalyses ? (
          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <EmptyState
              icon={Upload}
              title={t.empty.homeTitle}
              description={t.empty.homeDesc}
              ctaLabel={t.empty.homeCta}
              onCta={resetNewAnalysisView}
            />
          </div>
        ) : (
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] md:grid-cols-4 md:divide-y-0">
          {kpis.map((k) => (
            <div key={k.label} className="p-5">
              <div className="flex items-start justify-between">
                <div className="tk-stat-label">{k.label}</div>
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-subtle)]">
                  <k.Icon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                </span>
              </div>
              <div className={`tk-stat mt-3 text-3xl ${k.accent ? 'text-[var(--accent-green)]' : ''}`}>{k.value}</div>
              <div className="tk-stat-label mt-1 opacity-60">{k.sub}</div>
            </div>
          ))}
        </div>
        )}

        {/* Recent + Insight */}
        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="tk-stat-label">{t.nav.recentAnalyses}</div>
              <button
                type="button"
                onClick={() => openMyTrades()}
                className="font-terminal text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                aria-label={t.nav.recentAnalyses}
              >
                →
              </button>
            </div>
            {displayRecentAnalyses.length > 0 ? (
              displayRecentAnalyses.map((item, idx) => {
                const scenario = getScenarioMeta(item.bias, item.recommendation);
                const action = getRecommendationMeta(item.recommendation);
                const actionLabel = action.tone === 'buy'
                  ? t.analysis.buy
                  : action.tone === 'sell'
                    ? t.analysis.sell
                    : t.analysis.hold;
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] py-2 first:border-t-0"
                  >
                    <span className="font-terminal text-xs text-[var(--text-primary)]">
                      {item.symbol} <span className="text-[var(--text-secondary)]">{item.timeframe}</span>
                    </span>
                    <span className="text-right font-terminal text-[11px] text-[var(--text-secondary)]">
                      <span className={`font-semibold ${scenario.tone === 'buy' ? 'text-[var(--signal-buy)]' : scenario.tone === 'sell' ? 'text-[var(--signal-sell)]' : 'text-[var(--signal-hold)]'}`}>{scenario.label}</span>
                      {' · '}{t.analysis.action}: {actionLabel}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="py-3 text-xs text-[var(--text-secondary)]">{loadingAnalyses ? t.common.loading : '—'}</p>
            )}
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
            <div className="tk-stat-label">{dc.weeklyInsight}</div>
            <div className="mt-4 flex gap-6">
              <div>
                <div className="tk-stat text-2xl text-[var(--accent-green)]">{weeklyInsight.bull}</div>
                <div className="tk-stat-label mt-1">Bullish</div>
              </div>
              <div>
                <div className="tk-stat text-2xl text-[var(--signal-sell)]">{weeklyInsight.bear}</div>
                <div className="tk-stat-label mt-1">Bearish</div>
              </div>
              <div>
                <div className="tk-stat text-2xl text-[var(--text-secondary)]">{weeklyInsight.neutral}</div>
                <div className="tk-stat-label mt-1">Neutral</div>
              </div>
            </div>
            <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
              <div className="h-full" style={{ width: `${bullPct}%`, background: 'var(--accent-green)' }} />
              <div className="h-full" style={{ width: `${bearPct}%`, background: 'var(--signal-sell)' }} />
              <div className="h-full" style={{ width: `${neutralPct}%`, background: 'var(--text-secondary)' }} />
            </div>
          </div>
        </div>

        {/* Opiniao livre, lida no /admin (aba Opinioes). So para quem ja fez
            ao menos uma analise (antes disso nao ha o que opinar) e nunca junto
            da pergunta de origem: um pedido por vez. */}
        {!isDemo && !showAcquisitionSurvey && dashboardKpis.total > 0 && <FeedbackCard />}

        {/* Heatmap de consistência — mecânica de hábito + card "printável" */}
        {!isDemo && <ActivityHeatmap />}
      </div>
    );
  };

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard':
        return renderDashboardHome();
      case 'new-analysis':
        return (
          <div className="flex flex-col gap-4">
            <div>
              {viewEyebrow(t.nav.newAnalysis)}
              <h1 className="tk-display mt-2 text-3xl md:text-4xl">{t.nav.newAnalysis}</h1>
            </div>
            {/* Primeira experiencia: em poucos segundos, o que a Tickrify faz,
                o que a pessoa envia e o que recebe. Some depois da 1a analise. */}
            {showSamples && (
              <section
                aria-labelledby="how-it-works-title"
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5"
              >
                <h2 id="how-it-works-title" className="text-sm font-semibold text-[var(--text-primary)]">
                  {t.onboarding.title}
                </h2>
                <ol className="mt-3 grid gap-3 md:grid-cols-3">
                  {[
                    [t.onboarding.step1Title, t.onboarding.step1Text],
                    [t.onboarding.step2Title, t.onboarding.step2Text],
                    [t.onboarding.step3Title, t.onboarding.step3Text],
                  ].map(([title, text], index) => (
                    <li key={title} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] font-terminal text-[11px] text-[var(--text-secondary)]">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                  {t.onboarding.note}
                </p>
              </section>
            )}
            {showSamples && savedDemo && (
              <section className="rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-card)] p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t.onboarding.demoTitle}</h2>
                  <span className="font-terminal text-xs text-[var(--text-secondary)]">
                    {`${savedDemo.symbol} · ${savedDemo.timeframe} · ${
                      savedDemo.recommendation === 'BUY' ? t.analysis.buy : savedDemo.recommendation === 'SELL' ? t.analysis.sell : t.analysis.hold
                    }`}
                  </span>
                </div>
                {savedDemo.recommendation !== 'WAIT' && (
                  <dl className="mt-3 grid grid-cols-3 gap-2 font-terminal text-xs">
                    {[
                      [t.onboarding.demoEntry, savedDemo.entry],
                      [t.onboarding.demoStop, savedDemo.stopLoss],
                      [t.onboarding.demoTp1, savedDemo.takeProfit1],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
                        <dt className="text-[var(--text-secondary)]">{label}</dt>
                        <dd className="mt-0.5 text-[var(--text-primary)]">{value == null ? 'n/a' : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{t.onboarding.demoNote}</p>
              </section>
            )}
            {showSamples && (
              <SamplePicker
                samples={SAMPLE_ANALYSES}
                viewed={viewedSamples}
                freeLeft={samplesFreeLeft}
                onOpen={openSampleAnalysis}
                onAnalyze={() => {
                  track('sample_cta_clicked', { viewed: viewedSamples.size, surface: 'picker' });
                  document.getElementById('new-analysis-upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
            )}
            {/* Gratis esgotado: o envio vira o paywall direto, em vez de deixar
                subir o print e so recusar depois. */}
            {freeLocked ? (
              paywallFor('new_analysis')
            ) : (
              <div id="new-analysis-upload" className="scroll-mt-24">
                <NewAnalysis key={analysisKey} onStartAnalysis={handleStartAnalysis} allowHigherTimeframes={!isDemo && isUnlimited} />
              </div>
            )}
          </div>
        );
      case 'sample': {
        const sample = SAMPLE_ANALYSES.find((s) => s.kind === route.param);
        if (!sample) return <Navigate to={`${base}${SECTION_PATH.new}`} replace />;
        return (
          <SampleAnalysisView
            sample={sample}
            samples={SAMPLE_ANALYSES}
            viewed={viewedSamples}
            freeLeft={samplesFreeLeft}
            onOpen={openSampleAnalysis}
            onBack={() => goTo('new')}
            onAnalyze={() => {
              track('sample_cta_clicked', { viewed: viewedSamples.size, surface: 'sample' });
              resetNewAnalysisView();
            }}
          />
        );
      }
      case 'my-trades':
        if (freeLocked) {
          // O servidor ja devolve so as ultimas concluidas; aqui so leitura,
          // sem marcar resultado nem favoritar.
          const readable = rawAnalyses.filter((a) => a.status === 'completed').slice(0, 3);
          return (
            <div className="flex flex-col gap-4">
              <div>
                {viewEyebrow(t.nav.myTrades)}
                <h1 className="tk-display mt-2 text-3xl md:text-4xl">{t.nav.myTrades}</h1>
              </div>
              {paywallFor(
                'trades',
                readable.length > 0 ? (
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
                    <p className="tk-stat-label mb-2">{t.paywall.recentTitle}</p>
                    {readable.map((a) => {
                      const action = getRecommendationMeta(a.recommendation);
                      const actionLabel = action.tone === 'buy' ? t.analysis.buy : action.tone === 'sell' ? t.analysis.sell : t.analysis.hold;
                      return (
                        <Link
                          key={a.id}
                          to={`${base}/analysis/${encodeURIComponent(a.id)}`}
                          className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] py-2.5 text-sm first:border-t-0 hover:text-[var(--text-primary)]"
                        >
                          <span className="font-terminal text-[var(--text-primary)]">
                            {`${String(a.symbol || 'N/A')} `}
                            <span className="text-xs text-[var(--text-secondary)]">{String(a.timeframe || '')}</span>
                          </span>
                          <span className="font-terminal text-xs text-[var(--text-secondary)]">
                            {`${actionLabel} · ${a.createdAt ? new Date(a.createdAt).toLocaleDateString(DATE_LOCALES[language] ?? 'en-US') : ''}`}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : undefined,
              )}
            </div>
          );
        }
        return <MyTrades onStartAnalysis={resetNewAnalysisView} initialFilter={myTradesFilter} />;
      case 'journal':
        if (freeLocked) {
          return (
            <div className="flex flex-col gap-4">
              <div>
                {viewEyebrow(t.nav.journal)}
                <h1 className="tk-display mt-2 text-3xl md:text-4xl">{t.nav.journal}</h1>
              </div>
              {paywallFor('journal')}
            </div>
          );
        }
        return <JournalCalendar onStartAnalysis={resetNewAnalysisView} />;
      case 'strategy':
        return <StrategyProfile />;
      case 'plans':
        return (
          <div className="flex flex-col gap-4">
            <div>
              {viewEyebrow(dc.plansTitle)}
              <h1 className="tk-display mt-2 text-3xl md:text-4xl">{dc.plansTitle}</h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{dc.plansSub}</p>
            </div>
            {/* Os MESMOS cards da /pricing (checkout, ciclos, codigo de
                parceiro e retomada depois do login), dentro do painel. */}
            <div className="tk-site overflow-hidden rounded-2xl">
              <div className="site-light px-4 py-8 md:px-8">
                <PricingCards />
              </div>
            </div>
          </div>
        );
      case 'analysis-result': {
        if (routeAnalysisId && !analysisInMemory) {
          if (resultLoad === 'locked') return paywallFor('history');
          return resultLoad === 'failed' ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t.nav.analysisNotFound}</AlertTitle>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => openMyTrades()}>{t.nav.myTrades}</Button>
                <Button variant="outline" onClick={resetNewAnalysisView}>
                  {t.nav.newAnalysis}
                </Button>
              </div>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--text-secondary)]">{t.common.loading}</p>
          );
        }
        // Gancho de retorno: depois do resultado, dar um próximo passo claro
        // (analisar outro / quantas grátis restam / assinar) — sem beco sem saída.
        const freeLeftKnown = !isUnlimited && Number.isFinite(remaining);
        const exhausted = freeLeftKnown && remaining <= 0;
        const showWaitNudge = !isDemo && freeLeftKnown && !exhausted && isWaitResult;

        // Qual análise a pergunta do veredito vai marcar.
        //
        // O id vem do `createAnalysis` (guardado em lastAnalysisId) e só cai
        // para o `analysisData` se aquele faltar. NUNCA deduzir pela lista:
        // a primeira versão fazia `rawAnalyses.find(completed)` e, quando o
        // refetch trocava quem era a mais recente, o clique marcava a análise
        // ERRADA — bug real, visto em produção em 28/07.
        const verdictTargetId = lastAnalysisId || analysisData?.id || null;
        const canAskVerdict =
          !isDemo &&
          !freeLocked &&
          !askDismissed &&
          Boolean(verdictTargetId) &&
          // Aguardar nao e operacao: "vai entrar nesta?" nao faz sentido e
          // marcar "vou entrar" criaria um trade aberto que nunca existiu.
          isTradeCall(analysisData?.recommendation) &&
          resolveVerdict({ id: String(verdictTargetId), outcome: analysisData?.outcome }, verdicts) === null;
        return (
          <div className="flex flex-col gap-4">
            {/* WAIT no plano gratis: o proximo passo vai para o TOPO. A mesma
                nota existia so no fim da pagina, e no celular (75% do trafego)
                ninguem chegava la: em set/26, 53 de 80 pessoas receberam WAIT
                na primeira analise e 25 viram um unico WAIT e nunca voltaram. */}
            {showWaitNudge && (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-card)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {dc.waitNudge.replace('{left}', String(remaining)).replace('{limit}', String(total))}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                    {dc.waitNudgeHint}{' '}
                    <a
                      href="/blog/how-tickrify-works/#wait"
                      target="_blank"
                      rel="noopener"
                      className="underline underline-offset-2 hover:text-[var(--text-primary)]"
                    >
                      {dc.waitNudgeWhy}
                    </a>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    track('wait_nudge_clicked', { freeRemaining: remaining });
                    resetNewAnalysisView();
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90"
                >
                  <PlusCircle className="h-4 w-4" /> {dc.waitNudgeCta}
                </button>
              </div>
            )}
            <AnalysisResult analysisData={analysisData} uploadedImage={uploadedImage} />
            {!isDemo && showAcquisitionSurvey && acquisitionSurvey}
            {!isDemo && (
              <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
                {/* Onda 2.2 — pergunta no único momento em que o usuário ainda
                    está olhando pro setup. NÃO perguntamos TP1/TP2/SL aqui: o
                    trade acabou de nascer, não há resposta possível, e cobrar
                    resultado agora ensina a ignorar o card. Só marcamos como
                    aberto — é isso que cria o pendente que cobramos depois. */}
                {canAskVerdict && verdictTargetId && (
                  <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{t.verdict.askTitle}</p>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.verdict.askHint}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => applyVerdict(String(verdictTargetId), 'OPEN')}
                      >
                        {t.verdict.askYes}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setAskDismissed(true)}
                        className="rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                      >
                        {t.verdict.askNo}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {freeLeftKnown && !exhausted && (
                    <p className="text-sm text-[var(--text-primary)]">
                      {t.counter.tradeCallsLeft.replace('{left}', String(remaining)).replace('{limit}', String(total))}
                    </p>
                  )}
                  {/* WAIT não consome análise com sinal: dizer isso no momento em
                      que a pessoa recebe um, senão ela lê o WAIT como gasto. */}
                  {freeLeftKnown && !exhausted && ['WAIT', 'HOLD'].includes(String(analysisData?.recommendation || '').toUpperCase()) && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.counter.waitFreeNote}</p>
                  )}
                  {freeLeftKnown && !exhausted && totalUsed !== null && totalLimit !== null && (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {t.counter.totalCapNote.replace('{limit}', String(totalLimit)).replace('{left}', String(Math.max(0, totalLimit - totalUsed)))}
                    </p>
                  )}
                  {exhausted && <p className="text-sm text-amber-500">{t.counter.exhausted}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {exhausted ? (
                    <>
                      {/* Mesmo checkout do paywall (semanal, a entrada mais barata).
                          Antes ia para /pricing e exigia mais um clique. */}
                      <Button size="sm" onClick={handleLastFreeCheckout} disabled={unlockPending}>
                        <Crown className="mr-2 h-4 w-4" />
                        {t.counter.subscribe}
                      </Button>
                      <Link
                        to={`${base}${SECTION_PATH.plans}`}
                        onClick={() => track('upgrade_cta_clicked', { source: 'last_free_result', destination: 'plans' })}
                        className="text-xs text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline"
                      >
                        {t.counter.viewPlans}
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={resetNewAnalysisView}
                        className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#050508] transition-opacity hover:opacity-90"
                      >
                        <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
                      </button>
                      {freeLeftKnown && (
                        <Link
                          to={`${base}${SECTION_PATH.plans}`}
                          onClick={() => track('upgrade_cta_clicked', { source: 'result_free_left', destination: 'plans', freeRemaining: remaining })}
                          className="text-xs text-[var(--text-secondary)] underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:underline"
                        >
                          {t.counter.viewPlans}
                        </Link>
                      )}
                    </>
                  )}
                </div>
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'locked':
        return paywallFor('new_analysis');
      case 'loading':
        return <AnalysisLoading chart={uploadedImage} />;
      case 'error':
        return (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{dc.analysisError}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button onClick={handleRetry}>{dc.tryAgain}</Button>
              <Button variant="outline" onClick={resetNewAnalysisView}>
                {t.nav.newAnalysis}
              </Button>
            </div>
          </div>
        );
      default:
        // Endereco desconhecido dentro do painel volta ao inicio do painel.
        return <Navigate to={base} replace />;
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
  // Plano gratis: o chip mostra quantas RESTAM ("2 free left"). Antes era
  // "1/3" e, no celular, sem a palavra ao lado: nao dava para saber se era
  // usadas ou restantes. O contador detalhado so existe na barra lateral, que
  // nao aparece no celular.
  // `remaining` ja considera o teto de 10 no total; `total - used` nao.
  const freeRemainingChip = safeTotal === null ? null : Number.isFinite(remaining) ? Math.max(0, remaining) : Math.max(0, safeTotal - safeUsed);
  const quotaText =
    freeRemainingChip === null ? `${safeUsed}/-` : `${freeRemainingChip} ${t.nav.freeLeft}`;
  // Item ativo do menu: sai da URL. Resultado e exemplos pertencem a "Nova analise".
  const activeNav: NavSection | null =
    route.section === 'sample' || route.section === 'analysis' ? 'new' : (route.section as NavSection | null);
  const currentViewLabel =
    activeNav === 'trades'
      ? t.nav.myTrades
      : activeNav === 'journal'
        ? t.nav.journal
        : activeNav === 'strategy'
          ? t.nav.strategy
          : activeNav === 'plans'
            ? t.nav.plans
            : activeNav === 'home'
              ? t.nav.dashboard
              : t.nav.newAnalysis;
  const sidebarSectionTitleClass = 'text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]';

  // Painel e area logada: titulo por area (aba do navegador e $title do
  // PostHog) e nunca indexavel. Fora do seo-routes.json de proposito.
  useSeo({
    title: `${currentViewLabel} | Tickrify`,
    description: 'Your Tickrify workspace.',
    path: location.pathname,
    noindex: true,
  });

  const navItemClass = (section: NavSection) =>
    `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
      activeNav === section ? 'bg-white text-[#050508]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'
    }`;
  const navLink = (section: NavSection) => `${base}${SECTION_PATH[section]}`;
  // "Nova analise" sempre abre o envio limpo, mesmo vindo de um erro ou resultado.
  const onNewAnalysisLink = (event: ReactMouseEvent) => {
    event.preventDefault();
    resetNewAnalysisView();
  };

  if (!bootDone.current) {
    const waiting = Boolean(user) && !bootTimedOut && (isPlanLoading || loadingAnalyses);
    if (waiting) return <BrandLoader />;
    bootDone.current = true;
  }

  return (
    <div className="relative z-10 flex min-h-screen w-full overflow-x-hidden bg-[var(--bg-base)]">
      {/* SIDEBAR (desktop) */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[var(--border-subtle)] md:flex">
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-4">
          <img src={officialIcon} alt="Tickrify" className="h-8 w-auto shrink-0 object-contain" />
          <div className="leading-none">
            <div className="text-sm font-bold tracking-wide text-[var(--text-primary)]">TICKRIFY</div>
            <div className="mt-1 font-terminal text-[8px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">{t.landing.hero.terminal}</div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-3">
          <div className={`${sidebarSectionTitleClass} px-2 pb-1 pt-2`}>{t.nav.workArea}</div>
          <nav className="flex flex-col gap-0.5">
            <Link to={navLink('home')} aria-current={activeNav === 'home' ? 'page' : undefined} className={navItemClass('home')}>
              <LayoutGrid className="h-4 w-4" /> {t.nav.dashboard}
            </Link>
            <Link to={navLink('new')} onClick={onNewAnalysisLink} aria-current={activeNav === 'new' ? 'page' : undefined} className={navItemClass('new')}>
              <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
            </Link>
            <Link to={navLink('trades')} aria-current={activeNav === 'trades' ? 'page' : undefined} className={navItemClass('trades')}>
              <History className="h-4 w-4" /> {t.nav.myTrades}
            </Link>
            <Link to={navLink('journal')} aria-current={activeNav === 'journal' ? 'page' : undefined} className={navItemClass('journal')}>
              <CalendarDays className="h-4 w-4" /> {t.nav.journal}
            </Link>
            <Link to={navLink('strategy')} aria-current={activeNav === 'strategy' ? 'page' : undefined} className={navItemClass('strategy')}>
              <Sliders className="h-4 w-4" /> {t.nav.strategy}
            </Link>
          </nav>


          {/* Gratis: contador das gratis. Assinante: saldo de ticks e
              "Manage subscription" (portal da Stripe, onde se cancela). Ate
              05/10/2026 so o gratis via este bloco, e o assinante nao tinha
              onde cancelar pelo painel, embora a /pricing prometesse. */}
          {user && (
            <div className="mt-4">
              <AnalysisCounter />
            </div>
          )}
        </div>

        {/* Plano e assinatura ficam no rodape, junto da conta. "Plans" abre os
            planos DENTRO do painel (/dashboard/plans): antes ia para a /pricing
            publica e o voltar do navegador tirava a pessoa do app. */}
        <div className="flex flex-col gap-0.5 border-t border-[var(--border-subtle)] px-3 py-2">
          {user && plan === 'free' && (
            <button type="button" onClick={() => openUpgradeModal('sidebar')} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]">
              <Crown className="h-4 w-4 text-[var(--accent-green)]" /> {dc.subscribeCta}
            </button>
          )}
          <Link
            to={navLink('plans')}
            aria-current={activeNav === 'plans' ? 'page' : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              activeNav === 'plans' ? 'bg-white text-[#050508]' : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" /> {t.nav.plans}
          </Link>
          <Link to="/affiliate" className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-primary)]">
            <Handshake className="h-3.5 w-3.5" /> {t.nav.affiliates}
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-2.5 border-t border-[var(--border-subtle)] p-3">
            <UserButton afterSignOutUrl="/" />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs text-[var(--text-primary)]">{user.firstName || user.fullName || 'Trader'}</div>
              <div className="font-terminal text-[8px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">{plan.toUpperCase()}{navbarUnlimited ? ` · ${t.nav.statusActive}` : ''}</div>
            </div>
          </div>
        )}
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Banner de Demo */}
      {isDemo && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-3 text-center font-medium sticky top-0 z-50 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center justify-center rounded-full bg-primary/15 p-1.5">
              <FlaskConical className="h-4 w-4 text-primary" />
            </span>
            <span className="text-foreground">{dc.demoMode}</span>
            <Link to="/" className="text-primary underline underline-offset-2 hover:no-underline font-semibold">
              {dc.demoLogin}
            </Link>
          </div>
        </div>
      )}
      
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[#050508]/95 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={user ? "/dashboard" : "/"} className="md:hidden">
            <img src={officialIcon} alt="Tickrify" className="h-7 w-auto shrink-0 object-contain" />
          </Link>
          <span className="hidden items-center gap-2 font-terminal text-[11px] uppercase tracking-[0.14em] md:flex">
            <span className="text-[var(--text-secondary)]">{t.nav.workspace}</span>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-[var(--text-primary)]">{currentViewLabel}</span>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 overflow-visible text-sm md:gap-3">
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-[var(--accent-green)]' : 'bg-red-500'}`} />
            <span className={`font-terminal text-[11px] ${isOnline ? 'text-[var(--accent-green)]' : 'text-red-500'}`}>
              {isOnline ? t.common.online : t.common.offline}
            </span>
          </div>

          {user && <TicksBadge />}

          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-sm font-medium">
            <Zap className="h-3.5 w-3.5 text-[var(--accent-green)]" />
            <span className="whitespace-nowrap">{navbarUnlimited ? plan.toUpperCase() : quotaText}</span>
            <span className="hidden whitespace-nowrap text-[var(--text-secondary)] md:inline">
              {navbarUnlimited ? `· ${t.nav.statusActive}` : ''}
            </span>
          </div>

          <LanguageSwitcher />

          {user && (
            <div className="shrink-0 md:hidden">
              <UserButton afterSignOutUrl="/" />
            </div>
          )}
        </div>
      </header>

      <LiveTape />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border md:hidden">
          <div className="flex">
            {(['home', 'new', 'trades', 'journal', 'strategy'] as const).map((section) => (
              <Link
                key={section}
                to={navLink(section)}
                onClick={section === 'new' ? onNewAnalysisLink : undefined}
                aria-current={activeNav === section ? 'page' : undefined}
                className={`min-w-0 flex-1 truncate px-1 py-2 text-center text-[11px] font-medium leading-tight transition-colors ${
                  activeNav === section
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                {section === 'home'
                  ? t.nav.dashboard
                  : section === 'new'
                    ? t.nav.newAnalysisShort
                    : section === 'trades'
                      ? t.nav.myTrades
                      : section === 'journal'
                        ? t.nav.journalShort
                        : t.nav.strategy}
              </Link>
            ))}
          </div>
          {/* Celular (sem barra lateral): o assinante ve o plano e o "Manage
              subscription" no inicio e nos Planos. */}
          {user && plan !== 'free' && !isPlanLoading && (activeNav === 'home' || activeNav === 'plans') && (
            <div className="p-3">
              <AnalysisCounter />
            </div>
          )}
          {user && plan === 'free' && (
            <div className="p-3">
              <Button
                className="w-full"
                variant="outline"
                onClick={() => openUpgradeModal('cta')}
              >
                <Crown className="mr-2 h-4 w-4" />
                {dc.subscribeCta}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-y-auto p-3 md:p-6">
            <div className="flex flex-col gap-6 md:gap-8">
              {/* Uma area que quebra nao derruba o painel inteiro: o menu
                  continua funcionando, trocar de area remonta (key) e o erro
                  vai para o Sentry com a area e se a pagina estava traduzida. */}
              <Sentry.ErrorBoundary
                key={location.pathname}
                beforeCapture={(scope) => {
                  scope.setTag('dashboard_area', route.section ?? 'unknown');
                  scope.setTag('dashboard_view', activeView ?? 'unknown');
                  scope.setTag('page_translated', isPageTranslated() ? 'yes' : 'no');
                }}
                fallback={({ resetError }) => (
                  <div role="alert" className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6">
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{t.nav.viewCrashTitle}</p>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.nav.viewCrashDesc}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={resetError}>{t.nav.viewCrashRetry}</Button>
                      <Button variant="outline" onClick={() => window.location.reload()}>
                        {t.nav.viewCrashReload}
                      </Button>
                    </div>
                  </div>
                )}
              >
                {renderContent()}
              </Sentry.ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
      </div>

      {/* Modal de Upgrade */}
      <Dialog open={showUpgradeModal} onOpenChange={setShowUpgradeModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              {dc.choosePlan}
            </DialogTitle>
            <DialogDescription>
              {dc.planSub}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {/* Semanal primeiro e em destaque (05/10/2026): 13 abriram o
                checkout em 14 dias e 1 pagou, quase todos de paises onde
                US$ 29 de uma vez pesa. O mensal continua logo abaixo. */}
            <button
              type="button"
              onClick={handleModalWeekly}
              disabled={unlockPending}
              className="flex w-full items-center justify-between rounded-lg border border-primary bg-primary/10 px-4 py-3 text-left transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <Crown className="h-4 w-4 flex-shrink-0 text-primary" />
                <span className="text-sm font-semibold">{dc.modalWeekly}</span>
              </span>
              <span className="text-right text-xs font-semibold">$7.99</span>
            </button>
            <button
              type="button"
              onClick={handleModalMonthly}
              disabled={unlockPending}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
            >
              <span className="text-sm font-semibold">{dc.modalMonthly}</span>
              <span className="text-right text-xs font-semibold">
                {modalFirstMonth ? dc.modalMonthlyOffer.replace('{price}', `$${modalFirstMonth}`) : `$29${dc.perMonth}`}
              </span>
            </button>
          </div>

          <UpgradeVideo surface="upgrade_modal" caption={dc.modalVideoCaption} />

          <DialogFooter className="sm:flex-col gap-2">
            <Button variant="outline" className="w-full" onClick={goToPlans}>
              {dc.modalCompare}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setShowUpgradeModal(false)}>
              {dc.later}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DashboardPage;
