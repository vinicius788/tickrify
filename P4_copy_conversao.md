# Tickrify — Copy de Conversão (P4)

Copy pronta para as 4 "telas mortas" do funil de fundo, com CTA único por tela, nota de design (hierarquia/timing) e o evento PostHog que cada tela deve disparar.

Princípio: o paywall cai no **pico de valor** (3ª análise entregue, trader já confiou na IA). Toda tela tem **uma** ação primária. Linguagem de trader, anti-hype — reaproveita o lexico do projeto ("operar no escuro", "confirma ou derruba sua leitura", "confluência", "risco").

Regra de moeda: **na interface, fala-se em "análises", não em "ticks".** "Tick" fica só no código/billing. O trader entende "análise"; "tick" é atrito cognitivo no momento de pagar.

---

## P4.1 — Valor trancado (4ª análise borrada + cadeado)

**Quando:** trader bate o limite e tenta a 4ª. Em vez de esconder, mostra um card de análise borrado com cadeado — ele *vê* que há entrada/stop/alvos/confiança ali, só não lê os números.

### Copy recomendada
- **Selo:** `Análise pronta`
- **Headline:** `Sua leitura está pronta. Destrave para ver.`
- **Sub:** `Entrada, stop, alvos e nível de confiança — calculados neste gráfico. Suas 3 análises grátis acabaram.`
- **CTA único:** `Destravar análise →`
- **Microcopy abaixo do CTA:** `Early user: cupom EARLY50 — 50% no 1º mês`

### Alternativas de CTA
| Opção | Copy | Melhor para |
|---|---|---|
| A (recomendada) | `Destravar análise →` | Foca no objeto de desejo que ele está vendo borrado |
| B | `Assinar e ver agora` | Quando o teste mostrar que "assinar" converte mais que "destravar" |
| C | `Continuar com o Tickrify` | Tom mais suave, menos transacional |

### Nota de design (critique)
Não rode a IA de verdade na 4ª (custo de API + economia que o projeto quer proteger). Use um **preview estático borrado** com os *rótulos* visíveis (Entrada / Stop / Alvo / Confiança) e os *valores* borrados — a forma cria o desejo sem gastar inferência. O cadeado vai sobre os valores, não sobre os rótulos.

### Evento
`upgrade_modal_viewed { trigger: 'locked_value' }` ao renderizar o card trancado.

---

## P4.2 — Modal de upgrade (timing no limite)

**Quando:** dispara junto com `free_limit_reached`, no clique da 4ª. É o momento de maior valor percebido.

### Copy recomendada
- **Headline:** `Você usou suas 3 análises grátis`
- **Body:** `A IA tá te ajudando a confirmar entradas — não faz sentido voltar a operar no escuro. Libere análises ilimitadas e continue de onde parou.`
- **CTA primário:** `Assinar — análises ilimitadas`
- **Ação secundária (link discreto, não botão):** `Agora não`
- **Linha de cupom:** `Early user: EARLY50 = 50% no 1º mês`

### Alternativas de headline
| Opção | Copy | Tom |
|---|---|---|
| A (recomendada) | `Você usou suas 3 análises grátis` | Factual, sem culpa |
| B | `Acabaram suas análises — seus trades não esperam` | Urgência (reaproveita o e-mail 5.4) |
| C | `Quer a leitura do próximo gráfico?` | Pergunta, foco no próximo trade |

### Nota de design (critique)
A secundária ("Agora não") é **link de texto**, não botão — um único peso visual evita competição de CTA. Não use "Cancelar"/"OK". O cupom fica logo abaixo do CTA, não no topo (o gancho é a ação, o desconto é o empurrão final).

### Evento
`upgrade_modal_viewed { trigger: 'free_limit_reached' }`. Distinga do CTA manual de preços com `trigger: 'pricing_cta'` — assim você separa quem foi empurrado pelo limite de quem foi por vontade própria.

---

## P4.3 — Clareza da moeda ("ticks") no pricing e no modal

**Problema:** "tick" como moeda interna confunde na hora de pagar.

