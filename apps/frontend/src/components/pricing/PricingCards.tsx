import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { createCheckoutSession, type BillingCycle, type Currency, type PlanType } from "../../lib/stripe";
import { warmupPaymentsApi } from "../../lib/api";
import { track } from "../../lib/analytics";
import { useToast } from "../../hooks/use-toast";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const SESSION_STORAGE_KEY = "pendingPlanType";

// Check desenhado à mão: o ícone da lucide vem em 24px e a lista do card pede 14.
const Check = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 7.4 5.6 10.5 11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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
        "$0.145 per quick analysis, cheaper than buying Ticks one by one",
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
        "$0.15 per quick analysis, the lowest",
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
        "US$ 0,145 por análise rápida, mais barato que Ticks avulsos",
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
        "US$ 0,15 por análise rápida, o menor",
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
  featured: boolean;
  features: string[];
  cta: string;
};

// PLANO ÚNICO. Os tiers Pro e Elite saíram da vitrine em 27/07/2026 — eles
// diferiam so em volume e o Starter era mais caro por analise que o pacote
// avulso. Os price IDs antigos continuam no backend para assinaturas legadas.
// Checkout sempre em USD (ver `currency` abaixo), então os campos brl/eur são
// só rótulo e repetem o valor em dólar de propósito.
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Tickrify",
    badge: "Everything included",
    prices: {
      monthly: { brl: "$29", usd: "$29", eur: "$29" },
      yearly:  { brl: "$290", usd: "$290", eur: "$290" },
    },
    ticks: "200 ticks/mo",
    featured: true,
    features: [
      "200 monthly Ticks (~200 quick or 66 deep)",
      "Quick + deep analysis",
      "Live candle grounding + economic calendar",
      "$0.145 per quick analysis, cheaper than buying Ticks one by one",
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
      <div className="site-price site-price-busy">
        <span className="site-spin" aria-hidden="true" />
        <p>{copy.processingTitle}</p>
        <p className="site-price-fine">{copy.processingSub}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Ciclo de cobrança. Dois botões com aria-pressed em vez de um switch:
          o estado fica legível para leitor de tela e para quem só olha. */}
      <div className="site-cycle" role="group" aria-label="Billing cycle">
        <button
          type="button"
          aria-pressed={billingCycle === "monthly"}
          onClick={() => setBillingCycle("monthly")}
          className={`site-btn site-btn-sm ${billingCycle === "monthly" ? "site-btn-primary" : "site-btn-ghost"}`}
        >
          {copy.monthly}
        </button>
        <button
          type="button"
          aria-pressed={billingCycle === "yearly"}
          onClick={() => setBillingCycle("yearly")}
          className={`site-btn site-btn-sm ${billingCycle === "yearly" ? "site-btn-primary" : "site-btn-ghost"}`}
        >
          {copy.yearly} · {copy.yearlyBadge}
        </button>
      </div>

      {/* Uma coluna POR PLANO. O `md:grid-cols-3` era fixo e, desde que a vitrine
          virou plano único (27/07/2026), o card sozinho caía na primeira coluna
          de três, e a página inteira ficava encostada na esquerda enquanto o
          título e o banner acima seguiam centralizados. Derivado de PLANS.length
          para não quebrar de novo se um segundo plano voltar. */}
      <div className={PLANS.length > 1 ? "site-plans" : undefined}>
        {PLANS.map((plan) => (
          <div key={plan.id} className="site-price">
            <span className="site-eyebrow">{planCopy[plan.id].badge}</span>
            <div className="site-price-amt">
              <b>{plan.prices[billingCycle][currency]}</b>
              <span>{billingCycle === "monthly" ? copy.perMonth : copy.perYear}</span>
            </div>
            <p className="site-price-sub">
              {planCopy[plan.id].ticks} · {planCopy[plan.id].analyses}
            </p>

            <ul>
              {planCopy[plan.id].features.map((feature) => (
                <li key={feature}>
                  <Check />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => handleUpgrade(plan.id)}
              disabled={loadingPlan !== null}
              className="site-btn site-btn-primary site-btn-block"
            >
              {loadingPlan === plan.id ? copy.processing : planCopy[plan.id].cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
