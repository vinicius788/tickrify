import { ThemeProvider } from "@/components/providers/ThemeProvider";
import LandingPage from "@/components/pages/LandingPage";
import DashboardPage from "@/components/pages/DashboardPage";
import PricingPage from "@/components/pages/PricingPage";
import PrivacyPolicyPage from "@/components/pages/PrivacyPolicyPage";
import TryPage from "@/components/pages/TryPage";
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
          <Route path="/privacidade" element={<PrivacyPolicyPage />} />
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
        </Routes>
      </Router>
      <Toaster />
    </ThemeProvider>
  );
}

export default App;
