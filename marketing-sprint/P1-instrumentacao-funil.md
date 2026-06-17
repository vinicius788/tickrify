# P1 — Instrumentação do Funil (PostHog + Sentry)

> Objetivo: parar de otimizar no escuro. Ao fim deste sprint você consegue responder, com número, **onde o funil vaza** — especialmente nas duas etapas que importam: **ativação** (signup → 1ª análise) e **grátis → pago**.
>
> Stack confirmada no código: monorepo `apps/frontend` (Vite + React 19 + Clerk + React Router 7 + TanStack Query) e `apps/backend` (NestJS + Prisma). Hoje **não há** nenhum analytics nem Sentry instalado.

---

## 0. Resumo do que fazer (ordem)

1. Instalar e iniciar o **PostHog** no `main.tsx`.
2. Criar um wrapper fino `src/lib/analytics.ts` (uma função `track()` e helpers) — pra você nunca espalhar `posthog.capture` cru pelo código.
3. Plugar **13 eventos** nos pontos que já existem no código (mapa na seção 3).
4. Instalar **Sentry** no `main.tsx` + `ErrorBoundary`.
5. Montar o **funnel** e o **dashboard semanal** no PostHog.
6. Rodar o **checklist de QA** (seção 7) antes de considerar pronto.

Tempo realista solo: meio dia pro PostHog + eventos, ~1h pro Sentry, ~30min pro dashboard.

---

## 1. Instalação

No diretório do frontend:

```bash
cd apps/frontend
npm i posthog-js @sentry/react
```

Variáveis de ambiente — adicione em `.env`, `.env.example` e `.env.production`:

```
VITE_POSTHOG_KEY=phc_xxx           # Project API Key do PostHog
VITE_POSTHOG_HOST=https://us.i.posthog.com   # ou https://eu.i.posthog.com
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
VITE_APP_ENV=production             # pra separar dev/prod nos dois serviços
```

Cria o projeto no PostHog (free tier: 1M eventos/mês — folgado) e no Sentry (free: 5k erros/mês). Pega a Project API Key e o DSN.

---

## 2. Wrapper de analytics — `src/lib/analytics.ts` (criar)

Centraliza tudo. Se um dia trocar de ferramenta, você mexe num arquivo só. Também garante nomes de evento consistentes (um typo em `analsys_completed` quebra o funil silenciosamente).

```ts
import posthog from 'posthog-js';

const KEY = String(import.meta.env.VITE_POSTHOG_KEY || '').trim();
const HOST = String(import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

let ready = false;

export function initAnalytics() {
  if (!KEY || ready) return;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false,        // controlamos manualmente (SPA com React Router)
    capture_pageleave: true,
    autocapture: false,             // só eventos nomeados — evita ruído e estoura menos cota
    persistence: 'localStorage+cookie',
  });
  ready = true;
}

// União fechada de eventos: o TypeScript te impede de inventar nome errado.
export type FunnelEvent =
  | 'landing_view'
  | 'demo_opened'
  | 'signup_started'
  | 'signup_completed'
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  | 'free_limit_reached'
  | 'upgrade_modal_viewed'
  | 'pricing_viewed'
  | 'checkout_started'
  | 'subscription_activated'
  | 'analysis_shared';

export function track(event: FunnelEvent, props?: Record<string, unknown>) {
  if (!ready) return;
  posthog.capture(event, props);
}

// Liga o usuário anônimo ao usuário logado (Clerk). Chamar no signup/login.
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (!ready) return;
  posthog.identify(userId, traits);
}

export function resetAnalytics() {
  if (!ready) return;
  posthog.reset();   // chamar no logout
}

export function trackPageview(path: string) {
  if (!ready) return;
  posthog.capture('$pageview', { $current_url: window.location.origin + path });
}
```

---

## 3. Mapa dos eventos → arquivo exato

Cada linha abaixo aponta pro ponto que **já existe** no código. Nenhum evento exige feature nova.

