# TRADING_SYSTEM_PROMPT v5.0 — Plano de Upgrade

## Diagnóstico: o que está ótimo vs o que falta

### O que já é profissional no v4.0
- 11 agentes especializados (Footprint, Volume Profile, TPO, Reversal...)
- Instrument Type Detection (A-F) com cálculo correto de pips/pontos
- Session Detection (Asian/London/NY/Overlap/Dead Zone)
- JSON estruturado com 30+ campos parseáveis no dashboard
- Score: está no top 5% de prompts de trading

### Os 4 gaps estruturais que limitam a precisão

| Gap | Problema | Score atual | Impacto |
|-----|----------|-------------|---------|
| 1 - Chain of Thought | Modelo pula agentes e vai direto ao JSON | 30/100 | ALTO |
| 2 - Auto-validação | Pode emitir BUY em downtrend sem barreira | 0/100 | ALTO |
| 3 - Contexto do usuário | Adivinha símbolo/timeframe pela imagem | 55/100 | MÉDIO-ALTO |
| 4 - Calibração com penalidades | Score só soma, nunca subtrai — gera falsos positivos | 40/100 | MÉDIO |

---

## Estrutura do v5.0 — onde cada bloco entra

```
┌────────────────────────────────────────────────────────┐
│  [NOVO] USER_CONTEXT (injetado pelo backend)           │  ← Gap 3
│  Símbolo, timeframe, preço atual (quando disponíveis)  │
├────────────────────────────────────────────────────────┤
│  [NOVO] PART 0 — MANDATORY CHAIN OF THOUGHT           │  ← Gap 1
│  Força raciocínio passo-a-passo antes do JSON          │
├────────────────────────────────────────────────────────┤
│  PART 1 — Adaptive Timeframe (sem mudança)             │
│  PART 1B — Session Detection (sem mudança)             │
├────────────────────────────────────────────────────────┤
│  PART 2 — Multi-Agent Architecture                     │
│    Agents 1-9 (sem mudança)                            │
│    Agent 10: CONFLUENCE_ENGINE                          │
│      [MODIFICADO] Adição de regras de PENALIDADE       │  ← Gap 4
│    Agent 11 (sem mudança)                              │
├────────────────────────────────────────────────────────┤
│  PART 3 — Momentum Override (sem mudança)              │
│  PART 4 — Behavioral Guidelines (sem mudança)          │
├────────────────────────────────────────────────────────┤
│  PART 5 — JSON OUTPUT FORMAT                           │
│    [NOVO] SELF-VALIDATION CHECKLIST antes do JSON      │  ← Gap 2
│    JSON schema (sem mudança)                           │
├────────────────────────────────────────────────────────┤
│  PART 6 — Critical Reminders (atualizado com novos)    │
└────────────────────────────────────────────────────────┘
```

---

## Gap 1 — Chain of Thought forçado (PART 0)

### Problema
O v4.0 define 11 agentes mas NUNCA obriga o modelo a executá-los em sequência. Quando o output é `json_schema` strict, o GPT tende a pular direto para o JSON, "adivinhando" a análise sem processar cada agente. É como ter 11 especialistas na sala mas ninguém fala antes da decisão final.

### Solução
Adicionar um PART 0 que força o modelo a realizar um "scratchpad" mental antes de emitir o JSON. O modelo precisa passar por cada agente em ordem e registrar suas conclusões no campo `reasoning`.

### Bloco novo — posição: ANTES do PART 1

```
═══════════════════════════════════════════════════════════════
# PART 0 — MANDATORY CHAIN OF THOUGHT (CoT)
═══════════════════════════════════════════════════════════════

CRITICAL INSTRUCTION: You MUST reason through EVERY applicable agent below BEFORE generating the JSON output. Do NOT skip to the conclusion.

## EXECUTION ORDER (mandatory, sequential):

Step 1 → CHART_INSPECTOR: What chart type is this? What timeframe? What indicators are visible? Image quality?
Step 2 → STRUCTURE_ANALYST: What is the trend? Where are the swing highs/lows? Any BOS or CHoCH?
Step 3 → FOOTPRINT_ANALYST (if applicable): What does delta show? Any imbalances? Absorption?
Step 4 → VOLUME_PROFILE_ANALYST (if applicable): Where is POC? Price above/below VAH/VAL?
Step 5 → TPO_ANALYST (if applicable): IB range? Day type? Single prints?
Step 6 → PATTERN_RECOGNITION: Any candlestick patterns? Chart patterns?
Step 7 → REVERSAL_DETECTOR: Any reversal signals? How many categories confirmed?
Step 8 → PRICE_ACTION_ANALYST: What does pure price action tell us?
Step 9 → ADAPTIVE_RISK_MANAGER: What instrument type? Calculate SL/TP with the correct method.
Step 10 → CONFLUENCE_ENGINE: Sum all scores. Apply penalties. What is the final score?
Step 11 → DECISION_SYNTHESIZER: Based on ALL agents above, what is the recommendation?

## CoT OUTPUT RULE:
Your "reasoning" field in the JSON MUST contain a summary of what each applicable agent found.
Structure it as:
  "[STRUCTURE] Trend: ... BOS/CHoCH: ... [PATTERNS] Found: ... [CONFLUENCE] Score: X/100 because... [DECISION] Recommendation: ... because agents 2, 6, and 7 agree on..."

If you cannot identify what an agent would find (e.g., no Footprint visible), state "N/A — standard chart" and move on. Do NOT skip agents silently.

## WHY THIS MATTERS:
Without this step, you tend to generate a plausible-sounding analysis that doesn't actually reflect what's in the image. By reasoning through each agent explicitly, your accuracy improves dramatically.
```

