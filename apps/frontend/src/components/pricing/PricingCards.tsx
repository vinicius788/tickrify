import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { CheckoutError, createCheckoutSession, type BillingCycle, type Currency, type PlanType } from "../../lib/stripe";
import { buildApiUrl, warmupPaymentsApi } from "../../lib/api";
import { getReferralCoupon, isAffiliateCode, saveReferralCoupon } from "../../lib/attribution";
import { track } from "../../lib/analytics";
import { useToast } from "../../hooks/use-toast";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  authUrlForCheckout,
  clearCheckoutIntent,
  loadCheckoutIntent,
  parseCheckoutIntent,
  saveCheckoutIntent,
  type CheckoutIntent,
  type CheckoutSource,
} from "@/lib/checkoutIntent";

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
    alreadySubscribedTitle: "You are already subscribed",
    alreadySubscribedDesc: "Your plan is active. Manage it from your dashboard.",
    partnerAsk: "Have a partner code?",
    partnerApply: "Apply",
    partnerApplied: (code: string) => `Partner code ${code} applied. Checkout uses the best discount available to you.`,
    partnerInvalid: "That code is not valid.",
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
    alreadySubscribedTitle: "Você já é assinante",
    alreadySubscribedDesc: "Seu plano está ativo. Gerencie pelo painel.",
    partnerAsk: "Tem um código de parceiro?",
    partnerApply: "Aplicar",
    partnerApplied: (code: string) => `Código de parceiro ${code} aplicado. O checkout usa o maior desconto disponível para você.`,
    partnerInvalid: "Esse código não é válido.",
  },
};

type PriceMap = Record<BillingCycle, Record<Currency, string>>;

/**
 * Cupom de parceiro digitado no site. So identifica o afiliado: o servidor
 * valida o codigo aqui e de novo no checkout, e decide sozinho o desconto (o
 * EARLY35 ganha enquanto existir, porque e maior). Fica guardado e vai junto
 * no pedido de checkout, inclusive depois do login.
 */
