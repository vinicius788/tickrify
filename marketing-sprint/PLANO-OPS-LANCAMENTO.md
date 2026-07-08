# Tickrify — Blueprint de Ops: Distribuição & Conversão

> Documento de referência pro chat de Ops. Produto **já no ar**. Objetivo desta fase: **transformar tráfego em assinantes pagos**, sem construir features novas de análise.

---

## 0. Contexto e premissas

- **Estágio:** produto live, completo (auth, Stripe, ticks, demo, 6 idiomas, análise profunda). Não é MVP — o produto não é o gargalo.
- **Métrica norte (North Star):** **assinantes pagos ativos / MRR.**
- **Canais:** vídeo-first — Instagram, TikTok, YouTube (orgânico).
- **Orçamento:** free tier em tudo.
- **Operação:** solo. Regra de ouro: **toda hora gasta em produto é hora não gasta em distribuição.** Só mexer no produto no que mover conversão.

### O "aha moment" do Tickrify
> Usuário joga um print de gráfico e recebe, em segundos, um sinal concreto com níveis (entrada, stop, alvos), confiança e justificativa.

Tudo nesta fase gira em torno de **levar o usuário até esse momento o mais rápido possível** e **mostrar o valor que está trancado** atrás do plano pago.

---

## 1. O funil do Tickrify

| Etapa | Evento-chave | O que medir |
|---|---|---|
| Alcance | visita na landing | visitantes únicos |
| Interesse | abriu o demo | % landing → demo |
| Cadastro | signup completo (Clerk) | % demo → signup |
| **Ativação** | **1ª análise real concluída** | **% signup → ativado** |
| Intenção | bateu limite grátis / viu modal de upgrade / viu pricing | % ativado → pricing |
| **Receita** | **assinatura ativada (Stripe)** | **% pricing → pago** |
| Loop | análise compartilhada | nº de shares / visitas vindas de share |

**Diagnóstico antes de remédio:** você não sabe hoje onde o funil vaza. A primeira prioridade não é feature nenhuma — é **enxergar o funil**.

---

## 2. Prioridade 1 — Instrumentação (enxergar o funil)

Sem isso você distribui no escuro e otimiza por achismo.

**Ferramenta:** PostHog (free tier — 1M eventos/mês, mais que suficiente).

### Eventos mínimos a instrumentar (frontend)
```
landing_view
demo_opened
signup_started
signup_completed          // identify(user) no Clerk
analysis_started          // submit do upload
analysis_completed        // resultado renderizado  → ATIVAÇÃO
analysis_failed
free_limit_reached        // bateu as 3 grátis
upgrade_modal_viewed
pricing_viewed
checkout_started          // clicou assinar → Stripe
subscription_activated    // RECEITA (idealmente confirmado por webhook do Stripe)
analysis_shared           // loop de crescimento (P2)
```

### O que olhar toda semana
- **Ativação:** % dos signups que concluem ≥1 análise. Se for baixo, o problema é onboarding, não tráfego.
- **Grátis → pago:** % dos ativados que assinam. É aqui que mora seu MRR.
- **Onde cai mais gente** entre duas etapas seguidas = sua próxima tarefa.

> Regra: não otimizar nada que não esteja sendo medido.

---

## 3. Prioridade 2 — Loop de compartilhamento (distribuição + produto no mesmo tiro)

A única "feature" que vale construir agora, porque **cada análise vira anúncio**.

**Spec:**
- Botão **"Compartilhar"** no resultado da análise.
- Gera uma **página pública read-only** (sem login) com: símbolo, sinal, níveis, confiança, e marca Tickrify.
- **OG image + meta tags** pra preview bonito no Instagram/WhatsApp/X/TikTok.
- CTA fixo: **"Analise o seu gráfico grátis →"** apontando pro demo.
- Rota pública nova (ex.: `/a/:id` ou `/s/:token`), sem dados sensíveis do usuário.

**Por que é a maior alavanca:** une conteúdo, prova social e aquisição. Você compartilha, os usuários compartilham, e todo link puxa pro topo do funil sem custo.

---

## 4. Prioridade 3 — Alavancas de conversão grátis → pago (dentro do produto)

Ajustes pequenos, alto impacto no MRR. Validar cada um com o PostHog.

