# Tickrify — Documento de Handoff Completo

> **Registro histórico.** Este documento retrata o projeto no momento do handoff e não deve ser usado como runbook atual. Consulte [`../README.md`](../README.md) e [`../DEPLOY.md`](../DEPLOY.md) para arquitetura e publicação verificadas.

> As instrucoes, precos e estados descritos abaixo pertencem ao momento desse
> handoff. Preserve o arquivo como evidencia historica, nao como estado atual.

---

## 1. O que é a Tickrify

Tickrify é uma **plataforma SaaS de análise de trading com IA**. O usuário envia o **print de um gráfico** (qualquer ativo, qualquer timeframe) e a IA lê a imagem e devolve uma **leitura técnica estruturada**: viés, estrutura de mercado (ICT/SMC — BOS/CHoCH, order blocks, liquidez), níveis de operação (entrada, stop, alvos), risco/retorno, confluência, regime, contexto de sessão, plano de saída, cenário alternativo e justificativa.

**Posicionamento (decisão estratégica deste chat):** NÃO é um "oráculo que acerta o trade". É um **copiloto de decisão e disciplina** — "lê o gráfico, calcula o risco e estrutura a decisão; a última palavra é do trader". Isso reduz churn/chargeback/risco regulatório e é honesto sobre o que IA + análise técnica conseguem entregar.

**Mercado-alvo:** traders de varejo (forex, cripto, índices, ações BR, commodities), com ambição global. Forte no Brasil, interface já internacionalizada em 6 idiomas.

**Modelo de negócio:** assinatura com sistema de "Ticks" (créditos mensais).
- Análise **rápida** = 1 tick (gpt-4o-mini). Análise **deep** = 3 ticks (gpt-4o).
- Planos: **Starter** R$57/mês (45 ticks), **Pro** R$147/mês (150 ticks), **Elite** R$297/mês (400 ticks).
- **3 análises grátis** (demo) para conta nova; na 4ª, redireciona para a página de planos.

---

## 2. Arquitetura técnica

**Monorepo** (`apps/backend` + `apps/frontend`).

- **Backend:** NestJS + Prisma + PostgreSQL (Supabase, schema `tickrify`) + Redis/BullMQ (fila). Auth via **Clerk**. Pagamentos via **Stripe**. IA via **OpenAI** (gpt-4o / gpt-4o-mini, visão, saída em JSON estrito).
- **Frontend:** React + Vite + TypeScript + Tailwind. i18n próprio (6 idiomas).
- **Deploy:**
  - **Render** roda o backend. O serviço web `tickrify` usa o `Dockerfile` da raiz e executa a **API e o worker embutido no mesmo contêiner** por `infra/docker-entrypoint.sh`. Não há serviço worker separado. Redis = `tickrify-redis`.
  - **Vercel** roda o frontend (autodeploy do `main`, rápido).
  - **Git:** o dono dá `git push origin main`; o ambiente de dev do agente NÃO consegue commitar/buildar (validar só com `npx tsc --noEmit`).
- **Idioma:** auto-detecta `navigator.language` (fallback PT), com seletor manual no dashboard e na landing.

**Caminho de uma análise:** frontend `createAnalysis` → `POST /api/ai/analyze` → enfileira job → **worker** processa via `AIAdapter.analyzeImage` → polling do frontend até concluir. Existe também um caminho síncrono (`processSynchronously`) de fallback. **Worker e síncrono compartilham `analyzeImage`, mas o worker tem `getPrompt` DUPLICADO — manter paridade!**

**Arquivos-chave do backend:**
- `src/modules/ai/ai.adapter.ts` — chamada à OpenAI, schema JSON estrito, pós-processamento determinístico, enriquecimento de dados reais.
- `src/modules/ai/ai.service.ts` — orquestração, fila, ticks, demo, outcomes/win-rate, endpoint `/usage`.
- `src/modules/prompt/prompt-builder.service.ts` — monta o prompt; bloco de enriquecimento do deep.
- `src/common/prompts/trading-system-prompt.ts` — prompt principal (ICT/SMC). **É o "segredo" — só no backend, nunca vai pro frontend.**
- `src/modules/market/market.service.ts` — dados ao vivo (funding/OI/long-short/fear&greed).
- `worker/ai.worker.ts` — implementação duplicada do processamento (mapper + getPrompt próprios).
- `src/common/utils/analysis-normalizer.ts` — helpers determinísticos (R/R, correção de preço, regime, etc.).