function PartnerCode({ copy }: { copy: (typeof CHROME_COPY)["en"] }) {
  const [applied, setApplied] = useState<string | null>(() => getReferralCoupon());
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "invalid">("idle");

  const apply = async () => {
    const code = value.trim().toUpperCase();
    if (!isAffiliateCode(code)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    try {
      const res = await fetch(buildApiUrl("/api/affiliates/track"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, kind: "coupon" }),
      });
      const data = res.ok ? ((await res.json()) as { valid?: boolean }) : null;
      if (!data?.valid) {
        setStatus("invalid");
        return;
      }
      saveReferralCoupon(code);
      setApplied(code);
      setStatus("idle");
    } catch {
      setStatus("invalid");
    }
  };

  if (applied) return <p className="site-price-fine">{copy.partnerApplied(applied)}</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="site-price-fine underline underline-offset-2">
        {copy.partnerAsk}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setStatus("idle");
        }}
        maxLength={20}
        aria-label={copy.partnerAsk}
        className="w-40 rounded-lg border border-[var(--s-hair-l)] bg-transparent px-3 py-2 text-base uppercase text-[var(--s-on-light)]"
      />
      <button type="button" onClick={apply} disabled={status === "checking"} className="site-btn site-btn-sm site-btn-ghost">
        {copy.partnerApply}
      </button>
      {status === "invalid" ? <p className="site-price-fine w-full">{copy.partnerInvalid}</p> : null}
    </div>
  );
}

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
  // Trava sincrona: o `loadingPlan` e estado e so vale no proximo render, entao
  // clique duplo ou o useEffect de retomada chegavam juntos e abriam duas
  // sessoes (visto na Stripe: pares no mesmo segundo).
  const checkoutInFlight = useRef(false);

  // Voltar da Stripe pelo botao do navegador restaura a pagina do bfcache com
  // a trava ligada e o botao girando para sempre. Destrava nesse caso.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      checkoutInFlight.current = false;
      setLoadingPlan(null);
      setProcessingUpgrade(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Global product: prices always in USD, regardless of site language.
  const currency: Currency = "usd";

  // Acorda a API de pagamentos assim que a página de planos monta, para que o
  // clique em "Get Pro" segundos depois não caia no cold start do Render.
  useEffect(() => {
    warmupPaymentsApi();
  }, []);

  const handleUpgrade = useCallback(
    async (
      planType: PlanType,
      options: { cycle?: BillingCycle; source?: CheckoutSource; resumed?: boolean } = {},
    ) => {
      const cycle = options.cycle ?? billingCycle;
      const source = options.source ?? "pricing";
      // INTENÇÃO de compra. `resumed` = voltou do login e seguiu sozinho; nao e
      // um segundo clique, entao nao conta outro upgrade_clicked.
      if (!options.resumed) {
        track('upgrade_clicked', { plan: planType, cycle, source, signedIn: Boolean(isSignedIn) });
      }
      if (!isSignedIn) {
        // Login/cadastro devolve para /pricing?checkout=... e o efeito abaixo
        // retoma a compra. Antes ia para /sign-in sem destino e o Clerk
        // mandava todo mundo para o /dashboard: a intencao morria ali.
        const intent: CheckoutIntent = { plan: planType, cycle, source };
        saveCheckoutIntent(intent);
        window.location.href = authUrlForCheckout(intent);
        return;
      }

      if (checkoutInFlight.current) return;
      checkoutInFlight.current = true;
      // Com o redirect ja disparado a trava fica ligada: o navegador ainda leva
      // um instante para sair da pagina e o botao nao pode voltar a ser clicavel.
      let redirecting = false;

      try {
        setLoadingPlan(planType);
        const token = await getToken({ skipCache: true });
        if (!token) {
          track('checkout_failed', { source, plan: planType, code: 'no_token' });
          toast({
            title: copy.errorTitle,
            description: copy.tokenError,
            variant: "destructive",
          });
          return;
        }

        /* EARLY35 pre-aplicado, igual ao paywall do painel.
         *
         * ⚠️ ISTO CUSTOU UMA VENDA, e o Stripe tem o recibo: em 12/09/2026 um
         * cliente japones foi cobrado US$ 29,00 e nao concluiu, enquanto os
         * tres assinantes que converteram pelo PAYWALL pagaram US$ 18,85
         * (29 x 0,65). A diferenca nao era moeda nem pais: o paywall mandava
         * o cupom e esta pagina nao, entao quem vinha por aqui tinha que
         * DIGITAR "EARLY35" no checkout da Stripe para receber o desconto que
         * a propria pagina anuncia. Quem nao digitava pagava 54% a mais.
         *
         * A copy da /pricing foi ajustada junto: ela nao pede mais o codigo,
         * porque agora nao ha codigo para pedir. */
        const { url, sessionId } = await createCheckoutSession(planType, token, cycle, currency, 'EARLY35', source);
        // Dispara SO com a URL da Stripe em maos: antes saia antes da chamada a
        // API e contava clique como checkout, inclusive quando a sessao falhava.
        track('checkout_started', {
          plan: planType,
          billingCycle: cycle,
          currency,
          coupon: 'EARLY35',
          source,
          sessionId,
          resumedAfterAuth: Boolean(options.resumed),
        });
        clearCheckoutIntent();
        redirecting = true;
        window.location.href = url;
      } catch (error) {
        // Falhou: a intencao sai do storage para nao reabrir o checkout sozinha
        // na proxima visita. O botao continua na tela para tentar de novo.
        clearCheckoutIntent();
        const code = error instanceof CheckoutError ? error.code : undefined;
        track('checkout_failed', {
          source,
          plan: planType,
          resumedAfterAuth: Boolean(options.resumed),
          code: code ?? 'unknown',
          message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        });
        if (code === 'already_subscribed') {
          // O aviso vai junto para o painel: um toast aqui morria no
          // recarregamento da pagina e a pessoa via so o painel, sem saber por que.
          try {
            sessionStorage.setItem(
              "tickrify_flash",
              JSON.stringify({ title: copy.alreadySubscribedTitle, description: copy.alreadySubscribedDesc }),
            );
          } catch {
            toast({ title: copy.alreadySubscribedTitle, description: copy.alreadySubscribedDesc });
          }
          redirecting = true;
          window.location.href = "/dashboard";
          return;
        }
        toast({
          title: copy.errorTitle,
          description:
            error instanceof Error ? error.message : copy.checkoutError,
          variant: "destructive",
        });
      } finally {
        if (!redirecting) {
          checkoutInFlight.current = false;
          setLoadingPlan(null);
          setProcessingUpgrade(false);
        }
      }
    },
    [getToken, isSignedIn, toast, billingCycle, currency, copy],
  );

  // Retomada depois do login/cadastro: a URL traz a intencao (caminho normal) e
  // o localStorage cobre quem chegou sem ela (One Tap, e-mail em outra aba).
  // Roda UMA vez por montagem, e so com o Clerk carregado e a sessao valida.
  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (!isLoaded || !isSignedIn || resumeAttempted.current) return;
    const intent = parseCheckoutIntent(window.location.search) ?? loadCheckoutIntent();
    if (!intent) return;
    resumeAttempted.current = true;

    // Tira os parametros da barra: recarregar a pagina nao pode abrir outro
    // checkout, e o botao voltar da Stripe nao deve cair num loop.
    const url = new URL(window.location.href);
    ["checkout", "cycle", "source"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

    setBillingCycle(intent.cycle);
    setProcessingUpgrade(true);
    void handleUpgrade(intent.plan, { cycle: intent.cycle, source: intent.source, resumed: true });
  }, [handleUpgrade, isLoaded, isSignedIn]);

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

      <div className="mt-4 text-center">
        <PartnerCode copy={copy} />
      </div>
    </div>
  );
}
