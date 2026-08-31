
---

## Sprint 31/08/2026 — auditoria de promessas, llms.txt e o rename que NAO foi feito

### 🔴 Rename BUY/SELL/HOLD → BULLISH/BEARISH/NEUTRAL: ADIADO com motivo

Foi pedido o rename ponta a ponta. **Foi investigado inteiro e decidido NAO
fazer.** O motivo nao e falta de tempo — e risco medido no produto. Registrado
aqui para ninguem reabrir como se fosse trivial:

**O vocabulario novo COLIDE com um campo que ja existe.** O `json_schema` do
adapter tem dois enums:

- `ai.adapter.ts:1609` → `analysis.marketStructure.bias`: `['bullish','bearish','neutral']`
- `ai.adapter.ts:1705` → `recommendation`: `['BUY','SELL','HOLD','COMPRA','VENDA','AGUARDAR']`

Renomear o segundo para BULLISH/BEARISH/NEUTRAL poe **vocabulario identico** em
dois campos a 96 linhas de distancia, com o `bias` sendo gerado ANTES. Abre um
caminho de copia obvio para o modelo: estrutura aponta pra cima → `bias:
bullish` → `recommendation: BULLISH`. Isso colapsaria a distincao que sustenta
o motor — *"a estrutura aponta pra cima" NAO e "existe entrada operavel"* — e a
absten cao (39%) e a tese do produto inteiro, nao um detalhe.

Nao e especulacao generica sobre LLM: **este repo ja mediu que o modelo e
extremamente sensivel a forma superficial do contrato de saida** — em 30/07 so
a ORDEM das chaves do schema fazia o modelo decidir antes de analisar, e isso
explicou as confiancas fixas (30/45/68/72) do backtest v2. Se a ordem mexe
tanto, o vocabulario dos valores tambem mexe.

Argumento secundario, mais simples: **"BUY" e palavra de acao, "BULLISH" e
palavra de opiniao.** Dizer "estou bullish" e barato; dizer "compre"
compromete. Baixar o custo do rotulo tende a baixar a barra de emissao — na
direcao errada para um produto cuja tese e abster-se.

**Se alguem reabrir isto, o mapa ja esta pronto (nao refaca a investigacao):**

- Camadas 3-9 sao rename MECANICO, risco zero de comportamento: `analysis-
  normalizer.ts` (tipo `Recommendation` + os arrays `*_HINTS`), `signal-
  decision.ts`, `drawing-plan.ts`, `ai.service.ts`, `outcome.sweeper.ts`,
  `ai.worker.ts`, `ai.controller.ts`, o front (`trading-ui.ts` e 8 componentes)
  e os 6 i18n.
- **O valor persistido e `WAIT`, nao `HOLD`.** Backend canonico e
  `BUY|SELL|WAIT` (`analysis-normalizer.ts:2`); front canonico e
  `BUY|SELL|HOLD` (`trading-ui.ts:1`). Sao vocabularios DIFERENTES hoje.
- **O SQL seria simples, e isso foi verificado:** `analysis-payload.ts:234` le
  `analysisRecord.recommendation ?? fullResponse.recommendation` — **a COLUNA
  ganha, o JSON e so ultimo recurso**, e o front le o campo normalizado do topo.
  Entao bastariam 3 `UPDATE` numa coluna `String`; NAO precisa de `jsonb_set`
  linha a linha (que foi o que inviabilizou a correcao do "Ouro/Dolar" em 17/08).
- Tres queries batem no valor cru no banco e quebrariam sem o UPDATE:
  `outcome.sweeper.ts:219` (`'WAIT'`), `:230` (`{in:['BUY','SELL']}`) e
  `ai.controller.ts:333` (`{in:['WAIT','HOLD','AGUARDAR']}`).
- **Nenhum evento de PostHog carrega o valor como propriedade** (verificado).
- Portao correto, se for reabrir: rodar o prompt candidato contra o oficial nas
  mesmas amostras com `backtest-runner.ts --prompt-file` (~US$1, ferramental ja
  existe em `scripts/backtest/`), mudando SO o vocabulario, e olhar **um numero
  so: a absten cao se mexeu?** Ou entao renomear o `bias` junto, para nao sobrar
  caminho de copia.