1. **Mostrar o valor trancado.** Pra usuário grátis, exibir a seção de análise profunda / multi-timeframe **borrada com cadeado** ("Desbloqueie a leitura profunda"), em vez de simplesmente esconder. Desejo > ausência.
2. **Timing do upgrade.** Oferecer upgrade **no pico de valor** — logo depois de uma análise boa e no momento exato em que bate o limite (não antes).
3. **Clareza dos "ticks".** Garantir que o usuário entende o que é um tick e quanto cada plano dá. Conceito de moeda interna confunde e mata conversão se não estiver óbvio no pricing e no modal.
4. **Atrito mínimo no topo.** Manter o demo acessível sem cadastro (já existe) — deixa a pessoa sentir o aha antes de pedir qualquer coisa.
5. **CTA único e claro** em cada tela morta (limite atingido, erro, fim de análise): sempre apontar pro próximo passo de conversão.

---

## 5. Prioridade 4 — Motor de conteúdo (IG / TikTok / YouTube)

O produto **é** o conteúdo. Você não precisa inventar — você grava a tela.

### Formatos que funcionam pra um produto de "IA + gráfico"
- **"Joguei esse gráfico na IA e olha o que ela falou"** — screen recording do upload → resultado. É o demo virando vídeo.
- **Série de accountability (a mais forte):** posta a análise hoje → dias depois volta mostrando se bateu TP ou stop. **Você já tem isso pronto** no "Meus Trades" (verdict tracking / win-rate). Transparência = confiança = conversão.
- **IA vs. trader humano** — comparação, formato de "duelo".
- **Educacional usando a ferramenta** — "o que é um order block" mostrando a tela explicando.

### Cadência realista pra solo
- 1 short/dia OU 4–5/semana, **repurposado** nos 3 canais (Reels + TikTok + YT Shorts saem do mesmo vídeo).
- 1 vídeo longo no YouTube/semana (puxa SEO e autoridade).
- **Bio → demo** (não pro signup direto). Atrito baixo primeiro.

### Princípio
Não venda "robô que ganha dinheiro". Posicione como **"copiloto de análise"**. Tom de guarantia de lucro queima alcance, queima confiança e dá problema com as plataformas de anúncio.

---

## 6. Prioridade 5 — Captura de e-mail e ciclo de vida

**Ferramenta:** Brevo (300 e-mails/dia free) ou Resend (3k/mês free). O e-mail você já tem via Clerk.

**Sequências mínimas:**
- **Boas-vindas** (logo após signup): como tirar a melhor análise (deixe o símbolo visível, use timeframe certo).
- **Win-back de limite** (disparo em `free_limit_reached`): "Você usou suas 3 análises grátis — desbloqueie a leitura profunda".
- **Reativação** (inativo X dias): traz de volta com uma análise de exemplo / novidade.

---

## 7. Prioridade 6 — Observabilidade

**Ferramenta:** Sentry (free — 5k erros/mês). Adicionar no frontend (e idealmente no backend).

Com tráfego chegando, você quer saber dos bugs **antes** do usuário reclamar. Hoje você está cego depois do deploy.

---

## 8. Risco / Compliance (produto financeiro)

Não é burocracia — é proteção e pré-requisito pra anunciar em plataformas.

- Disclaimer **"não é recomendação de investimento"** visível no onboarding, no resultado e no pricing. (Você já trata bem isso no resultado — só garantir que está em todos os pontos.)
- **Nunca prometer retorno / lucro garantido** em nenhum criativo, post ou copy.
- Gerenciar expectativa: a IA dá uma **hipótese de leitura**, não certeza.

---

## 9. Ordem de ataque sugerida

| Sprint | Foco | Entregável |
|---|---|---|
| 1 | **Enxergar** | PostHog + Sentry instalados, eventos do funil disparando, dashboard do funil montado |
| 1–2 | **Loop** | Feature de compartilhamento (página pública + OG image + CTA) no ar |
| 2 | **Converter** | Valor trancado visível, timing do upgrade, clareza dos ticks |
| 2–3 | **Distribuir** | Motor de conteúdo rodando (série de accountability) + captura de e-mail + boas-vindas/win-back |
| Contínuo | **Iterar** | Revisão semanal dos números → dobrar no que converte, cortar o resto |

---

## 10. Resumo em uma frase

> O produto está pronto. Pare de construir análise, **instrumente o funil, transforme cada análise em distribuição (share loop), torne o valor pago visível, e alimente IG/TikTok/YouTube com a própria tela do produto** — guiado pelos números, não por achismo.
