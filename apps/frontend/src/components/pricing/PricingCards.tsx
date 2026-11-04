import { errorText } from '@/lib/i18n/messages';
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { CheckoutError, createCheckoutSession, getCheckoutStatus, type BillingCycle, type Currency, type PlanType } from "../../lib/stripe";
import { buildApiUrl, warmupPaymentsApi } from "../../lib/api";
import { getReferralCoupon, isAffiliateCode, saveReferralCoupon } from "../../lib/attribution";
import { track } from "../../lib/analytics";
import { useToast } from "../../hooks/use-toast";
import { firstMonthPrice, useFounderOffer, useFoundingOffer } from "@/hooks/useFoundingOffer";
import { interpolate, LOCALES, formatNumber, type Language, type Translations } from "@/lib/i18n";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  FOUNDER_CODE_PATTERN,
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

type PriceMap = Record<BillingCycle, Record<Currency, string>>;

/**
 * Cupom de parceiro digitado no site. So identifica o afiliado: o servidor
 * valida o codigo aqui e de novo no checkout, e decide sozinho o desconto (o
 * EARLY35 ganha enquanto existir, porque e maior). Fica guardado e vai junto
 * no pedido de checkout, inclusive depois do login.
 */
function PartnerCode({ copy }: { copy: Translations["pricingChrome"] }) {
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

  if (applied) return <p className="site-price-fine">{interpolate(copy.partnerApplied, { code: applied })}</p>;
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
  id: "starter";
  prices: PriceMap;
};

// PLANO ÚNICO. Os tiers Pro e Elite saíram da vitrine em 27/07/2026 — eles
// diferiam so em volume e o Starter era mais caro por analise que o pacote
// avulso. Os price IDs antigos continuam no backend para assinaturas legadas.
// Checkout sempre em USD (ver `currency` abaixo), então os campos brl/eur são
// só rótulo e repetem o valor em dólar de propósito.
const PLANS: Plan[] = [
  {
    id: "starter",
    prices: {
      weekly:  { brl: "$7.99", usd: "$7.99", eur: "$7.99" },
      monthly: { brl: "$29", usd: "$29", eur: "$29" },
      yearly:  { brl: "$290", usd: "$290", eur: "$290" },
    },

  },
];

const CYCLES_FROM_URL: readonly BillingCycle[] = ["weekly", "monthly", "yearly"];

function cycleFromUrl(): BillingCycle | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("cycle");
  return (CYCLES_FROM_URL as readonly string[]).includes(value ?? "") ? (value as BillingCycle) : null;
}

/** Link pessoal da oferta Founding Member (`?offer=FND-XXXXXXXX`). */
function offerFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const value = (new URLSearchParams(window.location.search).get("offer") ?? "").trim().toUpperCase();
  return FOUNDER_CODE_PATTERN.test(value) ? value : null;
}

function formatOfferDate(seconds: number, lang: Language): string {
  return new Date(seconds * 1000).toLocaleDateString(LOCALES[lang], { month: "long", day: "numeric" });
}