---

## 3. Tudo que foi implementado neste chat

### 3.1 Qualidade da análise (núcleo do produto)
- R/R **determinístico** por alvo (não confia no texto da IA).
- Coerência **confiança × força de tendência** (cap de confiança).
- Detecção de **regime de mercado** (tendência/range/volátil).
- **Probabilidades por alvo** (TP1/TP2/Stop).
- **Saída escalonada** estruturada + break-even.
- **Calculadora de position sizing**.
- Correção de **ordem de grandeza de preço** (BTC lido 10x menor, etc.).

### 3.2 Dados ao vivo + performance
- Módulo `market` busca **funding, open interest, long/short, fear&greed** (OKX/Binance/alternative.me).
- Painel "Contexto ao vivo" no frontend.
- **Tracking de resultado (win-rate)**: marcar TP/SL/aberto, painel de performance, calibração ("histórico de acerto"). Colunas adicionadas via `ADD COLUMN IF NOT EXISTS` no `onModuleInit` (sem migração que possa falhar — lição de um outage anterior).

### 3.3 Correções de produção
- **Timeout da IA 30s → 55s** (gpt-4o com visão estourava 30s; análises caíam). Env `AI_ANALYZE_TIMEOUT_MS`.
- **Contador "3 grátis" corrigido** (estava sempre 0/3; passou a contar as linhas Analysis demo não-falhas).
- **Multi-timeframe ocultado** no grátis/demo (recurso de assinante).
- **Botões da landing** corrigidos (eram `SignInButton` que no-opavam pra logado; agora SignUp/Signed + navegação).
- **Paywall** validado: 3 grátis → 4ª vai pra `/pricing` (atômico, à prova de corrida).

### 3.4 Segurança
- **Guard anti-extração de prompt** (caminho normal + stream): se a IA tentar ecoar o system prompt, o texto é trocado por aviso neutro.
- Orientação: **privar o repo** + **2FA** em GitHub/Render/OpenAI/Stripe/Clerk. (O prompt já é backend-only; nunca vai pro navegador.)

### 3.5 Internacionalização (i18n) — 6 idiomas (PT/EN/ES/FR/DE/JA)
- **Dashboard inteiro**: Nova Análise, Resultado, Meus Trades, Carregamento, Watchlist, contador, modal de ticks.
- **Landing inteira**: header (+ seletor de idioma adicionado), hero, preview, features, como funciona, CTA, métricas, ticker, análises recentes, planos, FAQ, rodapé.
- **Exceção proposital:** Termos de Serviço e Política de Privacidade ficaram em PT (texto jurídico — recomendado tradução profissional).

### 3.6 Reposicionamento de copy
- Hero/badge/tagline mudados de "diz exatamente onde entrar" (oráculo) → **"copiloto de trading… a última palavra é sua"**, nos 6 idiomas. Título "Pare de operar no escuro" mantido.

### 3.7 Evolução da análise "v8" (leitura mais completa + dados reais)
- **Leitura em camadas no DEEP** (só deep): Leitura → Volatilidade → Cenários (alta/baixa/invalidação) → Multi-timeframe → **Fase de Wyckoff** → **Volume/Área de valor**, com regras anti-alucinação ("se não vê volume, diga 'não visível', não invente").
- **HTF em `detail: 'high'`** — antes os gráficos secundários iam em `low` e a IA mal lia; agora o top-down multi-timeframe é real.
- **Dados reais de mercado injetados no prompt** (a IA "por dentro dos números"), **ligado por padrão** (a env `ENABLE_MARKET_ENRICHMENT=false` é um kill-switch):
  - Cripto: funding/OI/long-short/fear&greed (sem chave).
  - Forex/Ouro: **dólar** (proxy EUR/USD via Frankfurter/ECB, sem chave) + **juros 10 anos** (FRED, precisa de chave grátis).
  - Índices: **VIX** (FRED).
  - Fluxo "2 passadas": uma chamada barata (gpt-4o-mini) lê o símbolo do print → backend busca o dado real → injeta. Tudo best-effort com timeout; se falhar, a análise segue normal.
