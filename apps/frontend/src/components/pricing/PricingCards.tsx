import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, Zap, Star, Trophy } from "lucide-react";
import { createCheckoutSession, type PlanType } from "../../lib/stripe";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { useToast } from "../../hooks/use-toast";

const SESSION_STORAGE_KEY = "pendingPlanType";

type Plan = {
  id: PlanType;
  name: string;
  badge: string;
  price: string;
  ticks: string;
  analyses: string;
  featured: boolean;
  icon: React.ReactNode;
  features: string[];
  cta: string;
};

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    badge: "Entrada",
    price: "R$ 57",
    ticks: "45 ticks/mês",
    analyses: "~15 análises",
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
    price: "R$ 147",
    ticks: "150 ticks/mês",
    analyses: "~50 análises",
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
    price: "R$ 297",
    ticks: "400 ticks/mês",
    analyses: "~150 análises",
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

  const handleUpgrade = useCallback(
    async (planType: PlanType) => {
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

        const { url } = await createCheckoutSession(planType, token, "monthly");
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
    [getToken, isSignedIn, toast],
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
              <span className="text-4xl font-bold">{plan.price}</span>
              <span className="text-muted-foreground">/mês</span>
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
  );
}
