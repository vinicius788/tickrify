import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Check, Star } from "lucide-react";
import { createCheckoutSession, type BillingCycle, type Currency, type PlanType } from "../../lib/stripe";
import { warmupPaymentsApi } from "../../lib/api";
import { track } from "../../lib/analytics";
import { Button } from "../ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { useToast } from "../../hooks/use-toast";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const SESSION_STORAGE_KEY = "pendingPlanType";

// Conteúdo visível dos cards — em inglês por padrão (público global), PT quando o
// idioma for português. O array PLANS abaixo também usa inglês como default
// (auditoria 24/07/2026: produto global; qualquer consumidor novo do PLANS,
// como o modal do dashboard, herda inglês em vez de português).
//
// REGRA: nenhum bullet aqui pode descrever recurso que não existe no código.
// Removidos em 24/07: "Priority responses", "Priority execution", "Priority
// support" (a fila BullMQ é única, sem campo priority) e "Institutional-grade
// AI" (o modelo é escolhido por tipo de análise, nunca por plano — todos os
// planos rodam o mesmo motor).
type PlanCopy = { badge: string; ticks: string; analyses: string; features: string[]; cta: string };
const PLAN_COPY: Record<"en" | "pt", Record<PlanType, PlanCopy>> = {
  en: {
    starter: {
      badge: "Everything included",
      ticks: "200 ticks/mo",
      analyses: "quick 1 tick · deep 3 ticks",
      features: [
        "200 monthly Ticks (~200 quick or 66 deep)",
        "Quick + deep analysis",
        "Live candle grounding + economic calendar",
        "Under $0.10 per quick analysis",
      ],
      cta: "Get started",
    },
    pro: {
      badge: "Most popular",
      ticks: "150 ticks/mo",
      analyses: "quick 1 tick · deep 3 ticks",
      features: [
        "150 monthly Ticks (~150 quick or 50 deep)",
        "Quick + deep analysis",
        "Full history",
        "$0.19 per quick analysis",
        "Everything in Starter, 3.3x the volume",
      ],
      cta: "Get Pro",
    },
    elite: {
      badge: "High volume",
      ticks: "400 ticks/mo",
      analyses: "quick 1 tick · deep 3 ticks",
      features: [
        "400 monthly Ticks (~400 quick or 133 deep)",
        "Quick + deep analysis",
        "Full history",
        "$0.15 per quick analysis — the lowest",
        "Everything in Pro, 2.7x the volume",
      ],
      cta: "Get Elite",
    },
  },
  pt: {
    starter: {
      badge: "Tudo incluído",
      ticks: "200 ticks/mês",
      analyses: "rápida 1 tick · deep 3 ticks",
      features: [
        "200 Ticks mensais (~200 rápidas ou 66 deep)",
        "Análise rápida + deep",
        "Grounding com candles ao vivo + calendário econômico",
        "Menos de US$ 0,10 por análise rápida",
      ],
      cta: "Começar",
    },
    pro: {
      badge: "Mais escolhido",
      ticks: "150 ticks/mês",
      analyses: "rápida 1 tick · deep 3 ticks",
      features: [
        "150 Ticks mensais (~150 rápidas ou 50 deep)",
        "Análise rápida + deep",
        "Histórico completo",
        "US$ 0,19 por análise rápida",
        "Tudo do Starter, 3,3x o volume",
      ],
      cta: "Assinar Pro",
    },
    elite: {
      badge: "Alto volume",
      ticks: "400 ticks/mês",
      analyses: "rápida 1 tick · deep 3 ticks",
      features: [
        "400 Ticks mensais (~400 rápidas ou 133 deep)",
        "Análise rápida + deep",
        "Histórico completo",
        "US$ 0,15 por análise rápida — o menor",
        "Tudo do Pro, 2,7x o volume",
      ],
      cta: "Assinar Elite",
    },
  },
};

