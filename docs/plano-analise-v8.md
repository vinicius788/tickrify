# Plano — Análise v8: leitura mais completa + dados reais

> **Documento historico.** Este plano preserva a proposta original da evolucao
> v8. Partes dele foram implementadas ou alteradas depois; nao o use como
> backlog, especificacao atual ou instrucao de execucao.

**Objetivo:** tornar a leitura do gráfico tão completa e ancorada em dado real que o valor da análise **independa do resultado do trade**. O usuário deve sentir "ele leu o gráfico direitinho e trouxe o contexto completo", mesmo quando o mercado reverte. A decisão de compra/venda é sempre do usuário — a plataforma entrega **leitura + contexto + cenários**, não promessa de acerto.

**Princípio inegociável:** tudo aditivo. Nada pode quebrar o fluxo que já está em produção. Cada fase liga atrás de uma flag, degrada graciosamente e é validada antes de avançar.

---

## 1. A mudança estrutural (o coração do plano)

Hoje a análise mistura "o que o gráfico mostra" com "compra ou venda". Vamos separar em **camadas**, elevando a parte descritiva (objetiva, quase sempre correta) acima da parte direcional (incerta):

1. **Leitura descritiva** — o que ESTÁ no gráfico. Alta confiança.
2. **Contexto de mercado** — dados reais externos (ATR, DXY, juros, BTC.D, VIX, COT…). Rotulado "dado real" vs "estimado do gráfico".
3. **Cenários** — caminho de alta SE X / caminho de baixa SE Y + invalidação. Mostra os dois lados.
4. **Hipótese de trade** — a sugestão direcional, claramente rotulada como a parte incerta. "A última palavra é sua."

Isso casa com o posicionamento de **copiloto** e protege contra churn: a leitura entrega valor mesmo sem o trade dar certo.

---

## 2. Blocos novos de leitura (vão no prompt do plano *deep*)

Baseado em frameworks que mesas institucionais usam de fato:

- **Fase de Wyckoff** — acumulação / distribuição / markup / markdown; spring/upthrust. Onde estamos no ciclo. (visual, custo zero de dado)
- **Volume Profile / Value Area** — POC (preço de maior volume = "valor justo") e zona de 70% do volume como S/R dinâmico. *Estimado do gráfico* quando não houver dado real.
- **Regime de volatilidade (ATR)** — estado da volatilidade + justificativa da distância do stop por ATR (ex.: "stop a 1.5× ATR em expansão").
- **Mapa de liquidez** — topos/fundos iguais, onde stops estão acumulados, prováveis alvos de sweep.
- **Veredito top-down multi-timeframe** — HTF (viés) → MTF (estrutura) → LTF (gatilho), com veredito explícito de **alinhamento ou conflito**.
- **Driver intermarket** — a correlação que importa pro ativo (ouro ↔ DXY/juros; índices ↔ risk-on/off; cripto ↔ BTC.D).
- **Confluência de indicadores** — RSI/MACD/médias **somente se visíveis** no gráfico.
- **Árvore de cenários** — alta/baixa condicionais + invalidação.

### Regras anti-alucinação (obrigatórias no prompt)
- "Comente **apenas** o que está visível. Se volume/indicador/timeframe não estão no gráfico, diga 'não visível' — **nunca invente**."
- Todo número derivado do print é **estimativa** e deve ser rotulado.
- Número vindo do backend (dado real) é rotulado "dado real" + fonte.

---

## 3. Enriquecimento com dado real (a parte do "acessar os números")

**Como funciona (modelo mental correto):** a IA **não navega** até o gráfico. Ela extrai o **símbolo + timeframe** do print; o **backend** busca os números reais daquele ativo e injeta no prompt. Mesmo padrão já usado hoje com funding/OI/long-short/fear&greed.

**Risco #1 (respeitado):** identificação errada do símbolo → dado errado (pior que dado nenhum). **Mitigação:** só buscar/injetar quando o símbolo for reconhecido com confiança E existir no mapa de símbolos conhecido; em dúvida, pula o bloco e a análise roda como hoje.

