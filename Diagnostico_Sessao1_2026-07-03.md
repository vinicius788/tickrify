# Tickrify — Diagnóstico Sessão 1 (03/07/2026)

Tudo abaixo foi verificado nesta sessão (teste real no site + código + pesquisa web). O que não pôde ser verificado está marcado como BLOQUEADO.

---

## P0 — O PRODUTO ESTÁ FORA DO AR (verificado 2×)

Rodei uma análise real no tickrify.com com a conta Elite (393 ticks disponíveis). Resultado, nas duas tentativas:

> **Analysis error — "Limite de análises atingido. Tente novamente mais tarde."**

Causa raiz (encontrada no código): o erro é o código `openai_billing` — a **conta OpenAI está sem crédito / com problema de billing** (`apps/backend/src/modules/ai/ai.adapter.ts:179`). Ou seja: **toda análise, de todo usuário, falha em produção**. É isso que explica "as pessoas logam e não usam as análises grátis" — elas provavelmente tentam, veem erro e vão embora.

Agravantes verificados:
1. **Cada falha consome 1 tick mesmo assim** (fui de 393 → 391 em 2 falhas). Não existe lógica de refund em `ai.service.ts`.
2. **A mensagem de erro está em português** num produto 100% em inglês.
3. O botão "Try again" descarta o gráfico enviado e volta pra tela vazia.

**Ação imediata (só você pode fazer):** entrar em platform.openai.com → Billing → adicionar crédito / corrigir cartão. ~5 minutos. Nada mais nesta lista importa antes disso.

**Fixes de código que posso fazer agora:** refund de tick quando a análise falha; mensagens de erro em inglês; "Try again" reaproveitar o upload.

---

## P1 — Preço em R$ para o mundo inteiro (hipótese do briefing confirmada)

- A seção de planos da landing tem preços **hardcoded em BRL**: R$ 57 / R$ 147 / R$ 297 (`PricingSection.tsx`). Trader americano vendo Reels → clica → vê "R$". Mata a confiança na hora.
- `detectCurrency()` só devolve USD para locale exatamente `en-US`. `en-GB`, `en-AU`, `en-CA`, `en` → **EUR**. Reino Unido/Canadá/Austrália (seus alvos de paid boost) veem euro.
- `BuyTicksModal.tsx` (compra avulsa de ticks): preços hardcoded "R$19,90 / R$49,90 / R$129,90".
- Os price IDs multi-moeda já existem no Stripe (BRL/USD/EUR, mensal/anual) — o problema é só a camada de exibição/detecção.

**Fix proposto:** site em inglês → default **USD** (BRL apenas quando idioma = PT); landing e modal usando o mesmo mecanismo de moeda. Posso implementar hoje.

- **BLOQUEADO:** moeda default da conta Stripe — dashboard.stripe.com sem sessão logada no Chrome. Preciso que você logue (não posso digitar credenciais).

## P1b — Português vazando no site em inglês (verificado na navegação)

- Ticker da landing e do dashboard: "AO VIVO", "COMPRA", "VENDA", "AGUARDAR".
- Tickers brasileiros no strip da landing: **PETR4, WINFUT** — sinaliza "produto BR" pro gringo.
- "Supported markets: Forex, Crypto, **BR stocks**, Indices".
- Mock do dashboard na landing: "COMPRA 80%", "Confluência 4/8".
- Erros do backend em PT (item P0).

## P2 — Fricções de UX encontradas na auditoria

1. Card Elite com preço truncado: renderiza "R$ 29..." (overflow). Badge "MOST POPULAR" cortado atrás do card.
2. Animações fade-on-scroll deixam seções invisíveis por 2–4s (na minha navegação, a seção de planos ficou 100% preta até rolar de novo). Em conexões/CPUs medianas isso é conteúdo que o usuário nunca vê.
3. Dashboard mostrou estado de plano inconsistente (sidebar "Vinicius FREE" + card "PLAN ELITE" na mesma tela; contador "0/3 analyses" para conta Elite) — sugere bug na detecção de plano no frontend.
4. Sem gráfico de exemplo na tela de upload ("try a sample chart") — quem não tem print na mão não experimenta.
5. Upload em si é bom: drag/paste/formatos claros, preview rápido, copy clara.

---

## Mercado (pesquisa web, jul/2026)

**A categoria existe e está lotada de players pequenos.** Concorrentes diretos do fluxo "print → entry/stop/targets":
- **SnapPChart** — líder em SEO da categoria; nota A+–F + entry/stop/2 targets por upload.
- **ChartSnipe** (~$20–25/mês) — forte em forex, currency strength index.
- **ChartViews.ai** — posicionamento quase idêntico ao Tickrify: "entry, stop, targets, R:R and confidence score in under 30 seconds".
- **Natum, ChartPT, ChartAnalyzerAI, ChartAnalyst.ai** — cauda longa.
- Players grandes no espaço adjacente: TrendSpider ($59–99/mês), TradingView **AI Chart Copilot beta grátis** (risco de comoditização), Trade Ideas.

**Como eles crescem:** SEO agressivo — SnapPChart e ChartSnipe publicam "best AI chart analysis tools" rankeando a si mesmos. A categoria está sendo construída por content/SEO, não por paid.

**Implicações:**
1. Demanda existe → não é preciso criar categoria, é preciso vencer distribuição. Reels já valida isso (52k views/30d).
2. Diferenciação fraca em features → posicionamento "second opinion that confirms or kills your read" + SMC/ICT (Order Blocks, BOS, CHoCH, FVG) é o ângulo certo; nenhum concorrente é dono do nicho SMC.
3. TradingView grátis no meio do caminho → velocidade importa; o free tier de 3 análises precisa FUNCIONAR (ver P0).

Fontes: wallstreetzen.com/blog/ai-stock-analysis · snappchart.app · chartsnipe.com · chartviews.ai · trendspider.com · lunefi.com/blog/top-ai-tradingview-indicators-2026

---

## BLOQUEADO — dados que preciso de você para acessar

Stripe, PostHog e Instagram Insights estão deslogados no Chrome. Não posso digitar credenciais (restrição de segurança). Quando você logar nos três e me avisar, eu puxo: MRR e assinantes reais, funil por etapa e por UTM, geografia do público do IG e cliques na bio por vídeo.

---

## Ordem de ataque proposta

1. **Você, agora:** crédito na OpenAI → testar 1 análise → produto volta a existir.
2. **Eu, em seguida (código):** refund de tick em falha + erros em inglês + USD default + limpar PT/BR do site EN + fix do overflow do card Elite.
3. **Você:** logar Stripe/PostHog/Instagram no Chrome → eu puxo os números reais.
4. Só depois: DMs para leads quentes, seeding, paid boost, Product Hunt (escalar tráfego para um produto quebrado desperdiça os leads).