---

## Gap 2 — Auto-validação pré-output

### Problema
O modelo pode emitir BUY com marketStructure.bias = "bearish", ou SELL com entry > stopLoss, sem que nada no prompt o force a verificar. O worker do Tickrify tem `validateTradingLogic()` que pega alguns erros, mas a maioria dos erros lógicos (contradições de direção) passa.

### Solução
Adicionar um checklist de validação que o modelo DEVE executar mentalmente ANTES de gerar o JSON final. Se qualquer check falhar, ele deve corrigir antes de emitir.

### Bloco novo — posição: dentro do PART 5, ANTES do JSON schema

```
═══════════════════════════════════════════════════════════════
# SELF-VALIDATION CHECKLIST (execute before emitting JSON)
═══════════════════════════════════════════════════════════════

BEFORE generating the JSON output, verify ALL of the following. If any check FAILS, fix your analysis before proceeding.

## DIRECTIONAL CONSISTENCY CHECKS:
□ If recommendation = BUY → marketStructure.bias MUST be "bullish" (not bearish/neutral with no explanation)
□ If recommendation = SELL → marketStructure.bias MUST be "bearish" (not bullish/neutral with no explanation)
□ If recommendation = HOLD → entry, stopLoss, takeProfit1, takeProfit2 MUST ALL be null
□ If recommendation = BUY → entry > stopLoss AND takeProfit1 > entry AND takeProfit2 > takeProfit1
□ If recommendation = SELL → entry < stopLoss AND takeProfit1 < entry AND takeProfit2 < takeProfit1

## MATHEMATICAL CHECKS:
□ riskRewardRatio matches actual (TP1 - entry) / (entry - SL) calculation
□ stopLossPercent is negative for BUY, positive for SELL (relative to entry)
□ takeProfit1Percent and takeProfit2Percent have correct sign
□ confluenceScore is between 0-100 and matches the sum from CONFLUENCE_ENGINE
□ confidence is between 0-100 and is NOT a copy of confluenceScore

## LOGICAL CHECKS:
□ "reasoning" field contains evidence from at least 2 agents in the CoT
□ "whyNotOpposite" actually explains why the opposite direction was rejected
□ "riskFactors" lists at least 2 specific risks, not generic statements
□ SL is placed beyond a structural level (not an arbitrary round number)
□ If detectedSession = "dead_zone" → confidence is capped at 45

## IF A CHECK FAILS:
Do NOT output the JSON with the error. Fix the value first.
Example: If you wrote BUY but bias = bearish → re-examine the structure. Either change to SELL/HOLD or explain why BUY despite bearish bias (e.g., reversal setup).
```

---

## Gap 3 — Contexto do usuário estruturado

### Problema
O modelo tenta ler o símbolo e timeframe diretamente da imagem do gráfico. Funciona em 70% dos casos, mas falha quando: o gráfico está cortado, a fonte é pequena, o screenshot é de celular, ou a plataforma não mostra o símbolo proeminentemente. O modelo então "adivinha" BTCUSDT ou EURUSD e toda a análise de SL/TP fica errada.

### Solução
Criar um bloco USER_CONTEXT no início do prompt que pode ser preenchido pelo backend quando o usuário fornece essas informações, ou deixado como "auto-detect" quando não. Isso requer uma mudança mínima no backend (PromptBuilder injeta o contexto) mas não é obrigatório para o v5.0 funcionar — o fallback é auto-detect como hoje.

### Bloco novo — posição: ANTES de tudo (primeira coisa do prompt)

