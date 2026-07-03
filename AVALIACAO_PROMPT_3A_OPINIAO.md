# Avaliação do Prompt da IA — Terceira Opinião

> **Papel deste documento / deste chat:** especialista em **(A) estratégia de trading**
> (ICT/SMC, Wyckoff, Elliott, gestão de risco) **e (B) infraestrutura de plataforma/IA**
> (prompt engineering, custo/latência de modelo, arquitetura do pipeline de análise).
>
> Diferencial sobre as outras duas opiniões: **elas avaliaram só o texto do prompt.
> Esta avaliação conhece o código por trás** (os guards determinísticos, o fluxo
> worker/adapter, qual modelo roda). Isso corrige várias conclusões.
>
> Arquivo local — não versionar/publicar (contém estratégia). Ver também `PROMPT_GUARDRAILS.md`.

---

## Contexto que as outras IAs não tinham (e que muda tudo)

1. **A matemática NÃO é feita "no olho" pelo modelo.** R:R, confluência e confiança
   são **recalculados/reconciliados/limitados por código** depois da IA:
   - `computeRiskReward` → R:R sai dos níveis (entry/SL/TP), não do texto do modelo.
   - `capConfidenceByConfluence` + `harmonizeConfidenceWithTrend` → teto de confiança.
   - `reconcileConfluence` → conserta a confluência a partir do checklist textual.
   - `applyRiskRewardGuard` → rebaixa para WAIT se o R:R não fecha.
   - `correctPriceMagnitude` → conserta erro de 10x na leitura de preço.
   → Tudo em `signal-decision.ts` + `analysis-normalizer.ts`.

2. **"Muitos HOLDs" já foi atacado** (R/R guard por melhor alvo, fim do "WAIT seco",
   entrada limitada na zona, teto de WAIT). É um problema em manutenção ativa.

3. **Modelo real:** caminho **rápido = `gpt-4o-mini`** (a maioria das análises),
   **deep = `gpt-4o`**. Isso é decisivo para o ponto de "tamanho do prompt".

---

## Veredito ponto a ponto sobre as críticas

| Crítica das outras IAs | Meu veredito (com o código na mão) |
|---|---|
| "Modelo calcula R:R/confluência/confiança e erra" | **Já resolvido ~80%** — o código recalcula/limita. O modelo propõe, o código corrige. |
| "Leitura de preço frágil" | **Parcialmente mitigado** (`correctPriceMagnitude` conserta 10x). Leitura fina ainda depende do modelo — risco residual real. |
| "Muitos HOLDs" | **Já em correção.** Cuidado agora é não afrouxar demais. |
| "Prompt grande demais / diluição de atenção" | **VÁLIDO — e mais grave aqui**, porque o padrão roda no `gpt-4o-mini`. ~28,8k chars no mini = regras do fim do prompt perdem força. |
| "Faltam few-shot examples" | **VÁLIDO e de maior ROI.** 2–3 exemplos bons rendem mais que 10 regras novas. |
| "Metodologias demais conflitam (ICT+SMC+Wyckoff+Elliott)" | **Parcialmente válido.** Solução não é remover — é **posicionar Wyckoff/Elliott como CONFIRMAÇÃO**, não como geradores primários de sinal. |
| "Pede H4/D1 de um print M5 (inferência)" | **Parcial.** O prompt já rotula inferência como inferência e aceita upload multi-timeframe. Melhor solução é de **produto/UX** (incentivar o 2º gráfico), não cortar o raciocínio HTF. |
| "Reduzir Footprint/Volume Profile/TPO" | **Concordo, baixo custo.** São pouco usados e ocupam espaço — encolher para 1 linha. |

---

## O que eu mudaria (priorizado: ROI alto, risco baixo primeiro)

1. **Adicionar 2–3 few-shot examples** (1 BUY limite na zona, 1 SELL, 1 HOLD legítimo).
   → Maior ganho de aderência, principalmente no `gpt-4o-mini`. Baixo risco.
2. **Enxugar 10–20%**: cortar Footprint/VP/TPO para uma linha e comprimir as
   explicações mais longas — **sem** tocar nos itens de valor nem no contrato.
3. **Rebaixar Wyckoff/Elliott para "confirmação/contexto"** (não remover): reduz
   conflito interno mantendo teu diferencial.
4. **Documentar que a matemática é do código** (para nenhuma futura revisão
   re-levantar isso como bug).
5. *(Opcional)* Variante compacta — **só** se você for usar modelo ainda mais barato.
   No `gpt-4o`/`gpt-4o-mini` atuais, um corte cego de 40–50% não compensa o risco.

## O que eu NÃO faria

- **Não** "gutar" o prompt nem remover: Liquidity Filter, HTF Bias, OB, FVG,
  CHoCH, BOS, Premium/Discount, Invalidação, Plano B. As três opiniões concordam:
  é onde está o valor.
- **Não** fazer corte cego de 40–50%: quebraria o **contrato** (checklist de 7 itens,
  nomes de campo do JSON, rótulos do deep, enums) do qual os guards dependem.
  Qualquer compactação tem que respeitar o `PROMPT_GUARDRAILS.md`.
- **Não** remover o raciocínio de HTF só porque às vezes é inferência — melhor
  resolver no produto (upload do timeframe maior).

---

## Resumo em uma linha

As críticas são **~60% válidas e ~40% já resolvidas no código ou arriscadas de aplicar
às cegas**. A ação de maior retorno é **few-shot examples**; a de maior urgência real,
dado que o padrão roda no `gpt-4o-mini`, é **enxugar sem quebrar o contrato**. Wyckoff/
Elliott: rebaixar para confirmação, não remover. Matemática: já é código — pode ficar tranquilo.
