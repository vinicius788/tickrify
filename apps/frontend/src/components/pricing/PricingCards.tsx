import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, Zap } from "lucide-react";
import { createCheckoutSession, type BillingCycle } from "../../lib/stripe";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { useToast } from "../../hooks/use-toast";

const SESSION_STORAGE_KEY = "pendingProBillingCycle";
const ENABLE_ANNUAL_BILLING = import.meta.env.VITE_ENABLE_ANNUAL_BILLING === "true";
const FEATURES = [
  "Análises ilimitadas",
  "Análise avançada de IA",
  "Histórico ilimitado",
  "Indicadores personalizados",
  "Alertas em tempo real",
  "API de acesso",
  "Suporte prioritário 24/7",
];

const BILLING_OPTIONS: Record<BillingCycle, { price: string; period: string; cta: string; helper: string }> = {
  monthly: {
    price: "R$ 80",
    period: "/mês",
    cta: "Assinar Mensal",
    helper: "Cobrança mensal recorrente",
  },
  annual: {
    price: "R$ 960",
    period: "/ano",
    cta: "Assinar Anual",
    helper: "Cobrança anual recorrente",
  },
};

export function PricingCards() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { toast } = useToast();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [loadingCycle, setLoadingCycle] = useState<BillingCycle | null>(null);
  const [processingUpgrade, setProcessingUpgrade] = useState(false);

  const normalizeCycle = useCallback((cycle: BillingCycle): BillingCycle => {
    if (cycle === "annual" && !ENABLE_ANNUAL_BILLING) {
      return "monthly";
    }
    return cycle;
  }, []);

  const handleUpgrade = useCallback(async (cycle: BillingCycle) => {
    if (!isSignedIn) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, normalizeCycle(cycle));
      window.location.href = "/sign-in";
      return;
    }

    try {
      const normalizedCycle = normalizeCycle(cycle);
      setLoadingCycle(normalizedCycle);
      const token = await getToken();
      if (!token) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        toast({
          title: "Erro",
          description: "Não foi possível obter token de autenticação",
          variant: "destructive",
        });
        return;
      }

      const { url } = await createCheckoutSession("pro", token, normalizedCycle);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.location.href = url;
    } catch (error) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Falha ao criar sessão de checkout. Tente novamente.";
      toast({
        title: "Erro",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoadingCycle(null);
      setProcessingUpgrade(false);
    }
  }, [getToken, isSignedIn, normalizeCycle, toast]);

  useEffect(() => {
    const processUpgrade = async () => {
      if (isLoaded && isSignedIn && !processingUpgrade) {
        const pendingCycle = sessionStorage.getItem(SESSION_STORAGE_KEY) as BillingCycle | null;
        if (pendingCycle === "monthly" || pendingCycle === "annual") {
          const normalizedCycle = normalizeCycle(pendingCycle);
          setProcessingUpgrade(true);
          setBillingCycle(normalizedCycle);
          await handleUpgrade(normalizedCycle);
        }
      }
    };

    void processUpgrade();
  }, [handleUpgrade, isLoaded, isSignedIn, normalizeCycle, processingUpgrade]);

  if (processingUpgrade) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-lg text-muted-foreground">Processando sua assinatura...</p>
        <p className="text-sm text-muted-foreground">Redirecionando para pagamento</p>
      </div>
    );
  }

  const selected = BILLING_OPTIONS[billingCycle];
  const isLoading = loadingCycle === billingCycle;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-center mb-8">
        <div className="inline-flex rounded-lg border border-border p-1 bg-card/60">
          <Button
            variant={billingCycle === "monthly" ? "default" : "ghost"}
            size="sm"
            onClick={() => setBillingCycle("monthly")}
          >
            Mensal
          </Button>
          {ENABLE_ANNUAL_BILLING && (
            <Button
              variant={billingCycle === "annual" ? "default" : "ghost"}
              size="sm"
              onClick={() => setBillingCycle("annual")}
            >
              Anual
            </Button>
          )}
        </div>
      </div>

      <Card className="relative border-2 border-primary shadow-xl">
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold">
            Plano Único
          </span>
        </div>

        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Zap className="w-12 h-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">Tickrify Pro</CardTitle>
          <CardDescription>{selected.helper}</CardDescription>
          <div className="mt-4">
            <span className="text-4xl font-bold">{selected.price}</span>
            <span className="text-muted-foreground">{selected.period}</span>
          </div>
        </CardHeader>

        <CardContent>
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <span className="text-sm">{feature}</span>
              </li>
            ))}
          </ul>
        </CardContent>

        <CardFooter>
          <Button
            className="w-full"
            size="lg"
            onClick={() => handleUpgrade(billingCycle)}
            disabled={isLoading}
            variant="default"
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Processando...
              </div>
            ) : (
              selected.cta
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