- **Botão "Análise profunda (deep)"** na tela de Nova Análise (passa `analysisType: 'deep'`).
- **Fix do worker**: o `getPrompt` duplicado do worker não aplicava o bloco do deep — corrigido (era por isso que a leitura em camadas não aparecia, já que toda análise passa pelo worker).

---

## 4. Estado atual / a confirmar (no momento do handoff)

- **Última coisa em teste:** o fix do worker (deep enrichment). Precisa confirmar em produção: ao rodar uma análise **deep**, devem cair **3 ticks** e o Resumo Executivo deve vir **em camadas** + citar dólar/Treasury/VIX como "dado real".
  - **Teste decisivo:** se cair só 1 tick, o `analysisType: 'deep'` não está chegando ao backend (investigar deploy do frontend/cache). Se cair 3 mas não vier em camadas, é o Render ainda publicando.
- **Chave FRED:** o dono estava configurando `FRED_API_KEY` no Render (serviço `tickrify`). Sem ela, cripto + dólar funcionam; juros e VIX não aparecem.

---

## 5. O que falta implementar / pendências

- **Confirmar o deep ponta a ponta** em produção (ver seção 4).
- **Probabilidades às vezes vêm 0%/0%/0%** em algumas análises — revisar para um padrão melhor (default sensato quando o modelo não preenche).
- **COT (Commitment of Traders)** para forex/ouro — deferido (mapear ativo→contrato CFTC é trabalhoso/frágil; dado semanal). Fonte: `publicreporting.cftc.gov` (Socrata, grátis).
- **Ações individuais** (PETR4, AAPL…) no enriquecimento de dados reais — ainda não cobertas.
- **Campos estruturados com UI própria** para os novos blocos (Wyckoff, volatilidade, cenários, VIX). Hoje a leitura rica entra no campo "Resumo Executivo" (renderizado com quebras de linha). Transformar em blocos visuais é polimento (sem banco, risco baixo) — recomendado fazer **depois** de ver o output real do deep, pra a UI casar com o que o modelo produz.
- **Placar público de performance** (transparência do win-rate) — combinado adiar; é a maior alavanca de credibilidade (ver seção 7). Base já existe no backend (outcomes/calibração).
- **Tradução profissional** dos Termos e Política de Privacidade.

---

## 6. Melhorias que o fundador ainda quer (visão)

- Deixar a leitura do gráfico **completíssima e baseada em dados reais**, de modo que o valor **independa do trade dar certo** ("o usuário sente que a IA leu o gráfico direitinho mesmo se o mercado reverter"). — Em andamento (seção 3.7).
- Saber **quantos gráficos são analisados por dia** (para marketing). Já é possível via SQL no Supabase, na tabela `tickrify."Analysis"` (filtrar `status='completed'`, `isDemo=false` = assinantes). Não precisa de código novo.
- Acompanhar os **custos da OpenAI** (painel platform.openai.com → Usage; ativar limites/alertas). Estimativa: rápida ≈ US$0,004; deep ≈ US$0,06 por análise.
- Objetivo declarado: **tornar a Tickrify uma startup global multimilionária.**
- Possível experimento futuro: testar o **modelo da Claude (API Anthropic)** como provedor alternativo de visão/raciocínio, via A/B com o win-rate como juiz (o `ai.adapter` já isola o provedor).

---

## 7. Análise estratégica honesta (leitura de negócio)

