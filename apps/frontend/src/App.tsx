import { ThemeProvider } from "@/components/providers/ThemeProvider";
import LandingPage from "@/components/pages/LandingPage";
import NotFoundPage from '@/components/pages/NotFoundPage';
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
          <Route path="/privacidade" element={<PrivacyPolicyPage />} />
          {/* Pagina publica de acuracia (Fase 5): o scoreboard do motor. */}
          <Route path="/accuracy" element={<AccuracyPage />} />
          <Route
            path="/sign-in/*"
            element={
              <div className="relative z-10 flex items-center justify-center min-h-screen bg-[#050508]">
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
              <div className="relative z-10 flex items-center justify-center min-h-screen bg-[#050508]">
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
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
