import { formatNumber, formatUsd } from '@/lib/i18n';
import { errorText } from '@/lib/i18n/messages';
import { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { History, CalendarDays, Eye, PlusCircle, Crown, AlertCircle, FlaskConical, LayoutGrid, CreditCard, Upload, Sliders, Handshake, MessageCircle, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NewAnalysis from "../dashboard/NewAnalysis";
import EmptyState from '@/components/dashboard/EmptyState';
import AcquisitionSurvey from '@/components/dashboard/AcquisitionSurvey';
import FeedbackCard from '@/components/dashboard/FeedbackCard';
import FeedbackRewardCard from '@/components/dashboard/FeedbackRewardCard';
import ExtensionAnnouncement from '@/components/dashboard/ExtensionAnnouncement';
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
import { TrackRecordCard } from "../dashboard/MarketResult";
import MyTrades from "../dashboard/MyTrades";
import JournalCalendar from "../dashboard/JournalCalendar";
import StrategyProfile from "../dashboard/StrategyProfile";
import AnalysisResult from "../dashboard/AnalysisResult";
import Paywall, { type PaywallSurface } from "../dashboard/Paywall";
import AnalysisLoading from "../dashboard/AnalysisLoading";
import AnalysisCounter from "../dashboard/AnalysisCounter";
import CheckoutConfirmation from "../dashboard/CheckoutConfirmation";
import PaymentFailedBanner from "../dashboard/PaymentFailedBanner";
import { TicksBadge } from "@/components/dashboard/TicksBadge";
import { PlanUnavailableNotice } from '@/components/dashboard/PlanUnavailableNotice';
import RatingCard from '@/components/dashboard/RatingCard';
import { useAnalysisLimit, useIncrementAnalysis } from "@/hooks/useAnalysisLimit";
import { APIError, isFreeQuotaExhausted, useAPIClient, type AIAnalysisResponse } from "@/lib/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnalysisProcessingError, analysisFailureTelemetry } from "@/lib/analysis-failure";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { DiscordIcon } from "@/components/ui/DiscordIcon";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { afterNextPaint, asRecord, isPageTranslated, scrollToTop } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { entrySide, getRecommendationMeta, historicalPrintOf, resolveSignalState, signalStateLabel } from "@/lib/trading-ui";
import { useAnalyses } from "@/hooks/useAnalyses";
import { useTicks } from "@/hooks/useTicks";
import { COMMUNITY_URL, track, trackCommunityClick } from "@/lib/analytics";
import { CheckoutError, createCheckoutSession, openBillingPortal } from "@/lib/stripe";
import { clerkLightAppearance, useTheme } from "@/lib/theme";
import SettingsPage from "../dashboard/SettingsPage";
import { checkoutReturnPath, loadCheckoutIntent } from "@/lib/checkoutIntent";
import { useFoundingOffer } from "@/hooks/useFoundingOffer";
import UpgradeVideo from "../dashboard/UpgradeVideo";
import { SampleAnalysisView, SamplePicker, type SampleAllowance } from "../dashboard/SampleAnalyses";
import { SAMPLE_ANALYSES, type SampleKind } from "@/lib/sample-analyses";
import { PricingCards } from "@/components/pricing/PricingCards";
import { useSeo } from "@/hooks/useSeo";
import { loadSavedDemoResult } from "@/lib/demo-api";
import SetupAlertBar from "../dashboard/SetupAlertBar";
import { isWatchPlan } from "../dashboard/WatchPlanCard";
import TodaySection from "../dashboard/TodaySection";
import MyAssets from "../dashboard/MyAssets";
import SetupsSection from "../dashboard/SetupsSection";
import WatchingPage from "../dashboard/WatchingPage";
import SetupPage from "../dashboard/SetupPage";
import TradePanel from "../dashboard/TradePanel";
import { displayAsset, tradeQueryKey, type OpenTrade, type TradeCloseReason } from "@/lib/api";
import { SETUP_ID_PATTERN, formatSetupDay, useExpiryClock, isWatchOpen, useAlertActions, useAlertTabTitle, useSetupAlerts, useSetupVersions, useWatchAssets } from "@/lib/setups";
import { openChat, useChatThread } from "@/lib/support-chat";

// Textos do dashboard que estavam hardcoded em PT — agora EN por padrão (público global),
// PT quando o idioma for português. Contido neste arquivo (sem mexer nos 6 locales).
/** Nome do item ao passar o mouse ou focar pelo teclado, com a barra recolhida (o leitor de tela le o rotulo sr-only). */
function SideTooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="tk-side-tip pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs font-normal text-[var(--text-primary)] opacity-0 shadow-md transition-opacity"
    >
      {label}
    </span>
  );
}

type SideBadge = { key: string; value: string; label: string; tone: 'accent' | 'inverse' };

/**
 * Icone, nome e contador de um item da barra lateral. Recolhida: o nome fica
 * so para leitor de tela e no tooltip, e o contador vira badge no icone.
 */
function SideItemBody({ collapsed, icon, label, badge = null }: { collapsed: boolean; icon: ReactNode; label: string; badge?: SideBadge | null }) {
  const tone = badge?.tone === 'accent' ? 'bg-[var(--accent-green)] text-[var(--on-accent)]' : 'bg-[var(--inverse-bg)] text-[var(--inverse-fg)]';
  return (
    <>
      <span className="relative flex shrink-0 items-center">
        {icon}
        {collapsed && badge ? (
          <span key={badge.key} aria-label={badge.label} className={`absolute -right-2.5 -top-2 min-w-[16px] rounded-full px-1 text-center text-[9px] font-semibold leading-[16px] ring-2 ring-[var(--bg-base)] ${tone}`}>
            {badge.value}
          </span>
        ) : null}
      </span>
      <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
      {!collapsed && badge ? (
        <span key={badge.key} aria-label={badge.label} className={`ml-auto min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-semibold leading-[18px] ${tone}`}>
          {badge.value}
        </span>
      ) : null}
      {collapsed && <SideTooltip label={label} />}
    </>
  );
}


import officialIcon from "@/assets/tickrify-icon-official.png";
import BrandLoader from "../ui/BrandLoader";

const DATE_LOCALES: Record<string, string> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP',
};

type View = 'dashboard' | 'new-analysis' | 'sample' | 'my-trades' | 'journal' | 'watching' | 'strategy' | 'plans' | 'settings' | 'setup' | 'analysis-result' | 'loading' | 'error' | 'locked';

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
 *   /dashboard/watching           WATCH valendo, preco chegou, setups seguidos e encerrados
 *   /dashboard/strategy           perfil de estrategia
 *   /dashboard/plans              planos, sem sair do painel
 *   /dashboard/settings           conta, assinatura (portal da Stripe) e tema
 *   /dashboard/setups/:id         um setup acompanhado e as versoes dele
 *   /dashboard/new?setup=:id      atualizar esse setup (o envio de sempre)
 */
type Section = 'home' | 'new' | 'sample' | 'analysis' | 'trades' | 'journal' | 'watching' | 'strategy' | 'plans' | 'settings' | 'setups';
type NavSection = 'home' | 'new' | 'trades' | 'journal' | 'watching' | 'strategy' | 'plans' | 'settings';
const SECTION_PATH: Record<NavSection, string> = {
  home: '',
  new: '/new',
  trades: '/trades',
  journal: '/journal',
  watching: '/watching',
  strategy: '/strategy',
  plans: '/plans',
  settings: '/settings',
};

function parseDashboardPath(pathname: string): { base: string; section: Section | null; param: string | null } {
  const [, root = 'dashboard', ...rest] = pathname.replace(/\/+$/, '').split('/');
  const base = root === 'demo' ? '/demo' : '/dashboard';
  const [first, second, third] = rest;
  if (!first) return { base, section: 'home', param: null };
  if (first === 'new' && !second) return { base, section: 'new', param: null };
  if (first === 'new' && second === 'example' && third && rest.length === 3) return { base, section: 'sample', param: third };
  if (first === 'analysis' && second && rest.length === 2) return { base, section: 'analysis', param: decodeURIComponent(second) };
  if (first === 'setups' && second && rest.length === 2) return { base, section: 'setups', param: decodeURIComponent(second) };
  if (rest.length === 1 && ['trades', 'journal', 'watching', 'strategy', 'plans', 'settings'].includes(first)) {
    return { base, section: first as Section, param: null };
  }
  return { base, section: null, param: null };
}