- **O maior gargalo NÃO é tecnologia — é prova/credibilidade.** A categoria "IA que diz onde operar" é saturada de golpe. O cético (trader sério) desconfia; o iniciante culpa a plataforma quando perde. **Retenção** baseada em confiança é o jogo.
- **Posicionar como copiloto/processo, não oráculo/resultado** (já iniciado) — protege contra churn, chargeback e risco regulatório (Stripe derruba contas de "trading signals"; cada país regula "recomendação de investimento" diferente).
- **Fosso (moat)** não é o prompt (clonável). É o **conjunto**: camada determinística + dados reais + histórico de win-rate (calibração) + marca/distribuição + iteração contínua.
- **Maior alavanca recomendada:** um **placar de performance público e auditável** (mostrar win-rate real, inclusive medíocre). Numa categoria cheia de mentira, transparência radical é diferenciação.
- **Falta um canal de aquisição repetível** — definir e testar.

---

## 8. Restrições e lições para quem continuar (IMPORTANTE)

1. **Nunca quebrar produção.** App no ar com usuários. Mudanças **aditivas**, atrás de **flag/kill-switch**, com **degradação graciosa** (se algo falhar, a análise segue como antes).
2. **Não alterar o model do Prisma para colunas "live".** Usar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` no `onModuleInit` (uma migração que não roda no Render já causou outage — P2022).
3. **Worker e adapter têm lógica duplicada** (`worker/ai.worker.ts` tem `getPrompt` e mapper próprios). Toda mudança no prompt/mapeamento precisa ser refletida nos DOIS.
4. **Schema JSON estrito da OpenAI:** toda propriedade em `properties` precisa estar em `required` (campos novos devem ser nullable + listados em required).
5. **Validar com `npx tsc --noEmit`** (frontend e backend) antes de cada push. O dono é quem dá `git push`.
6. **i18n:** `Translations = typeof pt`. Adicionar chave em `pt.ts` exige adicionar nos 6 locais (pt/en/es/fr/de/ja). Usar chaves escalares (evitar arrays com tamanhos divergentes).
7. **Custo/latência:** a leitura rica e os dados reais rodam **só no deep** (controle de custo). Deep ganha ~3-5s pela leitura do símbolo + busca de dados.
8. **O prompt é segredo de backend** — nunca expor no frontend; manter o guard anti-extração.

---

## 9. Contas, serviços e variáveis de ambiente

- **Render** (backend `tickrify` + `tickrify-redis`): `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, Clerk, Stripe, Redis, `RUN_EMBEDDED_WORKER` (default true), `ENABLE_MARKET_ENRICHMENT` (default ligado; `=false` desliga), `FRED_API_KEY` (opcional, destrava juros/VIX), `AI_ANALYZE_TIMEOUT_MS` (opcional).
- **Vercel** (frontend): `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_URL`.
- **Supabase:** Postgres, schema `tickrify`.
- **Clerk:** auth. **Stripe:** pagamentos/planos. **OpenAI:** IA. **FRED (St. Louis Fed):** dados macro grátis (chave em fredaccount.stlouisfed.org).
- Repo: github.com/vinicius788/tickrify (privar + 2FA recomendado).

---

## 10. Próximos passos imediatos sugeridos

1. **Confirmar o deep em produção** (3 ticks + leitura em camadas + dados reais). Resolver o que faltar.
2. **Corrigir as probabilidades 0%** quando o modelo não preenche.
3. **Campos estruturados + UI** para os blocos do deep (depois de validar o output).
4. **Placar público de performance** (transparência do win-rate) — alavanca de credibilidade.
5. Definir **canal de aquisição** e medir.
6. Configurar **limites/alertas de custo** na OpenAI; privar repo + 2FA.

---

*Documento gerado ao fim de uma sessão longa de desenvolvimento. O fundador (Vinicius) é hands-on, prioriza estabilidade ("não posso bugar e perder tudo agora") e quer evolução contínua para os usuários atuais, não só para o futuro. Trate-o como parceiro: seja honesto e direto (ele pediu "na cara crua, sem mimimi"), valide tudo, e nunca arrisque o que já está funcionando.*
