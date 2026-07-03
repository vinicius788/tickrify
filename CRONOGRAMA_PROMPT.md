# Cronograma — Qualidade da Análise da IA (rumo ao lançamento)

> Premissa do dono: **qualidade > custo** (o custo é repassado no preço da análise).
> Objetivo: lançar com a melhor análise possível, sem perder tempo.
> Arquivo local — não versionar/publicar. Ver `PROMPT_GUARDRAILS.md` e `AVALIACAO_PROMPT_3A_OPINIAO.md`.

---

## TL;DR

- **Pra lançar bem:** só precisa da **Fase 0 + Fase 1**. É rápido.
- **Fragmentar** (rotear estratégia por gráfico) é ótimo, mas é **pós-lançamento** — não trava o lançamento.
- O maior ganho com menor esforço é **subir o modelo do caminho rápido para `gpt-4o`** (1 variável de ambiente).

---

## FASE 0 — Medir (30 min) · CRÍTICO · faz primeiro
**Por quê:** confirma o tamanho real do problema antes de qualquer obra.
- [ ] Pegar 1 gráfico e rodar **2 análises**: uma no **rápido** (hoje = `gpt-4o-mini`) e uma no **deep** (`gpt-4o`).
- [ ] Comparar coerência (níveis, confluência, sinal, aderência às regras).
- **Resultado esperado:** se o deep vier nitidamente melhor → o modelo é o gargalo → Fase 1 resolve. Se vierem iguais → o tamanho importa menos.
- **Quem:** você roda na plataforma e me manda os 2 prints; eu interpreto.

## FASE 1 — Ganho de qualidade imediato · CRÍTICO PRA LANÇAR
**Risco baixo, sem cirurgia no prompt.**

- [ ] **1a. Subir o modelo do caminho rápido para `gpt-4o`.**
  - Como: no Render, setar a variável `AI_MODEL=gpt-4o` (afeta as análises; o passo barato de leitura de símbolo segue no mini).
  - Ganho: acaba com a "diluição de atenção" do prompt grande; análise rápida fica tão boa quanto o deep.
  - Custo/latência: mais caro por análise e ~30-50s (vs ~15s). Aceitável dado "qualidade > custo".
  - **Quem:** você / outro chat (é só variável no Render, não precisa de código).
- [ ] **1b. Adicionar 2–3 few-shot examples ao prompt** (1 COMPRA limite na zona, 1 VENDA, 1 HOLD legítimo).
  - Ganho: maior aderência às regras — o jeito mais eficiente de melhorar, e agora cabe bem no `gpt-4o`.
  - Preserva 100% o contrato (checklist 7 itens, JSON, rótulos).
  - **Quem:** este chat (prompt).

➡️ **Concluiu Fase 0+1 e o teste deu bom? Pode lançar.**

## FASE 2 — Reduzir conflito sem perder capacidade · PÓS-LANÇAMENTO
**Risco baixo-médio, só prompt.**
- [ ] **2a. Rebaixar Wyckoff e Elliott para "confirmação/contexto"** (não remover) — reduz conflito entre metodologias, mantém o diferencial.
- [ ] **2b. Enxugar** Footprint/Volume Profile/TPO para 1 linha e comprimir os textos mais longos (~10-20% menor).
- **Quem:** este chat (prompt).

## FASE 3 — Fragmentação (tua ideia) · OTIMIZAÇÃO · PÓS-LANÇAMENTO
**Maior retorno de eficiência, maior esforço de engenharia. Só vale se a Fase 1 não bastar.**
- [ ] **3a. Roteamento por classe de ativo:** núcleo compartilhado (metodologia + checklist + JSON) + módulo pequeno por ativo (preço/SL/TP daquele ativo). Cada análise carrega só o relevante.
  - **Quem:** este chat (prompts) + ajuste de código no `prompt-builder`/`worker` (alinhar com outro chat se ele cuida de infra).
- [ ] **3b. Gating por regime (opcional):** um passo barato classifica tendência/lateral/acumulação/distribuição e só então aplica a lente certa (Wyckoff em range, Elliott em correção A-B-C, ICT/SMC sempre no núcleo).
  - **Quem:** este chat + código.

---

## Divisão de responsabilidade (pra alinhar com o outro chat)
- **Este chat (do prompt):** 1b, 2a, 2b, e a parte de prompt da 3a/3b. Segue o `PROMPT_GUARDRAILS.md`.
- **Você / outro chat (infra/deploy):** 1a (variável `AI_MODEL` no Render), deploy, e a parte de código do roteamento (3a) se preferir centralizar infra lá.

## Regra de ouro (não esquecer)
Qualquer mudança no prompt **preserva o contrato**: 7 itens do checklist, nomes dos campos do JSON, enums em inglês, `{{USER_CONTEXT}}`, rótulos do deep. Compactar pode; remover capacidade/quebrar contrato, não.
