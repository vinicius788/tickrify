import { ThemeProvider } from "@/components/providers/ThemeProvider";
import LandingPage from "@/components/pages/LandingPage";
import CookieConsent from "@/components/landing/CookieConsent";
import PricingPage from "@/components/pages/PricingPage";
import ReportProblemButton from "@/components/ReportProblemButton";
import ProtectedRoute from "@/components/routing/ProtectedRoute";
import { RouteAnalytics } from "@/components/providers/RouteAnalytics";
import { BrowserRouter as Router, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { SignIn, SignUp, GoogleOneTap, SignedOut } from "@clerk/clerk-react";
import { Suspense, lazy, useEffect, type ReactNode } from "react";
import BrandLoader from "./components/ui/BrandLoader";
import { useSeo, seoFor } from "@/hooks/useSeo";
import { warmupPaymentsApi } from "@/lib/api";
import { scrollToTop } from "@/lib/utils";
import { affiliateTargetFromAuthSearch, checkoutTargetFromAuthSearch } from "@/lib/checkoutIntent";

// ── Code splitting (21/09/2026) ─────────────────────────────────────────────
// Antes TODAS as paginas iam num arquivo so (1,55 MB, 484 kB gzip): quem abria
// a landing baixava o painel, o admin e as paginas legais junto. Landing e
// /pricing continuam no arquivo principal (entrada e conversao, sem espera);
// o resto baixa quando a rota abre. O painel e pre-baixado quando o navegador
// fica ocioso (ver App), entao quem loga nao espera o arquivo dele.
const loadDashboard = () => import("@/components/pages/DashboardPage");
const DashboardPage = lazy(loadDashboard);
// Quem abre/recarrega o painel direto: comeca a baixar o arquivo dele JA, em
// paralelo com o login do Clerk. Sem isto o download so comecava depois que o
// ProtectedRoute confirmava a sessao (uma espera depois da outra).
if (typeof window !== "undefined" && /^\/(dashboard|demo)(\/|$)/.test(window.location.pathname)) {
  void loadDashboard().catch(() => undefined);
}
const AdminPage = lazy(() => import("@/components/pages/AdminPage"));
const AccuracyPage = lazy(() => import("@/components/pages/AccuracyPage"));
const AffiliatesPage = lazy(() => import("@/components/pages/AffiliatesPage"));
const AffiliateDashboardPage = lazy(() => import("@/components/pages/AffiliateDashboardPage"));
const TryPage = lazy(() => import("@/components/pages/TryPage"));
const TermsPage = lazy(() => import("@/components/pages/TermsPage"));
const CookiePolicyPage = lazy(() => import("@/components/pages/CookiePolicyPage"));
const RiskDisclosurePage = lazy(() => import("@/components/pages/RiskDisclosurePage"));
const PrivacyPolicyPage = lazy(() => import("@/components/pages/PrivacyPolicyPage"));
const AboutPage = lazy(() => import("@/components/pages/AboutPage"));
const NotFoundPage = lazy(() => import("@/components/pages/NotFoundPage"));

/** Enquanto o arquivo da rota chega: so o fundo da pagina, sem texto nem salto de layout. */
function RouteFallback() {
  return <BrandLoader />;
}

/**
 * Casca das telas de autenticação do Clerk.
 *
 * Existe por SEO, não por layout. /sign-in estava no `Disallow` do robots.txt e
 * mesmo assim foi indexado pelo Google, porque `Disallow` impede rastrear e não
 * indexar. A correção é o contrário: deixar rastrear e mandar `noindex`. O
 * pré-render já escreve a meta no HTML cru; sem um componente aqui não havia
 * onde chamar o hook, e a hidratação apagava a meta ao navegar dentro da SPA.
 */
function AuthScreen({ seoPath, children }: { seoPath: "/sign-in" | "/sign-up"; children: ReactNode }) {
  useSeo(seoFor(seoPath));
  return (
    <div className="tk-site relative z-10 flex items-center justify-center min-h-screen">
      {children}
    </div>
  );
}

// One Tap em toda página EXCETO /try: a demo é "valor antes do cadastro" —
// um popup de login em cima dela passa a impressão de login obrigatório e
// mata exatamente a conversão que a página existe pra destravar. O CTA de
// cadastro da /try aparece DEPOIS do resultado (momento certo).
//
// O destino e FORCADO (One Tap nao le `redirect_url`), entao na tela de login
// aberta pelo Upgrade ele segue a intencao de compra em vez do /dashboard.
// `checkoutTargetFromAuthSearch` so aceita os Planos do painel (ou a /pricing
// antiga) com ?checkout=... deste site.
function OneTapOutsideTry() {
  const { pathname, search, hash } = useLocation();
  if (pathname.startsWith("/try")) return null;
  const target =
    checkoutTargetFromAuthSearch(search, window.location.origin, hash) ??
    affiliateTargetFromAuthSearch(search, window.location.origin, hash) ??
    "/dashboard";
  return (
    <SignedOut>
      <GoogleOneTap signInForceRedirectUrl={target} signUpForceRedirectUrl={target} />
    </SignedOut>
  );
}

/**
 * Rolagem ao trocar de rota.
 *
 * O React Router não mexe no scroll, e o navegador só restaura posição em
 * navegação de documento, que numa SPA não existe. Resultado: sair de /pricing
 * rolado até o rodapé e clicar em "Termos" abria a página nova no fim dela.
 *
 * Âncora fica de fora: quem chega em /#platform quer justamente parar no meio,
 * e quem cuida disso é o SiteLayout.
 */
function ScrollToTopOnRouteChange() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    scrollToTop();
  }, [pathname, hash]);

  return null;
}