| Evento | Onde plugar (arquivo) | Gatilho preciso |
|---|---|---|
| `landing_view` | `src/App.tsx` (route `/`) ou no mount de `LandingPage.tsx` | rota `/` renderizou |
| `demo_opened` | `src/components/pages/DashboardPage.tsx` mount **quando `isDemo === true`** | usuário entrou no `/demo` sem login |
| `signup_started` | `src/App.tsx` route `/sign-up` (mount do `<SignUp>`) | abriu tela de cadastro |
| `signup_completed` | `src/main.tsx` ou um listener de `useUser()` — ver §4 | Clerk passou a ter usuário novo → **+ `identify`** |
| `analysis_started` | `DashboardPage.tsx` → `handleStartAnalysis`, logo após validar imagem (antes do `apiClient.createAnalysis`) | submit real (pular se `isDemo`) |
| `analysis_completed` ⭐ | `DashboardPage.tsx` → `handleStartAnalysis`, **só no branch de sucesso**, após `setAnalysisData(analysis)` | resultado renderizado = **ATIVAÇÃO** |
| `analysis_failed` | `DashboardPage.tsx` → bloco `catch` do `handleStartAnalysis` | erro/timeout na análise |
| `free_limit_reached` | `DashboardPage.tsx` → `catch`, nos códigos `SUBSCRIPTION_REQUIRED` / `DEMO_LIMIT_REACHED` / `INSUFFICIENT_TICKS` | bateu limite grátis / ticks |
| `upgrade_modal_viewed` | `DashboardPage.tsx` → todo `setShowUpgradeModal(true)` (há 3 chamadas: catch 402/429, botão sidebar, botão upgrade) | modal de upgrade apareceu |
| `pricing_viewed` | `src/components/pages/PricingPage.tsx` mount | abriu `/pricing` |
| `checkout_started` | `src/components/pricing/PricingCards.tsx` → `handleUpgrade`, antes de `createCheckoutSession` | clicou "Assinar X" → vai pro Stripe |
| `subscription_activated` 💰 | `DashboardPage.tsx` → `useEffect` que lê `success === 'true'` (retorno do Stripe) | assinatura confirmada — **ver §5, validar com webhook** |
| `analysis_shared` | (P2 — share loop) botão Compartilhar | só quando a feature de share existir |

⭐ = métrica de **ativação**.  💰 = métrica de **receita**.

### 3.1 Detalhes que vão te morder se ignorar

**`analysis_started` e `analysis_completed` no arquivo certo.** Em `handleStartAnalysis` o fluxo demo dá `return` cedo (dados falsos). **Não** conte demo como ativação — só dispare `analysis_started`/`analysis_completed` no caminho logado. No demo, se quiser medir, use um evento separado tipo `demo_analysis_simulated`, fora do funil de receita.

**Cuidado com o duplo `incrementAnalysis()`.** Hoje o código chama `incrementAnalysis()` no sucesso **e** de novo no `catch` (pra "devolver" o slot quando falha). Não acople seu `analysis_completed` a essa função — dispare-o **explicitamente após `setAnalysisData(analysis)`** no branch de sucesso, e o `analysis_failed` dentro do `catch`. Assim o número não infla.

**`subscription_activated` pelo `success=true` é "best effort".** O `useEffect` que lê `?success=true` em `/dashboard` só dispara se o usuário voltar pra aba. É bom o suficiente pra começar, mas a **fonte de verdade é o webhook do Stripe no backend** (§5). Marque o evento client-side com `{ source: 'redirect' }` pra depois reconciliar.

### 3.2 Snippets de exemplo

`DashboardPage.tsx` — dentro de `handleStartAnalysis`, no fluxo logado:

```ts
// ...após validar imagem, antes da chamada:
track('analysis_started', { analysisType });          // 'quick' | 'deep'

const response = await apiClient.createAnalysis({ /* ... */ });
incrementAnalysis();
const analysis = await apiClient.waitForAnalysisCompletion(response.id, response);

if (analysis.status === 'failed') {
  throw new Error(analysis.reasoning || 'Falha ao processar análise');
}

setAnalysisData(analysis);
setActiveView('analysis-result');
track('analysis_completed', {                          // ⭐ ATIVAÇÃO
  analysisType,
  symbol: analysis.symbol ?? 'unknown',
  recommendation: analysis.recommendation ?? 'unknown',
});
```

No `catch` do mesmo método:

