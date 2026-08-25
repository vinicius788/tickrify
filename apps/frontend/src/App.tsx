import { ThemeProvider } from "@/components/providers/ThemeProvider";
import LandingPage from "@/components/pages/LandingPage";
import NotFoundPage from '@/components/pages/NotFoundPage';
import TermsPage from "@/components/pages/TermsPage";
import CookiePolicyPage from "@/components/pages/CookiePolicyPage";
import RiskDisclosurePage from "@/components/pages/RiskDisclosurePage";
import CookieConsent from "@/components/landing/CookieConsent";
import DashboardPage from "@/components/pages/DashboardPage";
import PricingPage from "@/components/pages/PricingPage";
import PrivacyPolicyPage from "@/components/pages/PrivacyPolicyPage";
import AccuracyPage from "@/components/pages/AccuracyPage";
import TryPage from "@/components/pages/TryPage";
import AdminPage from "@/components/pages/AdminPage";
import ReportProblemButton from "@/components/ReportProblemButton";
import ProtectedRoute from "@/components/routing/ProtectedRoute";
import { RouteAnalytics } from "@/components/providers/RouteAnalytics";
import { BrowserRouter as Router, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { SignIn, SignUp, GoogleOneTap, SignedOut } from "@clerk/clerk-react";
import { useEffect } from "react";
import { warmupPaymentsApi } from "@/lib/api";
import { scrollToTop } from "@/lib/utils";

// One Tap em toda página EXCETO /try: a demo é "valor antes do cadastro" —
// um popup de login em cima dela passa a impressão de login obrigatório e
// mata exatamente a conversão que a página existe pra destravar. O CTA de
// cadastro da /try aparece DEPOIS do resultado (momento certo).
function OneTapOutsideTry() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/try")) return null;
  return (
    <SignedOut>
      <GoogleOneTap signInForceRedirectUrl="/dashboard" signUpForceRedirectUrl="/dashboard" />
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

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <RouteAnalytics />
        <ScrollToTopOnRouteChange />
        {/* Google One Tap: login em 1 toque para deslogados em qualquer página,
            EXCETO na demo /try (ver OneTapOutsideTry). */}
        <OneTapOutsideTry />
        <Routes>
          <Route path="/" element={<LandingPage />} />
          {/* Demo anônima (Fase 0): análise real sem cadastro — valor antes do signup. */}
          <Route path="/try" element={<TryPage />} />
          <Route path="/demo" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/pricing" element={<PricingPage />} />
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
          <Route
            path="/sign-in/*"
            element={
              <div className="tk-site relative z-10 flex items-center justify-center min-h-screen">
                <SignIn
                  routing="path"
                  path="/sign-in"
                  signUpUrl="/sign-up"
                  afterSignInUrl="/dashboard"
                  afterSignUpUrl="/dashboard"
                />
              </div>
            }
          />
          <Route
            path="/sign-up/*"
            element={
              <div className="tk-site relative z-10 flex items-center justify-center min-h-screen">
                <SignUp
                  routing="path"
                  path="/sign-up"
                  signInUrl="/sign-in"
                  afterSignInUrl="/dashboard"
                  afterSignUpUrl="/dashboard"
                />
              </div>
            }
          />
          <Route
            path="/dashboard"
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
