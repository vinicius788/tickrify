import { useAuth } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";
import { ReactNode, useLayoutEffect } from "react";
import BrandLoader from "../ui/BrandLoader";
import { setPageTranslatable } from "@/lib/utils";

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoaded, isSignedIn } = useAuth();

  // Toda rota protegida e area logada (/dashboard, /demo, /admin, /affiliate):
  // sem traducao automatica enquanto ela estiver montada. Ver setPageTranslatable.
  useLayoutEffect(() => {
    setPageTranslatable(false);
    return () => setPageTranslatable(true);
  }, []);

  if (!isLoaded) {
    return <BrandLoader />;
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