```ts
} catch (error) {
  track('analysis_failed', {
    code: error instanceof APIError ? (error.code ?? error.status) : 'unknown',
  });
  // ...lógica existente...
  if (apiCode === 'SUBSCRIPTION_REQUIRED' || apiCode === 'DEMO_LIMIT_REACHED') {
    track('free_limit_reached', { reason: apiCode });
    navigate('/pricing');
    return;
  }
  if (apiCode === 'INSUFFICIENT_TICKS') {
    track('free_limit_reached', { reason: 'insufficient_ticks' });
    // ...toast existente...
  }
  // onde houver setShowUpgradeModal(true):
  // track('upgrade_modal_viewed', { trigger: 'quota' });
}
```

`PricingCards.tsx` — dentro de `handleUpgrade`, antes do checkout:

```ts
track('checkout_started', { plan: planType, billingCycle, currency });
const { url } = await createCheckoutSession(planType, token, billingCycle, currency);
window.location.href = url;
```

`DashboardPage.tsx` — no `useEffect` de `success`:

```ts
if (successState === 'true') {
  track('subscription_activated', { source: 'redirect' });   // 💰
  // ...toast + refetch existentes...
}
```

---

## 4. Init + identify (`main.tsx`)

Inicie o analytics **antes** do render e ligue a identidade do Clerk. Um componente pequeno faz o `identify` quando o usuário aparece:

```tsx
// main.tsx — no topo, antes do createRoot:
import { initAnalytics } from './lib/analytics';
initAnalytics();
```

```tsx
// src/components/providers/AnalyticsIdentify.tsx (criar)
import { useEffect } from 'react';
import { useUser } from '@clerk/clerk-react';
import { identifyUser, track } from '@/lib/analytics';

export function AnalyticsIdentify() {
  const { isLoaded, isSignedIn, user } = useUser();
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    identifyUser(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      createdAt: user.createdAt,
    });
    // signup_completed: dispare uma vez por usuário novo.
    // Heurística simples: conta criada há < 60s.
    const ageMs = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() : Infinity;
    if (ageMs < 60_000) track('signup_completed');
  }, [isLoaded, isSignedIn, user]);
  return null;
}
```

Monte `<AnalyticsIdentify />` dentro do `<ClerkProvider>` em `main.tsx` (logo acima de `<App />`). Para `signup_completed` 100% confiável, o ideal é um **webhook `user.created` do Clerk no backend**, mas a heurística acima já serve pro começo.

**Pageviews da SPA:** crie um hook que escuta o `useLocation()` do React Router e chama `trackPageview(pathname)` a cada mudança de rota. Coloque-o dentro do `<Router>` em `App.tsx`. Isso cobre `landing_view`, `pricing_viewed` e demais via URL, sem instrumentar página por página.

---

## 5. Verdade de receita: webhook do Stripe no backend (NestJS)

O `subscription_activated` client-side erra quando o usuário fecha a aba após pagar. A fonte confiável é o backend, que já recebe webhooks do Stripe (existe `create-customer-portal` e `create-checkout-session`).

No handler do evento `checkout.session.completed` / `customer.subscription.created`, dispare server-side com a **mesma `distinct_id`** (o `userId` do Clerk) pra casar com o funil:

```ts
// backend, no PostHog Node SDK (posthog-node)
import { PostHog } from 'posthog-node';
const ph = new PostHog(process.env.POSTHOG_KEY!, { host: process.env.POSTHOG_HOST });

// no webhook, após confirmar pagamento:
ph.capture({
  distinctId: clerkUserId,           // MESMO id usado no identify do frontend
  event: 'subscription_activated',
  properties: { source: 'stripe_webhook', plan, amount, currency },
});
```

Depois, no PostHog, use o evento com `source = stripe_webhook` como a etapa de receita "oficial" do funil e trate o `redirect` como sinal antecipado. Isso fecha o buraco de atribuição.

---

## 6. Sentry (observabilidade) — `main.tsx`

Com tráfego chegando você quer saber do bug antes do usuário reclamar.

