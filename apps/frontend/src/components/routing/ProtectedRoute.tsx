import { useAuth } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";
import { ReactNode, useEffect, useLayoutEffect } from "react";
import BrandLoader from "../ui/BrandLoader";
import { setPageTranslatable } from "@/lib/utils";
import { applyThemeForPath, syncThemeFromServer } from "@/lib/theme";

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();

  // Toda rota protegida e area logada (/dashboard, /demo, /admin, /affiliate):
  // sem traducao automatica enquanto ela estiver montada. Ver setPageTranslatable.
  // O mesmo vale para o tema claro: so a area logada muda, a vitrine segue
  // escura. useLayoutEffect para trocar antes da pintura.
  useLayoutEffect(() => {
    setPageTranslatable(false);
    applyThemeForPath(window.location.pathname);
    return () => {
      setPageTranslatable(true);
      document.documentElement.removeAttribute('data-theme');
    };
  }, []);

  // Tema guardado na conta (vale em outro aparelho e depois de sair e entrar).
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    void getToken()
      .then((token) => (token ? syncThemeFromServer(token) : undefined))
      .catch(() => undefined);
  }, [isSignedIn, userId, getToken]);

  if (!isLoaded) {
    return <BrandLoader />;
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;

