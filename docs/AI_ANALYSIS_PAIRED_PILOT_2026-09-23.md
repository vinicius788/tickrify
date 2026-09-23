# Piloto pareado de qualidade da análise — 23/09/2026

## Decisão

**Não promover a variante de prompt WAIT v1.** Em oito gráficos históricos pareados, ela não tornou os WAIT mais acionáveis do que o prompt ativo: todos os cinco WAIT do baseline já traziam uma condição observável em `alternativeScenario`, e todos mantinham os níveis de negociação nulos. A variante produziu seis WAIT, incluindo um caso em que o baseline deu BUY. Essa amostra pequena não mede acerto financeiro nem prova que a variante piora a plataforma; ela tampouco fornece evidência de melhora.

Nenhum prompt, flag, modelo, dado ou serviço de produção foi alterado. As consultas à produção foram de leitura. As 16 chamadas pagas foram feitas pelo runner local no worktree isolado, com gráficos públicos históricos e saídas ignoradas pelo Git.

## Configuração congelada

| Item | Valor verificado |
| --- | --- |
| Prompt ativo no banco | Versão 11, criada em 09/09/2026, SHA-256 `00783ace62ae49315d8c33648d834c9475f428f00361c9d08f24cc85540a78bb` |
| Prompt local do baseline | SHA-256 idêntico ao ativo; cópia congelada em `scripts/backtest/results/active-prompt-v11-2026-09-23.txt` |
| Variante | Cinco alterações apenas nas instruções de explicação de HOLD/WAIT; SHA-256 `984c28b0a6b48237c6ae286b8f26f96ebc147246a75e835f8756855fbc85c83d` |
| Modelo quick e deep no Render | `gpt-5.6-luna` |
| Esforço de raciocínio | Quick `low`; deep sem variável específica, portanto padrão do provedor |
| Grounding quick no Render | `ENABLE_QUICK_GROUNDING=true` |
| Overrides dessas flags no banco | Nenhum para grounding, enriquecimento, news guard, RR guard ou A/B v9 |

O piloto desligou grounding, enriquecimento e news guard **apenas dentro do processo local** porque os prints são cortes históricos. Manteve o RR guard. Isso permite comparar o efeito do prompt sobre a mesma imagem, mas **não reproduz a experiência completa de produção**, especialmente dados atuais, calendário, cobertura de símbolos e resultado pós-análise. A configuração efetiva em produção deve continuar sendo acompanhada separadamente.

## Amostra e gasto

Foram os oito primeiros casos do manifesto `scripts/backtest/pilot-manifest.json`: quatro quick e quatro deep, todos BTCUSDT 30m, com cortes entre 11/10/2025 e 17/07/2026. A imagem, o modelo e o esforço ficaram iguais em cada par. O modelo é não determinístico; uma resposta diferente no mesmo gráfico não pode ser atribuída com certeza às cinco linhas alteradas sem repetições de controle.

| Medida | Baseline ativo | Variante WAIT v1 |
| --- | ---: | ---: |
| Respostas / falhas | 8 / 0 | 8 / 0 |
| WAIT | 5 | 6 |
| BUY | 2 | 1 |
| SELL | 1 | 1 |
| WAIT com `alternativeScenario` | 5/5 | 6/6 |
| WAIT sem entrada, stop, alvo ou invalidação numérica ativos | 5/5 | 6/6 |
| Tokens de entrada | 95.356 | 96.276 |
| Tokens de saída (inclui raciocínio) | 13.715 | 12.825 |
| Duração média da chamada | 20,4 s | 20,7 s |
| Custo calculado a partir do uso retornado | US$ 0,03553 | US$ 0,03465 |

Total estimado: **US$ 0,07017 para 16 chamadas**. É uma estimativa local pelos preços Standard registrados no código em 23/09/2026, não uma fatura nem limite rígido do provedor. Cada rodada tinha limite de chamadas no processo e reserva local de custo; nenhuma alcançou seu teto de US$ 0,20.