```tsx
// main.tsx — após os imports, antes do createRoot:
import * as Sentry from '@sentry/react';

const SENTRY_DSN = String(import.meta.env.VITE_SENTRY_DSN || '').trim();
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.VITE_APP_ENV || 'development',
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: 0.2,            // 20% de performance traces
    replaysOnErrorSampleRate: 1.0,    // grava replay quando dá erro
    replaysSessionSampleRate: 0.0,    // não grava sessão sem erro (economiza cota)
  });
}
```

Envolva o app com o ErrorBoundary do Sentry:

```tsx
createRoot(rootElement).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<div>Algo deu errado. Recarregue a página.</div>}>
      <QueryClientProvider client={queryClient}>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <LanguageProvider>
            <AnalyticsIdentify />
            <App />
          </LanguageProvider>
        </ClerkProvider>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
```

**Source maps:** no build do Vite, suba os source maps pro Sentry (plugin `@sentry/vite-plugin`) pra ver o stacktrace no seu código, não no bundle minificado. Vale a pena — sem isso o erro vem ilegível.

**Backend (opcional agora, recomendado):** `@sentry/node` no NestJS captura as falhas da própria análise/IA, que é onde mais dói. Hoje você está cego depois do deploy nos dois lados.

---

## 7. Dashboard do funil + verificação

### 7.1 Montar o funnel no PostHog

Crie um **Funnel** com os passos, nesta ordem:

```
landing_view → demo_opened → signup_completed → analysis_completed → pricing_viewed → subscription_activated
```

Janela de conversão: 7 dias. Isso te dá a taxa de cada salto. Os dois saltos a vigiar:

- **`signup_completed` → `analysis_completed`** = **ativação**. Baixo aqui = problema de onboarding, não de tráfego.
- **`analysis_completed` → `subscription_activated`** = **grátis → pago**. É aqui que mora o MRR.

### 7.2 Métricas pra olhar toda semana (Insights salvos)

- % ativação (signup → 1ª análise concluída).
- % grátis → pago (ativados que assinam).
- `analysis_failed` / `analysis_started` (taxa de erro — se subir, é bug ou IA, e o Sentry te diz qual).
- `free_limit_reached` → `checkout_started` (quantos que batem no muro de fato consideram pagar).
- Maior queda entre duas etapas vizinhas = **sua próxima tarefa**. Regra: não otimizar nada que não esteja sendo medido.

Salve esses como um **Dashboard "Funil semanal"** e configure um e-mail/Slack semanal do PostHog pra ele cair na sua caixa sem você lembrar.

### 7.3 Checklist de QA (rodar antes de dar como pronto)

Abra o app com o **PostHog em modo debug** (`?__posthog_debug=true` ou o Live Events do PostHog aberto numa aba) e percorra o fluxo:

- [ ] Abrir `/` → cai `landing_view`.
- [ ] Abrir `/demo` deslogado → cai `demo_opened`, **não** cai `analysis_completed` ao "analisar" (é demo).
- [ ] Cadastrar → cai `signup_completed` **uma vez** e o usuário aparece identificado (não anônimo) no PostHog.
- [ ] Fazer 1 análise real → `analysis_started` e depois **um único** `analysis_completed`.
- [ ] Forçar erro (imagem inválida/limite) → `analysis_failed` e/ou `free_limit_reached`, sem `analysis_completed`.
- [ ] Bater o limite grátis → `upgrade_modal_viewed` / `free_limit_reached`.
- [ ] Abrir `/pricing` → `pricing_viewed`; clicar Assinar → `checkout_started`.
- [ ] Concluir um checkout de teste (modo test do Stripe) → `subscription_activated` (redirect) **e** o evento do webhook com `source=stripe_webhook`, ambos com o mesmo usuário.
- [ ] Forçar um erro de JS → aparece no Sentry com stacktrace legível (source maps OK).

Se todos passam, o funil está enxergável. **Só então** faz sentido mexer em P2 (share loop) e P4 (conversão) — agora guiados por número, não achismo.

---

## 8. O que NÃO fazer agora

- Não instrumentar autocapture/heatmap completo — estoura cota e vira ruído. Eventos nomeados bastam.
- Não criar dashboards bonitos antes de validar que os eventos disparam (QA primeiro).
- Não otimizar onboarding/conversão antes de ter ~1–2 semanas de dado no funil. Você precisa ver onde vaza antes de tapar.