**Dados-alvo por fase (fontes a validar na implementação):**

| Classe | Dados | Fonte candidata | Status |
|---|---|---|---|
| Cripto | funding, OI, long/short, fear&greed | OKX/Binance/alternative.me | ✅ já temos |
| Cripto | dominância BTC, preço/ATR via klines | CoinGecko / exchange klines | a fazer |
| Forex/Ouro | DXY, juros (yields) | a validar (API FX/futuros) | a fazer |
| Forex | COT (semanal) | CFTC / Nasdaq Data Link (grátis) | a fazer |
| Índices | VIX | a validar | a fazer |

Cobertura será **desigual** entre classes — tudo bem: injeta o que existe, rotula, pula o que não existe.

---

## 4. Arquitetura de segurança (zero risco pra produção)

1. **Nunca bloqueia o core.** Busca de dados em paralelo ao upload, com timeout curto (~3-4s) e `Promise.allSettled`. Falha/lentidão de qualquer API → campo `null` → análise segue normal.
2. **Flag de ambiente** (`ENABLE_MARKET_ENRICHMENT`). Desliga na hora pelo Render, sem redeploy, sem reverter código.
3. **Degradação graciosa.** Prompt só inclui bloco de dados se o dado existir. Sem dado = análise idêntica à de hoje.
4. **Sem mudança destrutiva no banco.** Colunas novas só aditivas (padrão `ADD COLUMN IF NOT EXISTS` no `onModuleInit`, como já fizemos).
5. **Worker + caminho síncrono compartilham o adapter** → comportamento consistente, sem duplicar lógica divergente.
6. **Validação antes de cada push:** `npx tsc --noEmit` (FE+BE) + testes do normalizer; rollback é `git revert` de um commit pequeno e isolado.

---

## 5. Rollout em fases (do seguro pro novo)

- **Fase 0 — só prompt + schema (risco ~zero, update imediato pros usuários atuais).**
  Reestrutura em camadas (descritivo → contexto → cenários → hipótese) + Wyckoff, regime de volatilidade e árvore de cenários no *deep*. Não depende de nenhuma API externa. Atualiza tanto `ai.adapter` (schema strict) quanto o worker.
- **Fase 1 — dado real só cripto** (reusa módulo de mercado atual), atrás da flag. Observa logs em produção.
- **Fase 2 — forex/ouro** (DXY, juros, COT).
- **Fase 3 — índices** (VIX) e demais classes.

Cada fase = 1 commit pequeno, validado, provado em produção antes da próxima.

---

## 6. Campos novos no schema (rascunho — Fase 0)

Todos **nullable** e incluídos em `properties` **e** `required` (exigência do `json_schema strict`). Worker (`toWorkerAnalysisResult`) atualizado em paralelo.

- `wyckoffPhase` (enum: accumulation/distribution/markup/markdown/unknown) + `wyckoffNote`
- `volatilityRegime` (enum: low/normal/high/expanding) + `volatilityNote`
- `valueAreaNote` (estimativa de POC/value area, rotulada)
- `liquidityNote` (mapa de liquidez)
- `mtfVerdict` (enum: aligned/conflicting/unknown) + `mtfNote`
- `intermarketNote` (driver de correlação do ativo)
- `scenarioBull` / `scenarioBear` / `scenarioInvalidation`
- `dataSources` (lista do que foi dado real vs estimado) — Fase 1+

---

## 7. Custo e latência (mitigação)

- Leitura rica → só no **deep**; **quick** fica enxuto.
- Preferir **alimentar dado real** a pedir inferência (inferência custa token e erra mais).
- Monitorar tokens/latência após Fase 0; o timeout já está em 55s (env-ajustável).

---

## 8. O que NÃO fazer

- Não prometer acerto. A direção é hipótese.
- Não inventar dado/indicador ausente.
- Não tocar no fluxo quick além do necessário.
- Não fazer mudança de schema no banco que não seja aditiva.
- Não subir fase nova sem a anterior estar provada em produção.