export function PricingCards() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const copy = t.pricingChrome;
  const planCopy = t.pricingPlan;
  const weeklyCopy = t.pricingWeekly;
  // O checkout do mensal ja leva o EARLY35; sem esta linha o card dizia so
  // "$29" e o paywall do painel, "$18.85 no 1o mes" (05/10/2026). Some junto
  // com o cupom e nunca aparece no semanal nem no anual (o servidor descarta).
  const foundingOffer = useFoundingOffer();
  const offerPrice = firstMonthPrice(foundingOffer, language);
  // Oferta Founding Member: so existe com um link pessoal valido. Sem codigo, ou
  // com codigo usado ou vencido, a pagina fica exatamente como sempre foi.
  const [offerCode] = useState<string | null>(() => offerFromUrl());
  const founder = useFounderOffer(offerCode);
  const founderActive = Boolean(founder);
  useEffect(() => {
    if (founderActive) track("founder_offer_viewed");
  }, [founderActive]);
  const [loadingPlan, setLoadingPlan] = useState<PlanType | null>(null);
  const [processingUpgrade, setProcessingUpgrade] = useState(false);
  // `?cycle=weekly` (link do e-mail do plano semanal) abre a pagina ja no
  // ciclo pedido e rola ate os cards: sem isso a pessoa caia no mensal e o
  // semanal ficava escondido abaixo da dobra.
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(() => cycleFromUrl() ?? "monthly");
  const cycleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (cycleFromUrl()) cycleRef.current?.scrollIntoView?.({ block: "start" });
  }, []);
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

  // Volta da Stripe sem pagar (`cancel_url`). Fica nos cards, e nao numa
  // pagina, porque eles existem em dois lugares: os Planos do painel (destino
  // do cancel_url desde 05/10/2026) e a /pricing (sessoes abertas antes disso).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") !== "true") return;
    // Sem este evento o funil nao separava "abandonou no checkout" de "nunca chegou".
    track("checkout_canceled", { source: "stripe_cancel_url" });
    // Registro no servidor (log [funnel] + historico do usuario): sem isto,
    // "voltou da Stripe sem pagar" so existia para quem aceitou cookies.
    void getToken().then((token) => (token ? getCheckoutStatus(token, { outcome: "canceled" }) : null));
    toast({ title: copy.canceledTitle, description: copy.canceledDesc });
    const url = new URL(window.location.href);
    url.searchParams.delete("canceled");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    // So na montagem: a volta da Stripe e uma entrada nova na pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      options: { cycle?: BillingCycle; source?: CheckoutSource; resumed?: boolean; offer?: string } = {},
    ) => {
      const offer = options.offer;
      // A oferta fundador e so do mensal.
      const cycle = offer ? "monthly" : options.cycle ?? billingCycle;
      const source = options.source ?? "pricing";
      // INTENÇÃO de compra. `resumed` = voltou do login e seguiu sozinho; nao e
      // um segundo clique, entao nao conta outro upgrade_clicked.
      if (!options.resumed) {
        track('upgrade_clicked', { plan: planType, cycle, source, signedIn: Boolean(isSignedIn), ...(offer ? { offer: true } : {}) });
      }
      if (!isSignedIn) {
        // Login/cadastro devolve para /dashboard/plans?checkout=... e o efeito abaixo
        // retoma a compra. Antes ia para /sign-in sem destino e o Clerk
        // mandava todo mundo para o /dashboard: a intencao morria ali.
        const intent: CheckoutIntent = { plan: planType, cycle, source, ...(offer ? { offer } : {}) };
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
         * porque agora nao ha codigo para pedir.
         *
         * SO no mensal (05/10/2026): o cupom e "35% no primeiro MES". Ate entao
         * o anual tambem ia com ele (US$ 290 virava US$ 188,50). O servidor
         * descarta igual; mandar so aqui evita sessao marcada com cupom. */
        const coupon = cycle === "monthly" && !offer ? "EARLY35" : undefined;
        const { url, sessionId } = await createCheckoutSession(planType, token, cycle, currency, coupon, source, offer);
        // Dispara SO com a URL da Stripe em maos: antes saia antes da chamada a
        // API e contava clique como checkout, inclusive quando a sessao falhava.
        track('checkout_started', {
          plan: planType,
          billingCycle: cycle,
          currency,
          coupon: coupon ?? null,
          ...(offer ? { offer: true } : {}),
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
          window.location.href = "/dashboard/settings";
          return;
        }
        toast({
          title: copy.errorTitle,
          description:
            errorText(t, language, error, copy.checkoutError),
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
    [getToken, isSignedIn, toast, billingCycle, currency, copy, t, language],
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
    void handleUpgrade(intent.plan, { cycle: intent.cycle, source: intent.source, resumed: true, offer: intent.offer });
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
      {founder ? (
        <div className="mb-6">
          <div className="site-price">
            <span className="site-eyebrow">{copy.founderEyebrow}</span>
            <div className="site-price-amt">
              <b>{`$${founder.priceUsd}`}</b>
              <span>{copy.perMonth}</span>
            </div>
            <p className="site-price-sub">{copy.founderSub}</p>
            <ul>
              {copy.founderFeatures.map((feature) => (
                <li key={feature}>
                  <Check />
                  {feature}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => handleUpgrade(PLANS[0].id, { offer: offerCode ?? undefined })}
              disabled={loadingPlan !== null}
              className="site-btn site-btn-primary site-btn-block"
            >
              {loadingPlan === PLANS[0].id ? copy.processing : copy.founderCta}
            </button>
            {founder.seatsLeft !== null ? <p className="site-price-fine">{interpolate(founder.seatsLeft === 1 ? copy.founderSeat : copy.founderSeats, { left: formatNumber(founder.seatsLeft, language) })}</p> : null}
            {founder.expiresAt ? (
              <p className="site-price-fine">{interpolate(copy.founderUntil, { date: formatOfferDate(founder.expiresAt, language) })}</p>
            ) : null}
            <p className="site-price-fine">{copy.founderNote}</p>
          </div>
        </div>
      ) : null}

      <div ref={cycleRef} className="site-cycle" role="group" aria-label={copy.billingCycle}>
        <button
          type="button"
          aria-pressed={billingCycle === "weekly"}
          onClick={() => setBillingCycle("weekly")}
          className={`site-btn site-btn-sm ${billingCycle === "weekly" ? "site-btn-primary" : "site-btn-ghost"}`}
        >
          {copy.weekly}
        </button>
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
        {PLANS.map((plan) => {
          const baseCopy = planCopy;
          const cardCopy = billingCycle === "weekly" ? weeklyCopy : billingCycle === "yearly"
            ? { ...baseCopy, features: baseCopy.features.slice(0, 3) }
            : baseCopy;
          const renewalNote = billingCycle === "yearly" ? copy.yearlyRenewal
            : billingCycle === "monthly" ? copy.monthlyRenewal : weeklyCopy.note;
          const perCycle =
            billingCycle === "weekly" ? copy.perWeek : billingCycle === "monthly" ? copy.perMonth : copy.perYear;
          const price = `$${formatNumber(Number(plan.prices[billingCycle][currency].slice(1)), language, { maximumFractionDigits: 2 })}`;
          // EARLY35 so no mensal (regra 4.0): semanal e anual nunca riscam o preco.
          const monthlyOffer = billingCycle === "monthly" ? offerPrice : null;
          return (
          <div key={plan.id} className="site-price">
            <span className="site-eyebrow">{cardCopy.badge}</span>
            {monthlyOffer ? (
              <>
                <div className="site-price-amt">
                  <s>
                    <span className="sr-only">{t.commercial.offerRegular} </span>
                    {price}
                  </s>
                  <b>{monthlyOffer}</b>
                  <span>{t.commercial.offerFirstMonth}</span>
                </div>
                <p className="site-price-then">{t.commercial.offerThen}</p>
              </>
            ) : (
              <div className="site-price-amt">
                <b>{price}</b>
                <span>{perCycle}</span>
              </div>
            )}
            <p className="site-price-sub">
              {cardCopy.ticks} · {cardCopy.analyses}
            </p>

            <ul>
              {cardCopy.features.map((feature) => (
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
              {loadingPlan === plan.id
                ? copy.processing
                : monthlyOffer
                  ? interpolate(t.commercial.offerCta, { price: monthlyOffer })
                  : `${cardCopy.cta} · ${price}${perCycle}`}
            </button>
            {monthlyOffer && foundingOffer ? (
              <p className="site-price-fine">
                {interpolate(copy.firstMonth, { price: monthlyOffer, code: foundingOffer.code, pct: foundingOffer.percentOff ?? 0 })}
              </p>
            ) : (
              <p className="site-price-fine">{renewalNote}</p>
            )}
          </div>
          );
        })}
      </div>

      <div className="mt-4 text-center">
        <PartnerCode copy={copy} />
      </div>
    </div>
  );
}