const CHROME_COPY = {
  en: {
    monthly: "Monthly",
    yearly: "Yearly",
    yearlyBadge: "2 months free",
    perMonth: "/mo",
    perYear: "/yr",
    processing: "Processing...",
    processingTitle: "Processing your subscription...",
    processingSub: "Redirecting to payment",
    errorTitle: "Error",
    tokenError: "Could not get authentication token",
    checkoutError: "Failed to create checkout session. Please try again.",
  },
  pt: {
    monthly: "Mensal",
    yearly: "Anual",
    yearlyBadge: "2 meses grátis",
    perMonth: "/mês",
    perYear: "/ano",
    processing: "Processando...",
    processingTitle: "Processando sua assinatura...",
    processingSub: "Redirecionando para pagamento",
    errorTitle: "Erro",
    tokenError: "Não foi possível obter token de autenticação",
    checkoutError: "Falha ao criar sessão de checkout. Tente novamente.",
  },
};

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

// PLANO ÚNICO. Os tiers Pro e Elite saíram da vitrine em 27/07/2026 — eles
// diferiam só em volume e o Starter era mais caro por análise que o pacote
// avulso. Os price IDs antigos continuam no backend para assinaturas legadas.
// Checkout sempre em USD (ver `currency` abaixo), então os campos brl/eur são
// só rótulo e repetem o valor em dólar de propósito.
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Tickrify",
    badge: "Everything included",
    prices: {
      monthly: { brl: "$19", usd: "$19", eur: "$19" },
      yearly:  { brl: "$190", usd: "$190", eur: "$190" },
    },
    ticks: "200 ticks/mo",
    analyses: "quick 1 tick · deep 3 ticks",
    featured: true,
    icon: <Star className="w-8 h-8 text-primary" />,
    features: [
      "200 monthly Ticks (~200 quick or 66 deep)",
      "Quick + deep analysis",
      "Live candle grounding + economic calendar",
      "Under $0.10 per quick analysis",
    ],
    cta: "Get started",
  },
];

export function PricingCards() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const lang = language === "pt" ? "pt" : "en";
  const copy = CHROME_COPY[lang];
  const planCopy = PLAN_COPY[lang];
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null);
  const [processingUpgrade, setProcessingUpgrade] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  // Global product: prices always in USD, regardless of site language.
  const currency: Currency = "usd";

  // Acorda a API de pagamentos assim que a página de planos monta, para que o
  // clique em "Get Pro" segundos depois não caia no cold start do Render.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

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
            title: copy.errorTitle,
            description: copy.tokenError,
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
          title: copy.errorTitle,
          description:
            error instanceof Error ? error.message : copy.checkoutError,
          variant: "destructive",
        });
      } finally {
        setLoadingPlan(null);
        setProcessingUpgrade(false);
      }
    },
    [getToken, isSignedIn, toast, billingCycle, currency, copy],
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
        <p className="text-lg text-muted-foreground">{copy.processingTitle}</p>
        <p className="text-sm text-muted-foreground">{copy.processingSub}</p>
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
          {copy.monthly}
        </button>
        <button
          onClick={() => setBillingCycle("yearly")}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            billingCycle === "yearly"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {copy.yearly}
          <span className="ml-1.5 text-xs bg-green-500/15 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full">
            {copy.yearlyBadge}
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
                  {planCopy[plan.id].badge}
                </span>
              </div>
            )}

            <CardHeader className="text-center pt-8">
              <div className="mx-auto mb-3">{plan.icon}</div>
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              {!plan.featured && (
                <span className="inline-block text-xs text-muted-foreground border border-border rounded-full px-3 py-0.5 mt-1">
                  {planCopy[plan.id].badge}
                </span>
              )}
              <div className="mt-4">
                <span className="text-4xl font-bold">{plan.prices[billingCycle][currency]}</span>
                <span className="text-muted-foreground">
                  {billingCycle === "monthly" ? copy.perMonth : copy.perYear}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {planCopy[plan.id].ticks} · {planCopy[plan.id].analyses}
              </p>
            </CardHeader>

            <CardContent className="flex-1">
              <ul className="space-y-3">
                {planCopy[plan.id].features.map((feature) => (
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
                    {copy.processing}
                  </div>
                ) : (
                  planCopy[plan.id].cta
                )}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