### Recomendação
Na interface, **a unidade é "análise".** Onde hoje aparece "tick", troque por "análise". Se o billing precisa de "tick" internamente, mantenha só no backend.

### Copy recomendada
- **Contador no dashboard (free):** `2 de 3 análises grátis usadas` — *não* `1 tick restante`
- **Card de plano (headline do valor):** `Análises ilimitadas` ou `120 análises / mês` — a métrica grande é "análises"
- **Se precisar manter "tick" visível (tooltip):** `1 análise = 1 tick. Cada gráfico que você manda consome 1.`
- **Linha de plano grátis no pricing:** `Grátis — 3 análises para testar`

### Nota de design (critique)
A âncora de comparação entre planos tem que ser a **mesma palavra em todas as telas** (consistência): dashboard, pricing e modal todos dizem "análises". Trocar de termo entre telas é o que gera a confusão atual.

---

## P4.4 — CTA único em cada tela morta

Três telas onde o trader "trava". Cada uma: **uma** ação primária, zero ambiguidade.

### a) Limite atingido
Mesma tela do P4.1/P4.2. CTA único: `Destravar análise →` (ou abre o modal P4.2). Nada mais clicável de peso.

### b) Erro de análise (`analysis_failed`)
Copy por `code` — estrutura: o que houve + por quê + como resolver. **Crédito não é consumido em erro** (diga isso, reduz ansiedade).

| `code` | Headline | Body | CTA único |
|---|---|---|---|
| `image_unreadable` | `Não consegui ler esse gráfico` | `A imagem pode estar cortada ou em baixa resolução. Manda um print mais limpo, com os candles e o eixo de preço visíveis.` | `Tentar de novo` |
| `timeout` / cold start | `O servidor estava acordando` | `Primeira análise depois de um tempo parado demora um pouco. Tenta de novo — agora vai rápido.` | `Tentar de novo` |
| `rate_limit` | `Muitas análises ao mesmo tempo` | `Aguenta uns segundos e manda de novo.` | `Tentar de novo` |
| genérico | `Algo deu errado nessa análise` | `Não foi você — foi do nosso lado. Seu crédito não foi usado. Tenta de novo.` | `Tentar de novo` |

> Nota de design: o backend hiberna no Render Free, então a **primeira** análise depois de inatividade pode dar `timeout`. Vale tratar esse caso com a copy de "servidor acordando" em vez do erro genérico — senão o trader acha que o produto é quebrado logo na 1ª impressão. Microcopy de rodapé: `Seu crédito não foi consumido.`

### c) Fim de análise (ainda tem crédito)
Depois de entregar o resultado, um próximo passo suave que cria hábito.

- **CTA primário:** `Analisar outro gráfico`
- **Contador ao lado:** `Você tem 2 análises grátis restantes`
- Quando chega a 0 → essa tela vira o estado trancado (P4.1).

### Botão principal do dashboard — recomendação
O plano diz "botão Analisar vira Fazer upgrade" na 4ª. **Sugestão:** manter o rótulo `Analisar gráfico` sempre visível e, no clique com 0 crédito, abrir o valor trancado (P4.1). Trocar o rótulo do botão tira a affordance da ação e esconde o momento de mostrar o valor borrado. O gatilho do upgrade vem da *tela trancada*, não da troca de label.

---

## Resumo de eventos (para o funil)

| Tela | Evento | Propriedade-chave |
|---|---|---|
| Valor trancado | `upgrade_modal_viewed` | `trigger: 'locked_value'` |
| Modal no limite | `upgrade_modal_viewed` | `trigger: 'free_limit_reached'` |
| Limite batido | `free_limit_reached` | `reason` |
| Erro | `analysis_failed` | `code`, `durationMs` |
| CTA de assinar | `upgrade_clicked` | `plan`, `signedIn` |

Essas propriedades deixam você responder no PostHog: o trancado converte melhor que o modal puro? O `timeout` de cold-start está derrubando ativação? Qual `code` de erro mais aparece?

---

*Lembrete do contexto: dados ainda vazios (só tráfego de teste). Essa copy é a hipótese inicial — a versão final sai do A/B depois que a distribuição começar e os números reais aparecerem.*
