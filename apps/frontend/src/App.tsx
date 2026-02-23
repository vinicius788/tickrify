import { ThemeProvider } from "@/components/ThemeProvider";
import LandingPage from "@/components/pages/LandingPage";
import DashboardPage from "@/components/pages/DashboardPage";
import PricingPage from "@/components/pages/PricingPage";
import ProtectedRoute from "@/components/ProtectedRoute";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/toaster";
import { SignIn, SignUp } from "@clerk/clerk-react";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/demo" element={<DashboardPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route
            path="/sign-in/*"
            element={
              <div className="flex items-center justify-center min-h-screen bg-background">
                <SignIn 
                  routing="path" 
                  path="/sign-in" 
                  signUpUrl="/sign-up"
                  afterSignInUrl="/"
                  afterSignUpUrl="/"
                />
              </div>
            }
          />
          <Route
            path="/sign-up/*"
            element={
              <div className="flex items-center justify-center min-h-screen bg-background">
                <SignUp 
                  routing="path" 
                  path="/sign-up" 
                  signInUrl="/sign-in"
                  afterSignInUrl="/"
                  afterSignUpUrl="/"
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