### 🔴 Calendario economico: 6 dias degradado, e e feature PAGA

Confirmado ao vivo em 31/08, sem token, no endpoint publico:

```
GET /api/calendar/events?symbol=XAUUSD&hours=24
{"symbol":"XAUUSD","events":[],"degraded":true}
```

A falha e a mesma detectada em 25/08 e continua **persistente** (nao
intermitente) — o que reforca a hipotese de bloqueio de origem do ForexFactory
e enterra de vez a de instabilidade de rede.

**O que isso significa e por que e pior do que parece:** o card de preco vende
`fS3: 'Live candle grounding + economic calendar'` e a landing vende
`f6: 'Economic calendar guard'`. O codigo esta CERTO (o `decideSignal` roda em
TODA analise, quick incluida, com janela de 2h — `signal-decision.ts:87`), mas
com a fonte degradada o guard **nunca dispara**. Ou seja: uma feature cobrada
esta inerte em producao ha pelo menos 6 dias, e falha calada por design (o
`degraded` faz o adapter nao injetar bloco nenhum, que e o comportamento seguro).

O `CLAUDE.md` ja mandava tratar `degraded` como **incidente de claim, nao como
config**. Esta e a primeira vez que o incidente e confirmado durando dias.
**Nao ha diagnostico da causa raiz ainda** — precisa do log do Render (o
`calendar.service.ts` agora distingue HTTP nao-ok / corpo nao-JSON / erro de
rede) ou de `/health` com o ops token.

### 🔴 `f3d` afirma um piso de R/R que o codigo NAO aplica

A landing diz *"with an eliminatory 1.5:1 R/R rule"*. O guard existe e esta
VIVO (`applyRiskRewardGuard`, chamado por `signal-decision.ts:74`, flag
`ENABLE_RR_GUARD` com default `true`) — **mas o piso eliminatorio e 1.2, nao
1.5**. O 1.5 e o que o PROMPT pede ao modelo; o que elimina de fato e 1.2. O
proprio comentario do codigo diz isso (`analysis-normalizer.ts:289`).

Mesma familia exata do card *"2:1 validated minimum R/R"* que a auditoria de
27/07 matou. **Corrigir a copy nos 6 idiomas** (o numero verdadeiro e 1.2), ou
subir o piso do guard para 1.5 — mas o segundo e mudanca de motor e exige
medicao.

Nota: a linha do `CLAUDE.md` de 27/07 que dizia *"o guard esta morto no
adapter"* esta DESATUALIZADA. Ele foi religado desde entao.

### ✅ `llms.txt` no ar (`apps/frontend/public/llms.txt`)

Estatico em `public/`, mesmo mecanismo do `/blog/`, `/tools/` e `/for/` (o
Vercel serve o arquivo antes do rewrite). Sem dependencia, sem build.

Escrito sob a regra da casa (so afirma o que o codigo faz), e por isso ele tem
uma secao **"What it does not do"** e publica a **cobertura desigual de
grounding** — cripto completo, forex/metais sem volume, acoes/ETFs sem feed
nenhum. **Nao carrega numero de acuracia**: manda ler a `/accuracy` ao vivo,
porque numero em arquivo estatico congela e vira claim falso sozinho (foi
exatamente assim que o `388`/`39%` hardcoded no `SocialProof.tsx` envelheceu).

### Numeros lidos ao vivo em 31/08 (`GET /api/ai/accuracy`)

n=112 · acerto **40,2%** (IC 31,6-49,4). Por banda de confianca: 60-69 → 39,5%
(n=43) · 70+ → **39,7%** (n=68). **A confianca continua sem discriminar nada**
— as duas bandas praticamente empatadas, com IC quase inteiramente sobrepostos.
E a mesma conclusao de 27/07, agora com amostra maior. `byGrounding.after` esta
em n=8 (75%), **nao publicavel** e sem significado ainda.

