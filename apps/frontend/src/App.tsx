import { ThemeProvider } from "@/components/providers/ThemeProvider";
import LandingPage from "@/components/pages/LandingPage";
import DashboardPage from "@/components/pages/DashboardPage";
import PricingPage from "@/components/pages/PricingPage";
import PrivacyPolicyPage from "@/components/pages/PrivacyPolicyPage";
import ProtectedRoute from "@/components/routing/ProtectedRoute";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { SignIn, SignUp } from "@clerk/clerk-react";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
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
