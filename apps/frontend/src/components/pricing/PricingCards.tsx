import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, Zap, Star, Trophy } from "lucide-react";
import { createCheckoutSession, detectCurrency, type BillingCycle, type Currency, type PlanType } from "../../lib/stripe";
import { track } from "../../lib/analytics";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { useToast } from "../../hooks/use-toast";

const SESSION_STORAGE_KEY = "pendingPlanType";

type PriceMap = Record<BillingCycle, Record<Currency, string>>;

type Plan = {
  id: PlanType;
  name: string;
  badge: string;
  prices: PriceMap;
  ticks: string;
  analyses: string;
  featured: boolean;
  icon: React.ReactNode;
  features: string[];
  cta: string;
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    badge: "Entrada",
    prices: {
      monthly: { brl: "R$ 57", usd: "$12", eur: "€11" },
      yearly:  { brl: "R$ 570", usd: "$120", eur: "€110" },
    },
    ticks: "45 ticks/mês",
    analyses: "rápida 1 tick · deep 3 ticks",
    featured: false,
    icon: <Zap className="w-8 h-8 text-muted-foreground" />,
    features: [
      "45 Ticks mensais",
      "Análise rápida",
      "Análise deep",
      "Histórico completo",
    ],
    cta: "Assinar Starter",
  },
  {
    id: "pro",
    name: "Pro",
    badge: "Mais escolhido",
    prices: {
      monthly: { brl: "R$ 147", usd: "$29", eur: "€27" },
      yearly:  { brl: "R$ 1.470", usd: "$290", eur: "€270" },
    },
    ticks: "150 ticks/mês",
    analyses: "rápida 1 tick · deep 3 ticks",
    featured: true,
    icon: <Star className="w-8 h-8 text-primary" />,
    features: [
      "150 Ticks mensais",
      "Análise rápida + deep completa",
      "Melhor custo por análise",
      "Histórico completo",
      "Prioridade nas respostas",
    ],
    cta: "Assinar Pro",
  },
  {
    id: "elite",
    name: "Elite",
    badge: "Institucional",
    prices: {
      monthly: { brl: "R$ 297", usd: "$59", eur: "€55" },
      yearly:  { brl: "R$ 2.970", usd: "$590", eur: "€550" },
    },
    ticks: "400 ticks/mês",
    analyses: "rápida 1 tick · deep 3 ticks",
    featured: false,
    icon: <Trophy className="w-8 h-8 text-yellow-500" />,
    features: [
      "400 Ticks mensais",
      "IA nível institucional",
      "Execução prioritária",
      "Histórico completo",
      "Suporte prioritário",
    ],
    cta: "Assinar Elite",
  },
];

export function PricingCards() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { toast } = useToast();
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null);
  const [processingUpgrade, setProcessingUpgrade] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  const currency: Currency = detectCurrency(
    typeof navigator !== "undefined" ? navigator.language : "pt-BR"
  );

  const handleUpgrade = useCallback(
    async (planType: PlanType) => {
      // INTENÇÃO de compra: clicou num plano (antes de qualquer redirect).
      // O gap entre este evento e checkout_started = não-logados + falhas de token/sessão.
      track('upgrade_clicked', { plan: planType, signedIn: Boolean(isSignedIn) });
      if (!isSignedIn) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, planType);
        window.location.href = "/sign-in";
        return;
      }

      try {
        setLoadingPlan(planType);
        const token = await getToken({ skipCache: true });
        if (!token) {
          toast({
            title: "Erro",
            description: "Não foi possível obter token de autenticação",
            variant: "destructive",
          });
          return;
        }

        track('checkout_started', { plan: planType, billingCycle, currency });
        const { url } = await createCheckoutSession(planType, token, billingCycle, currency);
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        window.location.href = url;
      } catch (error) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        toast({
          title: "Erro",
          description:
            error instanceof Error
              ? error.message
              : "Falha ao criar sessão de checkout. Tente novamente.",
          variant: "destructive",
        });
      } finally {
        setLoadingPlan(null);
        setProcessingUpgrade(false);
      }
    },
    [getToken, isSignedIn, toast, billingCycle, currency],
  );

  useEffect(() => {
    const processUpgrade = async () => {
      if (isLoaded && isSignedIn && !processingUpgrade) {
        const pending = sessionStorage.getItem(SESSION_STORAGE_KEY) as PlanType | null;
        if (pending && ["starter", "pro", "elite"].includes(pending)) {
          setProcessingUpgrade(true);
          await handleUpgrade(pending);
        }
      }
    };

    void processUpgrade();
  }, [handleUpgrade, isLoaded, isSignedIn, processingUpgrade]);

  if (processingUpgrade) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-lg text-muted-foreground">Processando sua assinatura...</p>
        <p className="text-sm text-muted-foreground">Redirecionando para pagamento</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Billing cycle toggle */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setBillingCycle("monthly")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            billingCycle === "monthly"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Mensal
        </button>
        <button
          onClick={() => setBillingCycle("yearly")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            billingCycle === "yearly"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Anual
          <span className="ml-1.5 text-xs bg-green-500/15 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full">
            2 meses grátis
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
        {PLANS.map((plan) => (
          <Card
            key={plan.id}
            className={`relative flex flex-col ${
              plan.featured
                ? "border-2 border-primary shadow-xl scale-[1.03]"
                : "border border-border"
            }`}
          >
            {plan.featured && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <span className="bg-primary text-primary-foreground px-4 py-1 rounded-full text-sm font-semibold whitespace-nowrap">
                  {plan.badge}
                </span>
              </div>
            )}

            <CardHeader className="text-center pt-8">
              <div className="mx-auto mb-3">{plan.icon}</div>
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              {!plan.featured && (
                <span className="inline-block text-xs text-muted-foreground border border-border rounded-full px-3 py-0.5 mt-1">
                  {plan.badge}
                </span>
              )}
              <div className="mt-4">
                <span className="text-4xl font-bold">{plan.prices[billingCycle][currency]}</span>
                <span className="text-muted-foreground">
                  {billingCycle === "monthly" ? "/mês" : "/ano"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {plan.ticks} · {plan.analyses}
              </p>
            </CardHeader>

            <CardContent className="flex-1">
              <ul className="space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>

            <CardFooter>
              <Button
                className="w-full"
                size="lg"
                variant={plan.featured ? "default" : "outline"}
                onClick={() => handleUpgrade(plan.id)}
                disabled={loadingPlan !== null}
              >
                {loadingPlan === plan.id ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Processando...
                  </div>
                ) : (
                  plan.cta
                )}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
