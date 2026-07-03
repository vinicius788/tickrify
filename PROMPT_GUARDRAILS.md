# Manual do Prompt da IA (Tickrify) — o que pode e o que NÃO pode mexer

> Este arquivo é o "manual de regras" para editar o prompt da análise de IA.
> Leia antes de mexer. Vale para qualquer pessoa **e para qualquer chat de IA** —
> um chat novo não conhece o histórico, então as regras vivem aqui, não na memória de um chat.

---

## 1. Onde o prompt vive e como chega na IA

- **Arquivo do prompt (fonte da verdade no código):**
  `apps/backend/src/common/prompts/trading-system-prompt.ts`
  → a constante `TRADING_SYSTEM_PROMPT` (versão atual: **v7.1**).

- **Como chega na IA (importante):** o motor NÃO envia o arquivo direto. Ele envia
  o prompt **ativo na tabela `PromptConfig` do banco**. O arquivo de código só é
  usado como fallback quando não há config ativa.
  - Caminho síncrono: `PromptBuilderService` (`apps/backend/src/modules/prompt/prompt-builder.service.ts`)
  - Caminho do worker: função `getPrompt` em `apps/backend/worker/ai.worker.ts`

- **Sincronização automática (já configurada):** `PromptSyncService`
  (`apps/backend/src/modules/prompt/prompt-sync.service.ts`) roda no boot do
  backend e grava o prompt do código no banco **se estiver diferente**. Ou seja:

  > **Fluxo de edição:** edita o prompt no código → `git push` → Render reinicia →
  > auto-sync coloca no ar. **Não precisa rodar comando de banco na mão.**

  - Kill-switch: `PROMPT_AUTO_SYNC=false` desliga o auto-sync.
  - É idempotente: se o prompt do código == ativo no banco, não faz nada.

---

## 2. ✅ O que é SEGURO editar no prompt

- Texto explicativo, instruções, exemplos e regras de leitura (ICT/SMC, liquidez,
  Wyckoff, Elliott, sessões, etc.).
- Faixas de preço por ativo, distâncias de SL/TP, descrições de padrões.
- Ordem e clareza das etapas (STEP -1 … STEP 6), desde que os contratos da
  seção 3 sejam preservados.
- Tom, idioma das instruções, e o conteúdo dos campos de texto.

Depois de editar: `git push` e pronto (o auto-sync cuida do resto).

---

## 3. 🚫 O que NÃO pode mudar (quebra o sistema)

Estes itens são **contrato** com o código determinístico que roda DEPOIS da IA.
Mexer aqui quebra silenciosamente (campo vazio, sinal errado, painel zerado).

### 3.1. O checklist de 7 itens
- Tem que continuar sendo **7 itens**. `factorsPresent` é de **0 a 7** e
  `confluenceScore = (factorsPresent / 7) * 100`.
- O código depende disso em `capConfidenceByConfluence` e `reconcileConfluence`
  (`apps/backend/src/common/utils/analysis-normalizer.ts`).
- ⚠️ NÃO adicione um 8º item ao checklist. Filtros novos (ex.: liquidez) entram
  como **modificadores**, não como item do placar.
- O `reconcileConfluence` procura o padrão de texto `X/7` no `structureValidation`
  — mantenha esse formato (ex.: "→ 6/7 → sinal").

### 3.2. Os nomes dos campos do JSON de saída
- A interface lê `fullResponse.analysis.<campo>`. Renomear/remover campos faz o
  painel parar de mostrar aquilo (entrada, stop, TPs, confluência, estrutura…).
- Campos críticos: `recommendation`, `confidence`, `analysis.{symbol, timeframe,
  currentPrice, entry, stopLoss, takeProfit1, takeProfit2, riskRewardRatio,
  confluenceScore, factorsPresent, structureValidation, entryType, entryCondition,
  invalidationLevel, trendStrength, marketRegime, multiTimeframeAlignment,
  marketStructure.bias, technicalAnalysis, executiveSummary, reasoning}`.

### 3.3. Os valores de enum (sempre em INGLÊS)
- `recommendation`: `BUY` | `SELL` | `HOLD`
- `bias`: `bullish` | `bearish` | `neutral`
- `entryType`: `market` | `limit` | `stop`
- `trendStrength`: `strong` | `moderate` | `weak`
- `marketRegime`: `trending` | `ranging` | `volatile`
- O texto das análises vai no idioma do usuário, mas **esses enums ficam em inglês**
  (o código normaliza por eles).

### 3.4. O marcador de contexto
- `{{USER_CONTEXT}}` precisa continuar no prompt — o código substitui ele pelo
  idioma/contexto do usuário. Se sumir, o contexto não é injetado.

### 3.5. Os rótulos da análise DEEP
- No `executiveSummary` da análise deep, os rótulos são fixos e em inglês, nesta
  ordem: `READING:` `VOLATILITY:` `SCENARIOS:` `MULTI-TIMEFRAME:` `MARKET PHASE:`
  `VOLUME:` `REVERSAL RISK:`. A interface os traduz. NÃO traduza nem renomeie.

---

## 4. O que NÃO está no prompt (é código — peça pra mexer separado)

Estas regras são determinísticas e vivem fora do prompt
(`apps/backend/src/common/utils/signal-decision.ts` + `analysis-normalizer.ts`).
Se o comportamento que você quer mudar é um destes, **não adianta editar o prompt**:

- **Guard de R/R:** sinal vira `WAIT` se o melhor R/R (TP1 ou TP2) < **1.2**.
  Kill-switch `ENABLE_RR_GUARD=false`.
- **Caps de confiança:** tendência fraca→máx 60, moderada→máx 74; confluência
  ≤3→máx 50, 4–5→máx 74. Só reduzem, nunca aumentam.
- **News guard:** evento de alto impacto a ≤45min (ou saído há ≤15min) → `WAIT`,
  confiança ≤45. Kill-switch `ENABLE_NEWS_GUARD=false`.
- **Teto do WAIT:** confiança de WAIT nunca passa de 60.
- **Trava da UI:** quando R/R < 1.5 e entrada = market, a tela troca "entrar agora"
  por "aguardar recuo à zona" (`AnalysisResult.tsx`).

---

## 5. Como confirmar que a versão certa está no ar

- **Log do Render** (no boot): procure por `PromptSyncService` →
  `Prompt em dia (vX)` ou `Prompt do código sincronizado... vX ativada`.
- **Script de verificação:** `apps/backend/scripts/check-active-prompt.ts`
  → roda comparando o código com o ativo no banco e dá um veredito EM DIA / DEFASADO.

---

## 6. Resumo de bolso

1. Editar prompt = editar `trading-system-prompt.ts` → `git push`. O resto é automático.
2. Não mexer: 7 itens do checklist, nomes de campo do JSON, enums em inglês,
   `{{USER_CONTEXT}}`, rótulos do deep.
3. Se o que você quer mudar é "quando vira WAIT / cap de confiança / R/R / notícia",
   isso é **código** (seção 4), não prompt.
4. Na dúvida, abra o **chat do prompt** (este) e descreva a mudança — não edite no escuro.