/** Estado da tela de nova analise, que nao tem URL propria (e passageiro). */
type NewFlow = 'idle' | 'loading' | 'error' | 'locked' | 'result';
type MyTradesFilter = 'all' | 'pending' | 'favorites' | Verdict;

/** Exemplos que a pessoa ja abriu, para o "Vista" sobreviver a recarga. */
const SAMPLES_VIEWED_KEY = 'tickrify_samples_viewed';
// Barra lateral recolhida (so icones): escolha do aparelho. Sem storage, abre expandida.
const SIDEBAR_COLLAPSED_KEY = 'tickrify_sidebar_collapsed';
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

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

/** Mesmo ativo, sem o prefixo da corretora e sem separador (FX:XAUUSD = XAU/USD). */
function sameAssetName(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) =>
    displayAsset(v).toUpperCase().replace(/(\.P|PERP)$/, '').replace(/[^A-Z0-9]/g, '');
  const x = norm(a);
  return x !== 'NA' && x !== '' && x === norm(b);
}

const DashboardPage = () => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const dc = t.dashboardCopy;
  // Preço do 1º mês com o EARLY35, só quando a Stripe diz que o cupom está ativo.
  const foundingOffer = useFoundingOffer();
  const modalFirstMonth = foundingOffer?.percentOff ? formatUsd(29 * (1 - foundingOffer.percentOff / 100), language) : null;
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* sem storage: vale so nesta visita */
      }
      return next;
    });
  };
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const { plan, total, used, isUnlimited, remaining, analysesAllTime, totalUsed, totalLimit, freeLocked, formerSubscriber, billingManageable, trial, trialBlocked, feedbackRewardAvailable, isLoading: isPlanLoading, isUnavailable: isUsageUnavailable, retry: retryUsage } = useAnalysisLimit();
  const [theme] = useTheme();
  // Trial de 3 dias: qual paywall mostrar (volte amanha ou trial encerrado).
  const trialVariant: 'daily_limit' | 'trial_ended' | undefined = trial
    ? trial.status === 'ended'
      ? 'trial_ended'
      : trial.paywall === 'daily_limit'
        ? 'daily_limit'
        : undefined
    : undefined;
  const queryClient = useQueryClient();
  const incrementAnalysis = useIncrementAnalysis();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const apiClient = useAPIClient();
  const isDemo = !user;
  // Operacoes pendentes/abertas: aviso no resultado de outro grafico do mesmo ativo.
  const openTradesQuery = useQuery({
    queryKey: ['trades-open'],
    queryFn: () => apiClient.listOpenTrades(),
    enabled: !isDemo,
    staleTime: 60_000,
    retry: false,
  });
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
  // Grafico novo com operacao aberta do mesmo ativo: perguntar antes de analisar
  // (estado da operacao, 13/10/2026). `step` = qual pergunta esta na tela.
  const [followUp, setFollowUp] = useState<{
    trade: OpenTrade;
    step: 'is_follow_up' | 'still_open' | 'close_reason';
    params: { imageUrl: string | null; imageFile: File | null; htfBase64Images: string[]; analysisType: 'quick' | 'deep' };
  } | null>(null);
  const [followUpReason, setFollowUpReason] = useState<TradeCloseReason>('manual');
  const [followUpBusy, setFollowUpBusy] = useState(false);
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

  // Contagem REAL do banco quando chega (o /usage); antes disso, o que der para
  // contar da lista carregada (useAnalyses(40) nunca passaria de 40).
  const analysesTotal = analysesAllTime ?? rawAnalyses.filter((a) => a.status === 'completed').length;

  const { balance: ticksBalance } = useTicks();
  // Respostas do fundador ainda nao lidas (o mesmo numero da bolha do chat).
  const chatUnread = useChatThread(!isDemo, false).data?.thread?.unread ?? 0;

  // Alertas de nivel (27/10/2026): o bloco Today, o contador no menu e no
  // titulo da aba, e o paywall `alerts` da conta travada.
  const alertsQuery = useSetupAlerts(!isDemo, null, { background: true });
  // My assets: a pessoa pode indicar qual ativo e o grafico que esta enviando.
  const watchAssetsQuery = useWatchAssets(!isDemo);
  const assetHintRef = useRef<{ symbol: string; timeframe: string } | null>(null);
  const alertsUnseen = alertsQuery.data?.unseen ?? 0;
  const { seen: markAlertSeen } = useAlertActions();
  const watchedSetupIds = useMemo(
    () => new Set((alertsQuery.data?.items ?? []).filter((a) => a.status === 'active').map((a) => a.setupId)),
    [alertsQuery.data],
  );
  const alertsOn: 'email' | 'screen' | null = watchedSetupIds.size > 0 ? (alertsQuery.data?.emailEnabled ? 'email' : 'screen') : null;

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
    !isPlanLoading &&
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
  // Atualizacao de setup: /dashboard/new?setup=<id>. O setup so vai junto se
  // a pessoa ainda o acompanha; o servidor confere de novo antes de cobrar.
  const setupParam = route.section === 'new' ? new URLSearchParams(location.search).get('setup') : null;
  // Link do e-mail do alerta: /dashboard/new?setup=<id>&alert=<id>&utm_source=email.
  const alertParam = route.section === 'new' ? new URLSearchParams(location.search).get('alert') : null;
  const openedAlertRef = useRef<string | null>(null);
  useEffect(() => {
    if (isDemo || !alertParam || !SETUP_ID_PATTERN.test(alertParam) || openedAlertRef.current === alertParam) return;
    openedAlertRef.current = alertParam;
    const utm = new URLSearchParams(location.search).get('utm_source');
    const source = utm === 'email' || utm === 'telegram' ? utm : 'dashboard';
    track('setup_alert_opened', { source, alertId: alertParam, setupId: setupParam });
    markAlertSeen.mutate(alertParam);
  }, [alertParam, isDemo, location.search, markAlertSeen, setupParam]);
  const updatingSetupId = setupParam && SETUP_ID_PATTERN.test(setupParam) && !isDemo ? setupParam : null;
  const updatingSetupQuery = useSetupVersions(updatingSetupId, 1);
  const updatingSetupPage = updatingSetupQuery.data?.pages[0];
  const updatingWatch = updatingSetupPage?.versions[0]?.watch;
  const setupNow = useExpiryClock(Date.parse(updatingWatch?.expiresAt ?? ''));
  const updatingSetup = updatingSetupPage?.setup.status === 'tracking' ? updatingSetupPage : null;

  // Sinais gratis que ainda restam (o /usage ja desconta); 3 enquanto carrega.
  const samplesFreeLeft = Number.isFinite(remaining) ? Math.max(0, remaining) : (total ?? 3);
  const sampleAllowance: SampleAllowance = isDemo
    ? { kind: 'demo' }
    : isPlanLoading
      ? { kind: 'loading' }
      : isUsageUnavailable || trialBlocked
        ? { kind: 'unavailable' }
        : isUnlimited
          ? { kind: 'paid' }
          : trial
            ? { kind: 'trial', trial }
            : formerSubscriber
              ? { kind: 'former' }
              : { kind: 'legacy', remaining: samplesFreeLeft };

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
      case 'watching':
        return 'watching';
      case 'strategy':
        return 'strategy';
      case 'plans':
        return 'plans';
      case 'settings':
        return 'settings';
      case 'setups':
        return 'setup';
      default:
        return null;
    }
  })();

  // Usar dados demo ou reais dependendo do modo

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
        // Ja tem assinatura: vender de novo nao serve. Em `past_due`/`unpaid`
        // (renovacao recusada) e quem quer pagar de novo, e o unico caminho e o
        // cartao novo pelo portal, que mora em Configuracoes (19/10/2026: um
        // assinante com a renovacao recusada tentou assinar duas vezes pelo
        // celular e ficou no toast, sem saida).
        toast({ title: dc.alreadySubscribedTitle, description: dc.alreadySubscribedDesc });
        goTo('settings');
        return;
      }
      toast({ title: dc.checkoutErrorTitle, description: errorText(t, language, error, dc.checkoutErrorTitle), variant: 'destructive' });
      // Cai nos Planos do painel, nunca num beco: la tem o mesmo botao.
      goTo('plans');
    } finally {
      setUnlockPending(false);
    }
  }, [unlockPending, getToken, goTo, toast, dc, t, language]);

  // Todo paywall fecha no mesmo checkout (`locked_value` na Stripe); a area de
  // onde veio vai junto para o PostHog.
  const paywallFor = (surface: PaywallSurface, children?: ReactNode, symbol?: string) => (
    <div className="flex flex-col gap-4">
      {/* Opiniao que vale 3 analises: com destaque, antes do paywall. */}
      {feedbackRewardAvailable ? <FeedbackRewardCard source="limit" prominent /> : null}
    <Paywall
      surface={surface}
      symbol={symbol}
      alertsOn={alertsOn}
      onWeekly={() => void startCheckout('locked_value', 'weekly', surface)}
      onMonthly={() => void startCheckout('locked_value', 'monthly', surface)}
      unlockPending={unlockPending}
      plansHref={`${base}${SECTION_PATH.plans}`}
      variant={trialVariant}
    >
      {children}
    </Paywall>
    </div>
  );
  // Janela de upgrade: checkout direto, como no paywall. Antes o unico botao
  // levava para a /pricing (um passo a mais) e so mostrava o mensal de US$ 29.
  const handleModalMonthly = useCallback(() => void startCheckout('upgrade_modal'), [startCheckout]);
  const handleModalWeekly = useCallback(() => void startCheckout('upgrade_modal', 'weekly'), [startCheckout]);

  // A pessoa VIU a oferta depois da ultima gratis? Uma vez por analise. Sem
  // isto so dava para medir o clique, nunca quem viu e ignorou. Enquanto o plano
  // carrega, `remaining` e 0 para todo mundo (ate assinante): sem esperar, o
  // recarregar de /dashboard/analysis/:id contava uma oferta que ninguem viu.
  // Pela URL, so conta com a analise JA na tela: antes contava uma vez com a
  // chave 'unknown' enquanto carregava e outra quando chegava (07/10/2026), e
  // contava ate quando a analise caia no paywall.
  const lastFreeCtaSeenFor = useRef<string | null>(null);
  useEffect(() => {
    if (activeView !== 'analysis-result' || isDemo || isUnlimited || isPlanLoading) return;
    if (!Number.isFinite(remaining) || remaining > 0) return;
    const key = route.section === 'analysis' ? (analysisInMemory ? routeAnalysisId : null) : lastAnalysisId || 'unknown';
    if (!key || lastFreeCtaSeenFor.current === key) return;
    lastFreeCtaSeenFor.current = key;
    track('upgrade_cta_viewed', { source: 'last_free_result' });
  }, [activeView, isDemo, isUnlimited, isPlanLoading, remaining, lastAnalysisId, route.section, analysisInMemory, routeAnalysisId]);
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
    /** A pessoa ja respondeu que NAO e acompanhamento da operacao aberta. */
    skipFollowUpCheck = false,
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

    const setupId = updatingSetup?.setup.id;

    // Operacao aberta do MESMO ativo: quem decide se e acompanhamento e o
    // trader, nunca a imagem sozinha. Sem operacao aberta, nada muda.
    if (!skipFollowUpCheck && !setupId) {
      const open = await apiClient.listOpenTrades().catch(() => ({ trades: [] as OpenTrade[] }));
      if (open.trades.length > 0) {
        const match = await apiClient
          .matchTrade({ imageFile: imageFile ?? undefined, base64Image: imageFile ? undefined : imageUrl ?? undefined })
          .catch(() => null);
        if (match && match.matches.length > 0) {
          setFollowUp({ trade: match.matches[0], step: 'is_follow_up', params: { imageUrl, imageFile, htfBase64Images, analysisType } });
          return;
        }
      }
    }

    // Memoriza o envio para o retry manter o mesmo gráfico e contexto.
    lastAnalysisParamsRef.current = { imageUrl, imageFile, htfBase64Images, analysisType };

    const startedAt = performance.now();
    // Posicao na cota gratis contando WAIT (`used` conta so BUY/SELL e repetia
    // "1" depois de um WAIT). Lida antes do envio: o refresh depois da criacao
    // ja inclui a analise em andamento e o inicio e a conclusao saem iguais.
    const analysisNumber = !isUnlimited && typeof totalUsed === 'number'
      && Number.isSafeInteger(totalUsed) && totalUsed >= 0
      ? totalUsed + 1 : null;
    const analysisNumberSource = analysisNumber === null ? null : 'free_quota_total';
    try {
      setUploadedImage(imageUrl);
      setFlow('loading');
      setErrorMessage('');

      if (setupId) track('setup_update_submitted', { setupId });
      track('analysis_started', {
        analysisType,
        plan,
        // O backend emite o mesmo fato como `free_analysis_started`, numerado
        // pelo banco; a origem separa esta contagem dos eventos antigos (por sinais).
        analysisNumber,
        analysisNumberSource,
        freeRemainingBefore: isUnlimited || !Number.isFinite(remaining) ? null : remaining,
      });

      const uploadStartedAt = performance.now();
      const response = await apiClient.createAnalysis({
        imageFile: imageFile || undefined,
        base64Image: imageUrl || undefined,
        userLanguage: language,
        htfBase64Images: htfBase64Images.length > 0 ? htfBase64Images : undefined,
        analysisType,
        setupId,
        hintSymbol: assetHintRef.current?.symbol,
        hintTimeframe: assetHintRef.current?.timeframe,
      });
      // A dica vale para UM grafico: o proximo envio comeca sem ela.
      assetHintRef.current = null;

      const uploadMs = Math.round(performance.now() - uploadStartedAt);

      // Incrementar contador (apenas quando logado)
      incrementAnalysis();

      setLastAnalysisId(response.id);
      const analysis = await apiClient.waitForAnalysisCompletion(response.id, response);

      if (analysis.status === 'failed') {
        throw new AnalysisProcessingError(
          analysis.errorMessage || analysis.reasoning || dc.analysisFailed,
          analysis.errorCode,
          analysis.errorDetails,
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
      // Versao do motor, validador e tempo de cada etapa no servidor
      // (`result.engine`, engine-contract.ts no backend). Analise de antes do
      // motor 2.0.0 nao tem o bloco: as propriedades vao null.
      const engine = asRecord(asRecord(analysis.fullResponse).engine);
      const timings = asRecord(engine.timings);
      const msOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
      // ATIVAÇÃO: resultado renderizado com sucesso (apenas usuário logado).
      // Sai depois do proximo quadro pintado: `verdict_visible_ms` e o tempo
      // do clique em analisar ate o veredito estar na tela (ate 1 s de espera).
      const completedProps = {
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
        // Mesmo numero do inicio; assinante ou contador desconhecido = null.
        analysisNumber,
        analysisNumberSource,
        durationMs: Math.round(performance.now() - startedAt),
        engine_version: typeof engine.version === 'string' ? engine.version : null,
        data_mode: typeof engine.data_mode === 'string' ? engine.data_mode : null,
        validator_action: typeof engine.validator_action === 'string' ? engine.validator_action : null,
        // Estado do v10 e motivos de cada rebaixamento (signal-decision.ts no backend).
        signal_state: typeof engine.signal_state === 'string' ? engine.signal_state : null,
        validator_reasons: Array.isArray(engine.validator_reasons) ? engine.validator_reasons : [],
        // Regras que so medem (ex.: stop antes da invalidacao), sem mudar o sinal.
        validator_flags: Array.isArray(engine.validator_flags) ? engine.validator_flags : [],
        upload_ms: uploadMs,
        image_prep_ms: msOrNull(timings.image_prep_ms),
        intake_ms: msOrNull(timings.intake_ms),
        queue_ms: msOrNull(timings.queue_ms),
        prompt_ms: msOrNull(timings.prompt_ms),
        grounding_ms: msOrNull(timings.grounding_ms),
        model_ms: msOrNull(timings.model_ms),
        parse_ms: msOrNull(timings.parse_ms),
        validation_ms: msOrNull(timings.validation_ms),
        server_total_ms: msOrNull(timings.server_total_ms),
      };
      afterNextPaint((painted) => {
        track('analysis_completed', {
          ...completedProps,
          // null = a aba estava em segundo plano (nada foi pintado a tempo).
          verdict_visible_ms: painted ? Math.round(performance.now() - startedAt) : null,
        });
      });
      if (!isDemo && user) {
        refetchAnalyses();
      }
      // Nova versao de setup: a lista do inicio e a pagina do setup releem.
      if (setupId) void queryClient.invalidateQueries({ queryKey: ['setups'] });
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
      if (setupId) track('setup_update_failed', { setupId, code: analysisFailureTelemetry(error).code });
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
        // Trial de 3 dias: limite do dia e fim mostram o paywall certo (o /usage
        // relido decide a variante); fila e anti-abuso mostram a mensagem.
        if (apiCode === 'TRIAL_DAILY_LIMIT' || apiCode === 'TRIAL_ENDED') {
          track('free_limit_reached', { reason: apiCode });
          setFlow('locked');
          return;
        }
        if (apiCode === 'TRIAL_BUSY') {
          setErrorMessage(t.paywall.trialBusy);
          setFlow('error');
          return;
        }
        if (apiCode === 'TRIAL_EMAIL_NOT_ALLOWED' || apiCode === 'TRIAL_EMAIL_UNVERIFIED' || apiCode === 'TRIAL_NETWORK_LIMIT') {
          setErrorMessage(String(parsedBody?.message || error.message || dc.analysisUnknownError));
          setFlow('error');
          return;
        }
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
      } else if (error instanceof APIError && error.code === 'setup_not_tracking') {
        setErrorMessage(t.setups.updateNotFollowed);
      } else if (error instanceof APIError && error.code === 'setup_not_found') {
        setErrorMessage(t.setups.updateNotFound);
      } else {
        setErrorMessage(errorText(t, language, error, dc.analysisUnknownError));
      }
      setFlow('error');
    }
  };

  // Pergunta de acompanhamento (estado da operacao). "Sim": confere a operacao
  // com o grafico novo e abre a pagina dela. "Nao": pergunta se a anterior
  // continua aberta e segue com a analise nova, independente.
  const answerFollowUpYes = async () => {
    if (!followUp) return;
    const { trade, params } = followUp;
    setFollowUpBusy(true);
    try {
      const { view } = await apiClient.checkTrade(trade.analysisId, {
        imageFile: params.imageFile ?? undefined,
        base64Image: params.imageFile ? undefined : params.imageUrl ?? undefined,
        userLanguage: language,
      });
      queryClient.setQueryData(tradeQueryKey(trade.analysisId), view);
      void queryClient.invalidateQueries({ queryKey: ['trades-open'] });
      incrementAnalysis();
      setFollowUp(null);
      navigate(`${base}/analysis/${encodeURIComponent(trade.analysisId)}`);
    } catch (error) {
      toast({ title: t.trade.error, description: errorText(t, language, error, t.trade.error), variant: 'destructive' });
    } finally {
      setFollowUpBusy(false);
    }
  };
  const continueAsNewAnalysis = () => {
    if (!followUp) return;
    const { params } = followUp;
    setFollowUp(null);
    void handleStartAnalysis(params.imageUrl, params.imageFile, params.htfBase64Images, params.analysisType, true);
  };
  const closePreviousAndContinue = async () => {
    if (!followUp) return;
    setFollowUpBusy(true);
    try {
      await apiClient.markTrade(followUp.trade.analysisId, { status: 'closed', closeReason: followUpReason });
      void queryClient.invalidateQueries({ queryKey: ['trades-open'] });
      void queryClient.invalidateQueries({ queryKey: ['analyses'] });
      continueAsNewAnalysis();
    } catch (error) {
      toast({ title: t.trade.error, description: errorText(t, language, error, t.trade.error), variant: 'destructive' });
    } finally {
      setFollowUpBusy(false);
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
    <div className="tk-eyebrow">
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
    const firstName = user?.firstName || 'Trader';
    const ticksNum = Math.floor(Number(ticksBalance) || 0);
    return (
      <div className="flex flex-col gap-4">
        {/* Cockpit hero: o titulo da pagina e o UNICO "New Analysis" do inicio. */}
        <div
          className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 md:p-8"
          style={{ backgroundImage: 'radial-gradient(ellipse 720px 320px at 100% 0%, rgba(0,232,122,0.06), transparent 60%)' }}
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="tk-eyebrow">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-green)]" />
                {t.nav.greeting}, {firstName}
              </div>
              <h1 className="tk-display mt-2 text-[28px] md:text-4xl">{t.nav.centralTitle}</h1>
              <p className="mt-2 tk-meta tabular-nums">
                {ticksNum} ticks · {analysesTotal} {t.nav.analysesWord}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => goTo('journal')}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--fill-2)]"
              >
                <CalendarDays className="h-4 w-4" /> {t.nav.journal}
              </button>
              <button
                type="button"
                onClick={resetNewAnalysisView}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
              >
                <PlusCircle className="h-4 w-4" /> {t.nav.newAnalysis}
              </button>
            </div>
          </div>
        </div>

        {/* Today: alertas disparados, niveis vigiados e operacoes abertas. Conta
            travada: os alertas ficam pausados e o paywall cita o ativo real. */}
        {/* My assets: niveis do dia dos ativos da pessoa, so codigo e velas reais. */}
        {!isDemo && !freeLocked && <MyAssets base={base} newAccount={!loadingAnalyses && rawAnalyses.length === 0} />}

        {!isDemo && !freeLocked && (
          <TodaySection base={base} alerts={alertsQuery.data} openTrades={openTradesQuery.data?.trades ?? []} analyses={rawAnalyses} />
        )}
        {!isDemo && freeLocked && alertsQuery.data?.paused && alertsQuery.data.pausedSymbol
          ? paywallFor('alerts', undefined, alertsQuery.data.pausedSymbol)
          : null}

        {/* Perfil de estrategia salvo. Os setups seguidos moram na aba Watching. */}
        {!isDemo && !freeLocked && <SetupsSection base={base} part="strategy" />}

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
                      <p className="tabular-nums text-sm text-[var(--text-primary)]">
                        {String(raw.symbol || 'N/A')}{' '}
                        <span className="text-xs text-[var(--text-secondary)]">{String(raw.timeframe || '')}</span>
                      </p>
                      {created && (
                        <p className="tabular-nums text-[11px] text-[var(--text-secondary)]">
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
                className="mt-3 tabular-nums text-xs text-[var(--accent-green)] underline-offset-2 hover:underline"
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
            <span className="tabular-nums text-xl font-semibold text-[var(--text-primary)]">{verdictStats.winRate}%</span>
            {verdictStats.avgRr !== null && (
              <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                {t.verdict.statsRr} {formatNumber(verdictStats.avgRr, language, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}:1
              </span>
            )}
            <span className="tabular-nums text-xs text-[var(--text-tertiary)]">
              {t.verdict.statsBasedOn} {verdictStats.decided} {t.verdict.statsSample}
            </span>
          </div>
        )}

        {/* Usuário sem nenhuma análise: um estado que explica o que a tela vira
            e oferece UMA ação. Também é aqui que a promessa do "valor no
            minuto 1" se repete dentro do painel (Onda 1.2). */}
        {!isDemo && analysesTotal === 0 && !loadingAnalyses ? (
          <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
            <EmptyState
              icon={Upload}
              title={t.empty.homeTitle}
              description={t.empty.homeDesc}
              ctaLabel={t.empty.homeCta}
              onCta={resetNewAnalysisView}
            />
          </div>
        ) : null}

        {/* Novidade: extensao de navegador. So aparece com o link da loja
            preenchido e em Chrome/Edge de computador. */}
        {!isDemo && <ExtensionAnnouncement />}

        {/* Opiniao, lida no /admin (aba Opinioes). So para quem ja fez ao menos
            uma analise e nunca junto da pergunta de origem: um pedido por vez.
            Conta sem assinatura que ainda nao usou ve a versao que vale 3 analises. */}
        {!isDemo && !showAcquisitionSurvey && analysesTotal > 0 && (feedbackRewardAvailable ? <FeedbackRewardCard source="home" /> : <FeedbackCard />)}

        {/* O que o mercado fez com os planos da pessoa nos ultimos 30 dias */}
        {!isDemo && <TrackRecordCard />}

        {/* Heatmap de consistência — mecânica de hábito + card "printável" */}
        {!isDemo && <ActivityHeatmap />}
      </div>
    );
  };

  const renderContent = () => {
    if (!isDemo && isPlanLoading && ['new-analysis', 'sample', 'plans'].includes(activeView ?? '')) {
      return isUsageUnavailable ? null : <p className="text-sm text-[var(--text-secondary)]">{t.counter.loadingPlan}</p>;
    }
    switch (activeView) {
      case 'dashboard':
        return renderDashboardHome();
      case 'new-analysis':
        return (
          <div className="flex flex-col gap-4">
            <div>
              {viewEyebrow(t.nav.newAnalysis)}
              <h1 className="tk-display mt-2 text-2xl md:text-3xl">{t.nav.newAnalysis}</h1>
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
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] tabular-nums text-[11px] text-[var(--text-secondary)]">
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
                  <span className="tabular-nums text-xs text-[var(--text-secondary)]">
                    {`${savedDemo.symbol} · ${savedDemo.timeframe} · ${
                      signalStateLabel(t.analysis, resolveSignalState(savedDemo.signalState, savedDemo.recommendation), entrySide(null, savedDemo.recommendation))
                    }`}
                  </span>
                </div>
                {savedDemo.recommendation !== 'WAIT' && (
                  <dl className="mt-3 grid grid-cols-3 gap-2 tabular-nums text-xs">
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
                allowance={sampleAllowance}
                onOpen={openSampleAnalysis}
                onAnalyze={() => {
                  track('sample_cta_clicked', { viewed: viewedSamples.size, surface: 'picker' });
                  document.getElementById('new-analysis-upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
            )}
            {/* Gratis esgotado: o envio vira o paywall direto, em vez de deixar
                subir o print e so recusar depois. */}
            {freeLocked || trialVariant ? (
              paywallFor('new_analysis')
            ) : trialBlocked ? (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4 text-sm text-[var(--text-secondary)]">
                {trialBlocked.message}
              </div>
            ) : (
              <div id="new-analysis-upload" className="scroll-mt-24">
                <NewAnalysis
                  key={analysisKey}
                  onStartAnalysis={handleStartAnalysis}
                  allowHigherTimeframes={!isDemo && isUnlimited}
                  assetChoices={
                    Array.isArray(watchAssetsQuery.data?.assets) && watchAssetsQuery.data.assets.length > 0
                      ? {
                          symbols: watchAssetsQuery.data.assets.map((asset) => asset.symbol),
                          timeframe: watchAssetsQuery.data.timeframe,
                          timeframes: watchAssetsQuery.data.timeframes,
                        }
                      : null
                  }
                  initialAsset={new URLSearchParams(location.search).get('asset')}
                  onAssetHintChange={(hint) => {
                    assetHintRef.current = hint;
                  }}
                  setupUpdate={
                    updatingSetup
                      ? {
                          title: t.setups.updatingTitle.replace(
                            '{setup}',
                            `${updatingSetup.setup.symbol ?? 'N/A'} ${updatingSetup.setup.timeframe ?? ''}`.trim(),
                          ),
                          detail:
                            updatingSetup.versions[0]?.recommendation === 'WAIT' && updatingSetup.versions[0].entryCondition && (!updatingWatch || isWatchOpen(updatingWatch, setupNow))
                              ? t.setups.waitingFor
                                  .replace('{condition}', updatingSetup.versions[0].entryCondition)
                                  .replace('{date}', formatSetupDay(updatingSetup.versions[0].createdAt, DATE_LOCALES[language] ?? 'en-US'))
                              : null,
                          hint: t.setups.updatingHint,
                          costLine: (deep) =>
                            isUnlimited
                              ? t.setups.costPaid
                                  .replace('{cost}', String(deep ? 3 : 1))
                                  .replace('{balance}', String(Math.floor(Number(ticksBalance) || 0)))
                              : trial
                                ? t.counter.trialLeftToday
                                    .replace('{left}', String(trial.remainingToday))
                                    .replace('{limit}', String(trial.limitToday))
                                : t.setups.costFree.replace('{left}', String(samplesFreeLeft)),
                          cancelLabel: t.setups.updatingCancel,
                          onCancel: resetNewAnalysisView,
                        }
                      : null
                  }
                />
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
            allowance={sampleAllowance}
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
          // Trial encerrado: modo leitura com o historico inteiro.
          const completedRows = rawAnalyses.filter((a) => a.status === 'completed');
          const readable = trial ? completedRows : completedRows.slice(0, 3);
          return (
            <div className="flex flex-col gap-4">
              <div>
                {viewEyebrow(t.nav.myTrades)}
                <h1 className="tk-display mt-2 text-2xl md:text-3xl">{t.nav.myTrades}</h1>
              </div>
              {paywallFor(
                'trades',
                readable.length > 0 ? (
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-5 py-4">
                    <p className="tk-stat-label mb-2">{trial ? t.paywall.recentTitleTrial : t.paywall.recentTitle}</p>
                    {readable.map((a) => {
                      const actionLabel = signalStateLabel(t.analysis, resolveSignalState(a.signalState ?? a.fullResponse?.signalState, a.recommendation), entrySide(a.fullResponse?.watchPlan, a.recommendation));
                      return (
                        <Link
                          key={a.id}
                          to={`${base}/analysis/${encodeURIComponent(a.id)}`}
                          className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] py-2.5 text-sm first:border-t-0 hover:text-[var(--text-primary)]"
                        >
                          <span className="tabular-nums text-[var(--text-primary)]">
                            {`${String(a.symbol || 'N/A')} `}
                            <span className="text-xs text-[var(--text-secondary)]">{String(a.timeframe || '')}</span>
                          </span>
                          <span className="tabular-nums text-xs text-[var(--text-secondary)]">
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
                <h1 className="tk-display mt-2 text-2xl md:text-3xl">{t.nav.journal}</h1>
              </div>
              {paywallFor('journal')}
            </div>
          );
        }
        return <JournalCalendar onStartAnalysis={resetNewAnalysisView} />;
      case 'watching':
        // Gratis esgotado: /api/setups/watching responde 402; a aba vira o Paywall.
        if (freeLocked || isDemo) {
          return (
            <div className="flex flex-col gap-4">
              <div>
                {viewEyebrow(t.nav.watching)}
                <h1 className="tk-display mt-2 text-2xl md:text-3xl">{t.nav.watching}</h1>
              </div>
              {isDemo ? null : paywallFor('watching')}
            </div>
          );
        }
        return <WatchingPage base={base} eyebrow={viewEyebrow(t.nav.watching)} onStartAnalysis={resetNewAnalysisView} />;
      case 'strategy':
        return <StrategyProfile />;
      case 'setup':
        return (
          <SetupPage
            setupId={String(route.param)}
            base={base}
            onUpdate={(setupId) => {
              track('setup_update_clicked', { setupId });
              navigate(`${base}/new?setup=${encodeURIComponent(setupId)}`);
            }}
            paywall={() => paywallFor('setups')}
          />
        );
      case 'settings':
        return <SettingsPage eyebrow={viewEyebrow(t.nav.settings)} />;
      case 'plans':
        return (
          <div className="flex flex-col gap-4">
            <div>
              {viewEyebrow(dc.plansTitle)}
              <h1 className="tk-display mt-2 text-2xl md:text-3xl">{dc.plansTitle}</h1>
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
        const freeLeftKnown = !isPlanLoading && !isUnlimited && Number.isFinite(remaining);
        const exhausted = freeLeftKnown && remaining <= 0;
        // No trial o WAIT conta na cota do dia: a barra "nao gastou" seria falsa.
        const showWaitNudge = !isDemo && freeLeftKnown && !exhausted && isWaitResult && !trial;

        // Estado da operacao (13/10/2026): o painel substitui a antiga pergunta
        // "Vai operar?". So BUY/SELL; WAIT nao e operacao.
        const tradeAnalysisId = !isDemo && !freeLocked && analysisData?.status === 'completed' && isTradeCall(analysisData?.recommendation)
          ? analysisData?.id ?? null
          : null;
        const resultAsset = String(analysisData?.symbol || '');
        const otherOpenTrade = (openTradesQuery.data?.trades ?? []).find(
          (tr) => tr.analysisId !== analysisData?.id && sameAssetName(tr.symbol, resultAsset),
        );
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
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
                >
                  <PlusCircle className="h-4 w-4" /> {dc.waitNudgeCta}
                </button>
              </div>
            )}
            {otherOpenTrade ? (
              <div role="status" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                {t.trade.openTradeNotice
                  .replace('{asset}', displayAsset(otherOpenTrade.symbol))
                  .replace('{date}', new Date(otherOpenTrade.updatedAt).toLocaleDateString(DATE_LOCALES[language] ?? 'en-US'))}
              </div>
            ) : null}
            <AnalysisResult analysisData={analysisData} uploadedImage={uploadedImage} alertsEnabled={!isDemo && !freeLocked} base={base} />
            {tradeAnalysisId ? <TradePanel key={`trade-${tradeAnalysisId}`} analysisId={tradeAnalysisId} /> : null}
            {!isDemo && !freeLocked && feedbackRewardAvailable && analysisData?.status === 'completed' ? <FeedbackRewardCard source="result" /> : null}
            {/* Seguir o setup: ao lado das acoes de sempre, nunca no lugar delas. */}
            {!isDemo && !freeLocked && analysisData?.id && analysisData.status === 'completed' && !(analysisData.fullResponse?.signalState === 'WATCH' && isWatchPlan(analysisData.fullResponse.watchPlan)) && !historicalPrintOf(analysisData.fullResponse) ? (
              <SetupAlertBar
                key={`alerts-${analysisData.id}`}
                analysisId={analysisData.id}
                recommendation={(() => {
                  const tone = getRecommendationMeta(analysisData.recommendation).tone;
                  return tone === 'buy' ? 'BUY' : tone === 'sell' ? 'SELL' : 'WAIT';
                })()}
                base={base}
                readHasLevels={Boolean(analysisData.fullResponse?.aiLevel || analysisData.fullResponse?.levelMap?.above || analysisData.fullResponse?.levelMap?.below)}
              />
            ) : null}
            {/* Pagantes mantêm as estrelas; gratuitos autenticados avaliam utilidade. */}
            {!isDemo && !isPlanLoading && !isUsageUnavailable && user?.id && analysisData?.id && analysisData.status === 'completed' ? (
              <RatingCard key={`${user.id}:${analysisData.id}:${isUnlimited}`} analysisId={analysisData.id} userId={user.id} usefulnessUserId={isUnlimited ? undefined : user.id} />
            ) : null}
            {!isDemo && showAcquisitionSurvey && acquisitionSurvey}
            {!isDemo && (
              <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
                {/* Onda 2.2 — pergunta no único momento em que o usuário ainda
                    está olhando pro setup. NÃO perguntamos TP1/TP2/SL aqui: o
                    trade acabou de nascer, não há resposta possível, e cobrar
                    resultado agora ensina a ignorar o card. Só marcamos como
                    aberto — é isso que cria o pendente que cobramos depois. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {freeLeftKnown && !exhausted && (
                    <p className="text-sm text-[var(--text-primary)]">
                      {trial
                        ? t.counter.trialLeftToday.replace('{left}', String(trial.remainingToday)).replace('{limit}', String(trial.limitToday))
                        : t.counter.tradeCallsLeft.replace('{left}', String(remaining)).replace('{limit}', String(total))}
                    </p>
                  )}
                  {/* WAIT não consome análise com sinal: dizer isso no momento em
                      que a pessoa recebe um, senão ela lê o WAIT como gasto. */}
                  {freeLeftKnown && !exhausted && !trial && ['WAIT', 'HOLD'].includes(String(analysisData?.recommendation || '').toUpperCase()) && (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{t.counter.waitFreeNote}</p>
                  )}
                  {freeLeftKnown && !exhausted && !trial && totalUsed !== null && totalLimit !== null && (
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {t.counter.totalCapNote.replace('{limit}', String(totalLimit)).replace('{left}', String(Math.max(0, totalLimit - totalUsed)))}
                    </p>
                  )}
                  {exhausted && (
                    <p className="text-sm text-[var(--tone-warn-3)]">
                      {trialVariant === 'daily_limit' ? t.counter.trialComeBack : trialVariant === 'trial_ended' ? t.counter.trialEnded : t.counter.exhausted}
                    </p>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-3 sm:shrink-0">
                  {exhausted ? (
                    <>
                      {/* Mesmo checkout do paywall (semanal, a entrada mais barata).
                          Antes ia para /pricing e exigia mais um clique. */}
                      <Button size="sm" className="h-auto max-w-full whitespace-normal py-2" onClick={handleLastFreeCheckout} disabled={unlockPending}>
                        <Crown className="mr-2 h-4 w-4" />
                        {t.paywall.ctaWeekly}
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
                        className="inline-flex items-center gap-2 rounded-xl bg-[var(--inverse-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--inverse-fg)] transition-opacity hover:opacity-90"
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
    !isPlanLoading && (isUnlimited ||
    total === null ||
    total === undefined ||
    total === -1 ||
    !Number.isFinite(total));
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
    route.section === 'sample' || route.section === 'analysis'
      ? 'new'
      : route.section === 'setups'
        ? 'watching'
        : (route.section as NavSection | null);
  const openAnalysis = (route.section === 'sample' || analysisInMemory) ? analysisData : null;
  const openAnalysisName = [
    openAnalysis?.symbol ?? openAnalysis?.fullResponse?.analysis?.symbol,
    openAnalysis?.timeframe ?? openAnalysis?.fullResponse?.analysis?.timeframe,
  ].filter(Boolean).map(String).join(' ');
  const currentViewLabel =
    route.section === 'analysis' || route.section === 'sample'
      ? (openAnalysisName ? t.nav.assetAnalysis.replace('{asset}', displayAsset(openAnalysisName)) : t.nav.analysisLabel)
      : activeNav === 'trades'
      ? t.nav.myTrades
      : activeNav === 'journal'
        ? t.nav.journal
        : activeNav === 'watching'
        ? t.nav.watching
        : activeNav === 'strategy'
          ? t.nav.strategy
          : activeNav === 'plans'
            ? t.nav.plans
            : activeNav === 'settings'
              ? t.nav.settings
              : activeNav === 'home'
                ? t.nav.dashboard
                : t.nav.newAnalysis;
  const sidebarSectionTitleClass = 'text-xs font-medium text-[var(--text-secondary)]';

  // Painel e area logada: titulo por area (aba do navegador e $title do
  // PostHog) e nunca indexavel. Fora do seo-routes.json de proposito.
  useSeo({
    title: `${currentViewLabel} | Tickrify`,
    description: 'Your Tickrify workspace.',
    path: location.pathname,
    noindex: true,
  });
  useAlertTabTitle(alertsUnseen, `${currentViewLabel}|${location.pathname}`);

  const sideState = (active: boolean) =>
    active ? 'bg-[var(--inverse-bg)] text-[var(--inverse-fg)]' : 'text-[var(--text-secondary)] hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)]';
  const navItemClass = (section: NavSection) =>
    `tk-side-item relative flex w-full items-center gap-2.5 rounded-lg py-2 text-sm transition-colors ${sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'} ${sideState(activeNav === section)}`;
  const footerItemClass = (active: boolean, size: 'xs' | 'sm' = 'xs') =>
    `tk-side-item relative flex w-full items-center gap-2.5 rounded-lg transition-colors ${size === 'sm' ? 'py-2 text-sm' : 'py-1.5 text-xs'} ${sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'} ${sideState(active)}`;
  const navLink = (section: NavSection) => `${base}${SECTION_PATH[section]}`;
  // "Nova analise" sempre abre o envio limpo, mesmo vindo de um erro ou resultado.
  const onNewAnalysisLink = (event: ReactMouseEvent) => {
    event.preventDefault();
    resetNewAnalysisView();
  };

  // Menu da conta (Clerk): Configuracoes sempre; "Manage subscription" so para
  // quem tem assinatura da Stripe (abre o portal direto, sem tela no meio);
  // comunidade no Discord para todos, sem checar plano.
  const accountMenu = (
    <UserButton afterSignOutUrl="/" appearance={theme === 'light' ? clerkLightAppearance : undefined}>
      <UserButton.MenuItems>
        <UserButton.Link label={t.nav.settings} labelIcon={<Settings className="h-4 w-4" />} href={navLink('settings')} />
        {billingManageable ? (
          <UserButton.Action
            label={t.settings.manage}
            labelIcon={<CreditCard className="h-4 w-4" />}
            onClick={() => {
              void getToken()
                .then((token) => (token ? openBillingPortal(token) : navigate(navLink('settings'))))
                .catch(() => navigate(navLink('settings')));
            }}
          />
        ) : null}
        <UserButton.Action
          label={t.community.join}
          labelIcon={<DiscordIcon />}
          onClick={() => {
            trackCommunityClick('app');
            window.open(COMMUNITY_URL, '_blank', 'noopener,noreferrer');
          }}
        />
      </UserButton.MenuItems>
    </UserButton>
  );

  if (!bootDone.current) {
    const waiting = Boolean(user) && !bootTimedOut && (isPlanLoading || loadingAnalyses);
    if (waiting && !isUsageUnavailable) return <BrandLoader />;
    bootDone.current = true;
  }

  return (
    <div className="relative z-10 flex min-h-screen w-full overflow-x-hidden bg-[var(--bg-base)]">
      {/* SIDEBAR (desktop): recolhe para so os icones, com o nome em tooltip e os contadores como badge. */}
      <aside
        id="dashboard-sidebar"
        className={`relative z-[45] hidden shrink-0 flex-col border-r border-[var(--border-subtle)] transition-[width] duration-200 motion-reduce:transition-none md:flex ${sidebarCollapsed ? 'w-[64px]' : 'w-[248px]'}`}
      >
        <div className={`flex items-center gap-2.5 pb-4 pt-4 ${sidebarCollapsed ? 'flex-col px-2' : 'px-4'}`}>
          <img src={officialIcon} alt="Tickrify" className="h-8 w-auto shrink-0 object-contain" />
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1 leading-none">
              <div className="text-sm font-bold tracking-wide text-[var(--text-primary)]">TICKRIFY</div>
              <div className="mt-1 tabular-nums text-[11px] text-[var(--text-secondary)]">{t.landing.hero.terminal}</div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? t.nav.expandSidebar : t.nav.collapseSidebar}
            aria-expanded={!sidebarCollapsed}
            aria-controls="dashboard-sidebar"
            className="tk-side-item relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--fill-2)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-accent)]"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {sidebarCollapsed && <SideTooltip label={t.nav.expandSidebar} />}
          </button>
        </div>

        <div className={`flex flex-1 flex-col px-3 ${sidebarCollapsed ? 'overflow-visible px-2' : 'overflow-y-auto'}`}>
          {!sidebarCollapsed && <div className={`${sidebarSectionTitleClass} px-2 pb-1 pt-2`}>{t.nav.workArea}</div>}
          <nav className="flex flex-col gap-0.5">
            <Link to={navLink('home')} aria-current={activeNav === 'home' ? 'page' : undefined} className={navItemClass('home')}>
              <SideItemBody
                collapsed={sidebarCollapsed}
                icon={<LayoutGrid className="h-4 w-4" />}
                label={t.nav.dashboard}
              />
            </Link>
            <Link to={navLink('new')} onClick={onNewAnalysisLink} aria-current={activeNav === 'new' ? 'page' : undefined} className={navItemClass('new')}>
              <SideItemBody
                collapsed={sidebarCollapsed}
                icon={<PlusCircle className="h-4 w-4" />}
                label={t.nav.newAnalysis}
                // Recolhida, o contador das gratis (cartao abaixo) vira badge aqui.
                badge={sidebarCollapsed && user && plan === 'free' && !isPlanLoading && Number.isFinite(remaining)
                  ? { key: 'free-left', value: String(Math.max(0, remaining)), label: `${Math.max(0, remaining)} ${t.nav.freeLeft}`, tone: 'inverse' }
                  : null}
              />
            </Link>
            <Link to={navLink('trades')} aria-current={activeNav === 'trades' ? 'page' : undefined} className={navItemClass('trades')}>
              <SideItemBody collapsed={sidebarCollapsed} icon={<History className="h-4 w-4" />} label={t.nav.myTrades} />
            </Link>
            <Link to={navLink('journal')} aria-current={activeNav === 'journal' ? 'page' : undefined} className={navItemClass('journal')}>
              <SideItemBody collapsed={sidebarCollapsed} icon={<CalendarDays className="h-4 w-4" />} label={t.nav.journal} />
            </Link>
            <Link to={navLink('watching')} aria-current={activeNav === 'watching' ? 'page' : undefined} className={navItemClass('watching')}>
              <SideItemBody
                collapsed={sidebarCollapsed}
                icon={<Eye className="h-4 w-4" />}
                label={t.nav.watching}
                badge={alertsUnseen > 0 ? { key: 'alerts-unseen', value: String(alertsUnseen), label: t.alerts.menuBadge.replace('{n}', String(alertsUnseen)), tone: 'accent' } : null}
              />
            </Link>
            <Link to={navLink('strategy')} aria-current={activeNav === 'strategy' ? 'page' : undefined} className={navItemClass('strategy')}>
              <SideItemBody collapsed={sidebarCollapsed} icon={<Sliders className="h-4 w-4" />} label={t.nav.strategy} />
            </Link>
          </nav>


          {/* Gratis: contador das gratis na lateral (o empurrao para assinar).
              Assinante: o cartao do plano (saldo, renovacao e "Manage
              subscription", onde se cancela) abre ao clicar no saldo ou no
              plano no topo (TicksBadge); fixo aqui ele poluia a lateral. */}
          {user && plan === 'free' && !isPlanLoading && !sidebarCollapsed && (
            <div className="mt-4">
              <AnalysisCounter />
            </div>
          )}
        </div>

        {/* Plano e assinatura ficam no rodape, junto da conta. "Plans" abre os
            planos DENTRO do painel (/dashboard/plans): antes ia para a /pricing
            publica e o voltar do navegador tirava a pessoa do app. */}
        <div className={`flex flex-col gap-0.5 border-t border-[var(--border-subtle)] py-2 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {user && plan === 'free' && (
            <button type="button" onClick={() => openUpgradeModal('sidebar')} className={footerItemClass(false, 'sm')}>
              <SideItemBody collapsed={sidebarCollapsed} icon={<Crown className="h-4 w-4 text-[var(--accent-green)]" />} label={dc.subscribeCta} />
            </button>
          )}
          <Link to={navLink('plans')} aria-current={activeNav === 'plans' ? 'page' : undefined} className={footerItemClass(activeNav === 'plans')}>
            <SideItemBody collapsed={sidebarCollapsed} icon={<CreditCard className="h-3.5 w-3.5" />} label={t.nav.plans} />
          </Link>
          <Link to={navLink('settings')} aria-current={activeNav === 'settings' ? 'page' : undefined} className={footerItemClass(activeNav === 'settings')}>
            <SideItemBody collapsed={sidebarCollapsed} icon={<Settings className="h-3.5 w-3.5" />} label={t.nav.settings} />
          </Link>
          <Link to="/affiliate" className={footerItemClass(false)}>
            <SideItemBody collapsed={sidebarCollapsed} icon={<Handshake className="h-3.5 w-3.5" />} label={t.nav.affiliates} />
          </Link>
          {/* Chat com o fundador: abre a bolha ja na conversa. */}
          {user && (
            <button
              type="button"
              onClick={() => openChat('dashboard_menu')}
              aria-label={chatUnread > 0 ? `${t.chat.menu} (${t.chat.unread.replace('{n}', String(chatUnread))})` : t.chat.menu}
              className={footerItemClass(false)}
            >
              <SideItemBody
                collapsed={sidebarCollapsed}
                icon={<MessageCircle className="h-3.5 w-3.5" />}
                label={t.chat.menu}
                badge={chatUnread > 0 ? { key: 'chat-unread', value: String(chatUnread), label: t.chat.unread.replace('{n}', String(chatUnread)), tone: 'inverse' } : null}
              />
            </button>
          )}
        </div>

        {user && (
          <div className={`flex items-center gap-2.5 border-t border-[var(--border-subtle)] p-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            {accountMenu}
            {!sidebarCollapsed && (
              <div className="min-w-0 leading-tight">
                <div className="truncate text-xs text-[var(--text-primary)]">{user.firstName || user.fullName || 'Trader'}</div>
                <div className="tabular-nums text-[11px] text-[var(--text-secondary)]">{isPlanLoading ? t.counter.loadingPlan : plan?.toUpperCase()}{navbarUnlimited ? ` · ${t.nav.statusActive}` : ''}</div>
              </div>
            )}
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
      
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-header)] px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={user ? "/dashboard" : "/"} className="md:hidden">
            <img src={officialIcon} alt="Tickrify" className="h-7 w-auto shrink-0 object-contain" />
          </Link>
          <span className="hidden items-center gap-2 tabular-nums text-[11px] md:flex">
            <span className="text-[var(--text-secondary)]">{t.nav.workspace}</span>
            <span className="text-[var(--text-tertiary)]">/</span>
            <span className="text-[var(--text-primary)]">{currentViewLabel}</span>
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 overflow-visible text-sm md:gap-3">
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'}`} />
            <span className={`tabular-nums text-[11px] ${isOnline ? 'text-[var(--accent-green)]' : 'text-[var(--tone-down-3)]'}`}>
              {isOnline ? t.common.online : t.common.offline}
            </span>
          </div>

          {user ? (
            <TicksBadge
              showBalance={!isPlanLoading}
              subscriber={navbarUnlimited}
              planText={isPlanLoading ? t.counter.loadingPlan : navbarUnlimited ? (plan ?? '').toUpperCase() : quotaText}
              planSub={navbarUnlimited ? `· ${t.nav.statusActive}` : ''}
            />
          ) : (
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-sm font-medium">
              <span className="whitespace-nowrap">{navbarUnlimited ? (plan ?? '').toUpperCase() : quotaText}</span>
            </div>
          )}

          <LanguageSwitcher />

          {user && (
            <div className="shrink-0 md:hidden">
              {accountMenu}
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        {user && plan === 'free' && (
          <div className="border-b border-border p-3 md:hidden">
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

        <div className="flex flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom,0px)+6.75rem)] md:p-6 md:pb-16">
            <div className="flex flex-col gap-6 md:gap-8">
              {!isDemo && <CheckoutConfirmation hasPaidAccess={!isPlanLoading && isUnlimited} />}
              {user && !isDemo && !isPlanLoading && !isUsageUnavailable && plan === 'free' && (trial || trialBlocked) && (
                <div className="md:hidden"><AnalysisCounter /></div>
              )}
              {isUsageUnavailable && <PlanUnavailableNotice onRetry={retryUsage} />}
              {/* Renovacao recusada (past_due/unpaid): o painel trata a conta como
                  gratuita, entao o aviso com o botao do portal fica no topo de
                  toda area. Configuracoes ja mostra o status por conta propria. */}
              {user && !isDemo && !isPlanLoading && plan === 'free' && route.section !== 'settings' ? <PaymentFailedBanner /> : null}
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
              {followUp ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4" role="dialog" aria-modal="true">
                  <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5">
                    {followUp.step === 'is_follow_up' ? (
                      <div key="is_follow_up" className="space-y-4">
                        <p className="text-base font-semibold text-[var(--text-primary)]">
                          {t.trade.followUpTitle.replace('{asset}', displayAsset(followUp.trade.symbol))}
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="button" disabled={followUpBusy} onClick={() => void answerFollowUpYes()}>
                            {followUpBusy ? t.trade.checking : t.trade.followUpYes}
                          </Button>
                          <Button type="button" variant="outline" disabled={followUpBusy} onClick={() => setFollowUp({ ...followUp, step: 'still_open' })}>
                            {t.trade.followUpNo}
                          </Button>
                        </div>
                      </div>
                    ) : followUp.step === 'still_open' ? (
                      <div key="still_open" className="space-y-4">
                        <p className="text-base font-semibold text-[var(--text-primary)]">
                          {t.trade.stillOpenTitle.replace('{asset}', displayAsset(followUp.trade.symbol))}
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button type="button" onClick={continueAsNewAnalysis}>{t.trade.stillOpen}</Button>
                          <Button type="button" variant="outline" onClick={() => setFollowUp({ ...followUp, step: 'close_reason' })}>
                            {t.trade.closedIt}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div key="close_reason" className="space-y-4">
                        <label className="flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
                          {t.trade.closeReason}
                          <select
                            value={followUpReason}
                            onChange={(e) => setFollowUpReason(e.target.value as TradeCloseReason)}
                            className="h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-base text-[var(--text-primary)]"
                          >
                            <option value="target_hit">{t.trade.reasonTarget}</option>
                            <option value="stop_hit">{t.trade.reasonStop}</option>
                            <option value="breakeven">{t.trade.reasonBreakeven}</option>
                            <option value="manual">{t.trade.reasonManual}</option>
                            <option value="invalidated">{t.trade.reasonInvalidated}</option>
                          </select>
                        </label>
                        <Button type="button" disabled={followUpBusy} onClick={() => void closePreviousAndContinue()}>
                          {t.trade.save}
                        </Button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setFollowUp(null)}
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      {t.trade.cancel}
                    </button>
                  </div>
                </div>
              ) : null}
              {/* Aviso fixo do painel (13/10/2026). */}
              <p className="pb-2 text-center tabular-nums text-[11px] text-[var(--text-secondary)]">{t.trade.disclaimer}</p>
            </div>
          </main>
        </div>
      </div>
      </div>

      {/* Celular: ilha de navegacao embaixo (no computador, a barra lateral). */}
      <MobileNav
        activeNav={activeNav}
        linkTo={navLink}
        onNewAnalysis={onNewAnalysisLink}
        counts={{ alerts: alertsUnseen, chat: chatUnread }}
        signedIn={Boolean(user)}
      />

      {/* Modal de Upgrade */}
      <Dialog open={showUpgradeModal && !isPlanLoading} onOpenChange={setShowUpgradeModal}>
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
            <p className="text-xs text-[var(--text-secondary)]">{t.commercial.tickCosts}</p>
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
              <span className="text-right text-xs font-semibold">{dc.weeklyPrice.replace('{price}', formatNumber(7.99, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span>
            </button>
            <button
              type="button"
              onClick={handleModalMonthly}
              disabled={unlockPending}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
            >
              <span className="text-sm font-semibold">{dc.modalMonthly}</span>
              <span className="text-right text-xs font-semibold">
                {modalFirstMonth ? dc.modalMonthlyOffer.replace('{price}', modalFirstMonth) : `$29${dc.perMonth}`}
              </span>
            </button>
          </div>

          <p className="text-xs text-[var(--text-secondary)]">{t.commercial.weeklyRenewal}</p>
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
