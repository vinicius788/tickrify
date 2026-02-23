import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@clerk/clerk-react";
import { createCheckoutSession, type BillingCycle } from "../../lib/stripe";
import { useToast } from "../../hooks/use-toast";

const SESSION_STORAGE_KEY = "pendingProBillingCycle";
const ENABLE_ANNUAL_BILLING = import.meta.env.VITE_ENABLE_ANNUAL_BILLING === "true";
const PLAN_FEATURES = [
  "Análises ilimitadas",
  "Análise avançada de IA",
  "Histórico ilimitado",
  "Indicadores personalizados",
  "Alertas em tempo real",
  "API de acesso",
  "Suporte prioritário 24/7",
];

const BILLING_OPTIONS: Record<BillingCycle, { priceLabel: string; periodLabel: string; cta: string; helper: string }> = {
  monthly: {
    priceLabel: "R$ 80",
    periodLabel: "/mês",
    cta: "Assinar Pro Mensal",
    helper: "Cobrança mensal recorrente",
  },
  annual: {
    priceLabel: "R$ 960",
    periodLabel: "/ano",
    cta: "Assinar Pro Anual",
    helper: "Cobrança anual recorrente",
  },
};

const PricingSection = () => {
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

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout ao conectar com servidor")), 10000),
      );
      const checkoutPromise = createCheckoutSession("pro", token, normalizedCycle);
      const { url } = (await Promise.race([checkoutPromise, timeoutPromise])) as { url: string };

      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.location.href = url;
    } catch (error) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Falha ao criar sessão de checkout. Verifique se o backend está rodando.";
      toast({
        title: "Erro ao processar pagamento",
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
      <section id="pricing" className="py-20 md:py-28">
        <div className="container">
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-lg text-muted-foreground">Processando sua assinatura...</p>
            <p className="text-sm text-muted-foreground">Redirecionando para pagamento</p>
          </div>
        </div>
      </section>
    );
  }

  const selected = BILLING_OPTIONS[billingCycle];
  const isLoading = loadingCycle === billingCycle;

  return (
    <section id="pricing" className="py-20 md:py-28">
      <div className="container">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold md:text-4xl">Plano Pro</h2>
          <p className="mt-4 text-muted-foreground">
            {ENABLE_ANNUAL_BILLING
              ? "Um único plano completo, com escolha de cobrança mensal ou anual."
              : "Um único plano completo, com cobrança mensal."}
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center">
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

        <div className="mt-10 max-w-xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="h-full"
          >
            <Card className="flex flex-col h-full border-primary shadow-lg shadow-primary/20">
              <CardHeader>
                <div className="text-primary font-semibold text-sm">PRO</div>
                <CardTitle className="text-2xl mt-2">Tickrify Pro</CardTitle>
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold font-mono">{selected.priceLabel}</span>
                  <span className="text-muted-foreground">{selected.periodLabel}</span>
                </div>
                <CardDescription>{selected.helper}</CardDescription>
              </CardHeader>

              <CardContent className="flex-grow">
                <ul className="space-y-3">
                  {PLAN_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-center">
                      <Check className="h-4 w-4 text-primary mr-2" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                <Button
                  className="w-full"
                  variant="default"
                  onClick={() => handleUpgrade(billingCycle)}
                  disabled={isLoading}
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
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