## Pares observados

| Corte UTC | Modo | Baseline | Variante | Observação |
| --- | --- | --- | --- | --- |
| 11/10/2025 11:00 | quick | WAIT | WAIT | Ambos nomearam fechamento abaixo de 110.500 como condição; a variante acrescentou um segundo cenário. |
| 14/01/2026 09:30 | deep | BUY | BUY | Entradas e stops divergiram apesar do mesmo sinal; é necessário verificar níveis contra candles e repetir chamadas. |
| 16/03/2026 00:30 | quick | WAIT | WAIT | Ambos trouxeram gatilhos observáveis. |
| 24/04/2026 22:30 | quick | WAIT | WAIT | O baseline já especificava limites da faixa; a variante ficou mais curta. |
| 23/05/2026 23:00 | quick | WAIT | WAIT | Ambos indicaram confirmação abaixo de 76.000; a variante não eliminou níveis hipotéticos no cenário alternativo. |
| 21/06/2026 01:30 | deep | BUY | WAIT | Única mudança de recomendação; não há julgamento de qual sinal foi melhor sem validação dos candles futuros e controle de variância. |
| 09/07/2026 09:00 | deep | WAIT | WAIT | Ambos definiram confirmação de estrutura, com preços diferentes. |
| 17/07/2026 06:00 | deep | SELL | SELL | Mesma direção, níveis de entrada/stop/alvos diferentes. |

Os resultados integrais estão em `scripts/backtest/results/pilot-active-v11-{baseline,candidate}-{2,next6}.jsonl`, com metadados ao lado. São artefatos locais ignorados pelo Git. O campo `promptOrigin=active-snapshot` da rodada da variante indica a procedência do **baseline** do qual ela foi derivada; o SHA-256 distinto identifica a variante.

## Implicação para o plano

1. **Não usar taxa de WAIT isolada como meta de otimização.** A promessa é melhorar a análise, não fabricar entradas. Comparar a taxa de primeira análise WAIT e a fração de usuários grátis que veem BUY/SELL em três análises com os números do PostHog informados pelo dono, mas exigir também qualidade dos sinais, acerto por coorte, falhas e custo.
2. **Auditar o que chega à análise antes de mexer de novo no prompt.** Medir por modo e classe de ativo se a imagem tem símbolo/período legíveis, se candles/RSI realmente foram injetados, se notícias e calendário estavam disponíveis e se havia timeframes adicionais de verdade. O piloto mostrou que um print 30m sozinho ainda produz alegações de alinhamento M30/H1/H4 por inferência. Isso precisa aparecer como limitação clara ou usar dados reais de outros timeframes.
3. **Preparar uma avaliação cega maior e balanceada.** Incluir cripto, forex, metais e índices; gráficos quick e deep; regimes de tendência, lateralidade e volatilidade; repetições do mesmo prompt para medir a variância do modelo. Avaliar ação observável do WAIT, coerência da direção com os níveis, leitura indevida de timeframes, idioma e desfecho posterior sem vazamento de futuro.
4. **Só considerar rollout após evidência e salvaguardas.** Manter mudança offline até existir ganho em qualidade sem aumento de falhas ou perda de acerto. Se houver A/B futuro, isolar uma variável, registrar versão de prompt/modelo/flags e comparar com os números de 23/09 sem afetar os três usuários pagantes sem decisão explícita do dono.

## Reprodutibilidade

O runner `apps/backend/scripts/analysis-pilot-runner.ts` exige arquivo de prompt local, modelo e esforço explícitos, intervalo de casos, teto de chamadas, reserva de custo e `--execute`; o padrão é dry-run. O manifesto e os hashes de gráficos são checados antes das chamadas. O código fonte e este relatório permanecem no worktree `codex/analise-cenario-seguro`; não houve push ou deploy.