```
═══════════════════════════════════════════════════════════════
# USER_CONTEXT (injected by system — DO NOT hallucinate)
═══════════════════════════════════════════════════════════════

{{USER_CONTEXT}}

## CONTEXT RULES:
- If USER_CONTEXT provides symbol, timeframe, or price → USE THEM as ground truth. Do NOT override with image reading.
- If USER_CONTEXT is empty or says "auto-detect" → Read from the chart image as usual.
- If USER_CONTEXT provides data that CONTRADICTS what you see in the image → TRUST the user context for symbol/timeframe, but trust the IMAGE for price action and structure.
- NEVER invent context that wasn't provided. If no context, say "auto-detected from chart image."
```

### Mudança no backend (PromptBuilder)
O `PromptBuilderService.buildPrompt()` precisará substituir `{{USER_CONTEXT}}` com os dados do usuário. Se o usuário não fornecer nada, substitui por:
```
Symbol: auto-detect from chart image
Timeframe: auto-detect from chart image
Current price: auto-detect from chart image
```

Se o frontend eventualmente adicionar campos opcionais (símbolo, timeframe), o backend os injeta:
```
Symbol: BTCUSDT
Timeframe: 15m
Current price: 84168.00
```

---

## Gap 4 — Score calibration com penalidades

### Problema
O AGENT 10 (CONFLUENCE_ENGINE) só soma pontos. Nunca subtrai. Resultado: um gráfico pode ter tendência bearish (+15 da estrutura) + padrão bullish engulfing (+15 do padrão) + preço em resistência (+10) = 40 pontos. Cada agente encontrou algo, mas os sinais se contradizem. O score de 40 deveria ser 25 (com penalidade por contradição), mas hoje fica 40 e pode virar um HOLD ambíguo ou até um trade ruim se houver momentum override.

### Solução
Adicionar regras de PENALIDADE ao CONFLUENCE_ENGINE. Sinais contraditórios subtraem pontos em vez de apenas não somar.

### Modificação — posição: dentro do AGENT 10, APÓS o "### ADJUSTED THRESHOLDS"

```
### PENALTY RULES (subtract from total score):

**Contradictory Direction Signals:**
- Structure says UP but dominant pattern is bearish (or vice versa): −15 points
- Delta positive but price action shows selling pressure (or vice versa): −10 points
- Recommendation direction contradicts marketStructure.bias: −20 points (CRITICAL — should trigger re-evaluation)

**Weak Foundation Penalties:**
- Only 1 supporting factor (not 2+): −10 points
- SL placed at arbitrary round number (not structural level): −5 points
- R:R < 1:1.5 for the calculated trade: −10 points
- Confidence > 80 but confluenceScore < 60: −10 points (over-confidence penalty)

**Context Penalties:**
- Dead zone session: −15 points (cap confidence at 45)
- Image quality < 50: −10 points
- Symbol/timeframe could not be identified: −5 points

**RULE:** Penalties are applied AFTER adding all bonus points. Final score cannot go below 0.
**RULE:** If penalties reduce score below threshold → recommendation MUST be HOLD regardless of individual agent findings.
```

---

## Resumo do impacto esperado

| Dimensão | v4.0 | v5.0 (esperado) |
|----------|------|-----------------|
| Cobertura de mercados | 95/100 | 95/100 (sem mudança) |
| Cálculo SL/TP | 88/100 | 88/100 (sem mudança) |
| Estrutura de output (JSON) | 90/100 | 92/100 (auto-validação previne JSON quebrado) |
| Chain of Thought forçado | 30/100 | 80/100 (raciocínio sequencial obrigatório) |
| Auto-validação pré-output | 0/100 | 75/100 (checklist obrigatório) |
| Injeção de contexto | 55/100 | 85/100 (USER_CONTEXT estruturado) |
| Calibração de score | 40/100 | 70/100 (penalidades por contradição) |

### Notas sobre max_tokens

O v5.0 adiciona ~800 tokens ao system prompt (PART 0 + validação + contexto + penalidades). O campo `reasoning` ficará mais longo porque agora documenta o CoT de cada agente.

**Recomendação para max_tokens após v5.0:**
- quick analysis: 3500 (o `reasoning` fica mais longo com o CoT)
- deep analysis: 5000

---

## Ordem de implementação sugerida

1. **Gap 4 (Penalidades)** — menor risco, maior impacto imediato. Basta adicionar o bloco no Agent 10. Não muda o schema JSON.
2. **Gap 2 (Auto-validação)** — reduz erros lógicos que o worker já detecta com `validateTradingLogic()`. Não muda o schema.
3. **Gap 1 (CoT forçado)** — maior impacto na qualidade, mas aumenta tokens do reasoning. Testar se o `max_tokens` é suficiente.
4. **Gap 3 (USER_CONTEXT)** — requer mudança no backend (PromptBuilder + possível campo no frontend). Implementar por último.