function App() {
  // Acorda o backend (Render hiberna) assim que o app carrega, em qualquer página.
  // Reduz o cold start que fazia o dashboard demorar a confirmar a assinatura.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

  // Pre-baixa o painel quando o navegador fica ocioso: fora do caminho critico
  // da landing, mas pronto quando a pessoa loga ou clica em "Dashboard".
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const prefetch = () => void loadDashboard().catch(() => undefined);
    if (idle) {
      idle(prefetch);
    } else {
      const timer = window.setTimeout(prefetch, 3000);
      return () => window.clearTimeout(timer);
    }
  }, []);

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <RouteAnalytics />
        <ScrollToTopOnRouteChange />
        {/* Google One Tap: login em 1 toque para deslogados em qualquer página,
            EXCETO na demo /try (ver OneTapOutsideTry). */}
        <OneTapOutsideTry />
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          {/* Demo anônima (Fase 0): análise real sem cadastro — valor antes do signup. */}
          <Route path="/try" element={<TryPage />} />
          <Route path="/demo/*" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/about" element={<AboutPage />} />
          {/* Política de privacidade. A rota canônica é /privacy (site global,
              texto em inglês). /privacidade continua respondendo porque é o
              endereço que já circula — links antigos e indexação — e quebrá-lo
              devolveria 404 numa página legal. */}
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          {/* Legais com URL própria: a Stripe exige termos e política de
              cancelamento acessíveis publicamente, e um diálogo no rodapé não
              tem endereço para linkar nem para o buscador indexar. */}
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/cookies" element={<CookiePolicyPage />} />
          <Route path="/risk" element={<RiskDisclosurePage />} />
          <Route path="/privacidade" element={<PrivacyPolicyPage />} />
          {/* Pagina publica de acuracia (Fase 5): o scoreboard do motor. */}
          <Route path="/accuracy" element={<AccuracyPage />} />
          {/* Programa de afiliados: /affiliates e a vitrine publica (so as regras
              padrao); /affiliate e o painel de quem ja participa. */}
          <Route path="/affiliates" element={<AffiliatesPage />} />
          <Route
            path="/affiliate"
            element={
              <ProtectedRoute>
                <AffiliateDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sign-in/*"
            element={
              <AuthScreen seoPath="/sign-in">
                <SignIn
                  routing="path"
                  path="/sign-in"
                  signUpUrl="/sign-up"
                  // FALLBACK, nao destino fixo: so vale sem `redirect_url` na
                  // URL. O Upgrade deslogado manda `redirect_url` para o
                  // checkout, e o Clerk o carrega tambem na troca para o
                  // cadastro. `afterSignInUrl` (legado) nao garantia isso.
                  fallbackRedirectUrl="/dashboard"
                  signUpFallbackRedirectUrl="/dashboard"
                />
              </AuthScreen>
            }
          />
          <Route
            path="/sign-up/*"
            element={
              <AuthScreen seoPath="/sign-up">
                <SignUp
                  routing="path"
                  path="/sign-up"
                  signInUrl="/sign-in"
                  fallbackRedirectUrl="/dashboard"
                  signInFallbackRedirectUrl="/dashboard"
                />
              </AuthScreen>
            }
          />
          {/* `/*`: cada area do painel tem URL propria (/dashboard/trades,
              /dashboard/plans...). O mapa fica no DashboardPage. */}
          <Route
            path="/dashboard/*"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          {/* Loja de apps interna. ProtectedRoute só garante "está logado" — quem
              exige role=admin é o AdminGuard do backend, e a própria página
              desenha "sem acesso" ao receber 403. Gate de UI nunca substitui
              guard de servidor. A página se marca noindex (o /sign-in já foi
              parar no Google porque Disallow impede rastrear, não indexar). */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          {/* Curinga: sem isto, link quebrado renderizava tela branca. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
        {/* Botão de reportar problema, montado UMA vez para o app inteiro.
            Dentro do Router de propósito: ele lê a rota atual (useLocation) para
            mandar junto com o relato. Só se desenha para quem está logado. */}
        <ReportProblemButton />
        {/* Banner de cookies, montado uma vez para o app inteiro (inclusive o
            dashboard). Dentro do Router porque linka a política de cookies. */}
        <CookieConsent />
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
