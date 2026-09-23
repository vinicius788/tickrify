# Evolução segura da análise de IA da Tickrify

Plano de trabalho para **melhorar a análise da plataforma atual**. O projeto de
um modelo próprio poderá nascer em outro repositório; não é pré-requisito para
as melhorias abaixo. Este documento não altera prompt, modelo, fila, cobrança
nem o resultado de análises existentes.

## 1. Estado atual confirmado no código

- O motor já separa **cenário** (`bias`: `bullish`, `bearish`, `neutral`) de
  **ação** (`recommendation`: `BUY`, `SELL`, `WAIT`). Uma análise `WAIT` pode ter
  cenário comprador ou vendedor. Resultado histórico, worker e métricas usam a
  ação; a interface deve mostrar ambos sem misturá-los.
- Quick e deep podem usar modelos diferentes (`AI_MODEL_QUICK`,
  `AI_MODEL_DEEP`) e esforço de raciocínio separado. Há prompt versionado,
  experimento de prompt por usuário, guardas determinísticos e enriquecimento
  de dados de mercado.
- O worker classifica resultados de operações em `WIN`, `LOSS`, `NO_FILL`,
  `TIMEOUT`, `ABSTAIN`, `INCOMPLETE` e `UNTRACKABLE`. O endpoint de acurácia
  agrupa por confiança, prompt e modelo. Logs `[Cost]` registram tokens e
  estimativa de custo por análise; eles ainda precisam virar uma linha de base
  consultável antes de qualquer decisão de modelo.
- Existe backtest reproduzível (`scripts/backtest/`), mas seus caches de dados,
  gráficos e respostas são locais/ignorados pelo Git. Este checkout não contém
  essa amostra pronta. O teste offline não substitui imagens reais autorizadas
  dos usuários.

## 2. O que significa “melhorar”

Uma leitura deve identificar corretamente ativo, período, preço e estrutura
visível; distinguir fato observado de hipótese; explicar cenário, invalidação e
ação; e não inventar volume, notícias, múltiplos períodos ou precisão que a
imagem não fornece. Um trade proposto deve ter níveis coerentes. Uma abstenção
com motivo concreto pode ser melhor que uma entrada forçada.

Medir cada versão em **quick e deep**, por classe de ativo e período, com os
seguintes indicadores. Sempre publicar numerador, denominador e período:

| Dimensão | Medida | Cuidado de interpretação |
| --- | --- | --- |
| Confiabilidade | falha, JSON inválido, timeout, p50/p95 de latência | incluir tentativas, não apenas análises concluídas |
| Leitura do gráfico | ativo/período/preço corretos, estrutura sustentada pela imagem, contradições | revisão cega com rubrica e exemplos autorizados |
| Plano | níveis completos/coerentes, preço de entrada alcançável, R:R calculado | não confundir um plano válido com lucro garantido |
| Resultado | `WIN/(WIN+LOSS)` com intervalo de confiança | mostrar junto `NO_FILL`, `TIMEOUT`, `ABSTAIN`, `INCOMPLETE` e `UNTRACKABLE` |
| Calibração | acerto por faixa de confiança e cobertura de sinais | não inflar acerto simplesmente emitindo mais `WAIT` |
| Economia | custo médio e p95 por quick/deep, tokens, margem por tick | usar `usage` real; revisar tabela de preços antes de estimar USD |

O endpoint público já exige amostra mínima para mostrar acurácia. Para escolher
uma variante, não usar um único percentual bruto: comparar segmentos
equivalentes, intervalos de confiança, qualidade da leitura, falhas e custo.

## 3. Sequência de implementação

### Etapa A — sem mudar decisões da IA

1. Concluir a apresentação de **Bullish / Bearish / Neutral** como cenário,
   com ação **Comprar / Vender / Aguardar** separada. Preservar os enums da API,
   banco, worker e eventos analíticos. Testar `WAIT+bullish`, `WAIT+bearish`,
   `WAIT+neutral` e registros antigos sem `bias`.
2. Estabelecer linha de base de 2 a 4 semanas, ou do período histórico
   disponível: volume por quick/deep/modelo/prompt, falhas, latência, custo,
   cobertura e resultados já maduros. Um export agregado basta inicialmente;
   nenhuma imagem ou prompt bruto deve entrar em logs.
3. Auditar as fontes do dado: imagem disponível no momento da análise,
   candles, horário, ativo/período, fonte de preço e falhas de enriquecimento.
   Rotular explicitamente “não disponível” quando faltar evidência.

### Etapa B — avaliação offline antes de alterar produção

1. Montar conjunto estratificado por cripto, forex, metais, índices; quick e
   deep; tendências, range, alta volatilidade e imagens difíceis. Usar apenas
   gráficos próprios, públicos com licença apropriada ou material cujo uso
   para avaliação foi autorizado. Não recuperar nem guardar prints privados
   de produção sem base e processo definidos.
2. Congelar exemplos e rubrica **antes** de testar candidatos. Duas avaliações
   separadas: (a) qualidade da leitura da imagem, julgada sem conhecer o preço
   futuro; (b) resultado do plano, julgado pelo backtest com regra de fill,
   TP/SL e janela fixadas. Marcar discordâncias entre avaliadores.
3. Rodar primeiro o motor atual como baseline. Depois variar **uma coisa de
   cada vez**: prompt, modelo, dados externos ou pós-processamento. Comparar
   a mesma amostra, reportar todos os casos e não reescolher exemplos após ver
   o resultado.

### Etapa C — experimento controlado

Só promover candidato se melhorar a rubrica sem piorar de forma material
falhas, latência, custo e cobertura. Começar com percentual pequeno e estável
por usuário, usando flags já existentes quando aplicáveis; não mudar prompt e
modelo no mesmo experimento. Acompanhar casos de erro diariamente. Aguardar a
janela de maturação do outcome antes de declarar melhoria de acerto; amostras
pequenas significam **resultado inconclusivo**, não vitória. Reverter a flag
se a qualidade ou confiabilidade cair. O deploy e a alteração de flags de
produção são etapas separadas deste trabalho.

### Etapa D — dados melhores, depois modelo próprio

Priorizar dados que comprovem uma hipótese de erro observada: candles com
origem e horário, calendário econômico confiável, disponibilidade de volume,
ou múltiplos períodos realmente fornecidos. Cada fonte precisa de limite de
tempo, fallback, custo e indicação de ausência. Construir uma base de casos
rotulados e resultados medidos em formato portátil; ela servirá para comparar
provedores e, mais tarde, para treinar/ajustar um modelo em projeto separado.
Treinar um modelo do zero só faz sentido após medir tamanho e direitos da base,
qualidade alcançável, custo de GPU/inferência e economia frente à API atual.

## 4. Orçamento e capacidade

Esta primeira mudança de apresentação adiciona **zero chamadas de IA por
análise**. Para os próximos experimentos, usar os tokens reais do log `[Cost]`
e a fórmula abaixo, separados por quick e deep:

`custo_teste = número_de_casos × (custo_baseline + custo_candidato)`

`custo_AB_adicional = análises_expostas × (custo_candidato − custo_baseline)`

Acrescentar custos de dados externos, revisão humana e infraestrutura. Fixar
um teto em USD **antes** da execução; interromper o lote ao atingi-lo. O código
atual considera US$ 29/200 ticks como receita teórica por tick, mas isso não é
margem real: descontos, uso, Stripe, impostos, hospedagem e suporte precisam
entrar na conta. Preços de API e GPU mudam; validar cotações no dia de cada
experimento. Nenhum gasto de treinamento ou GPU é necessário na Etapa A.

## 5. Checklist de promoção

- Baseline e critérios de aceitação registrados antes do candidato.
- Testes de contrato quick/deep, API/worker, `WAIT` com cenário direcional,
  registros antigos, histórico, compartilhamento e métricas passando.
- Comparação offline pareada e orçamento aprovados.
- Caminho de rollback por flag para qualquer mudança de decisão da IA.
- Deploy backend antes de frontend quando houver campo novo na API; só depois
  validar resultados em amostra controlada e acompanhar logs/outcomes.

**Andamento em 23/09/2026:** A1 concluída na branch isolada. A2 possui
[snapshot agregado da API pública](AI_ANALYSIS_BASELINE_2026-09-23.md),
[extrator local de logs](../scripts/analysis-baseline.mjs) e uma amostra
limitada de 50 linhas de métricas/custo do Render. A3 tem
[mapa de fontes e distribuição histórica/recente](AI_ANALYSIS_BASELINE_2026-09-23.md):
63 dos 92 `UNTRACKABLE` históricos são de metais, mas nenhum ocorreu em metais
nos 14 dias anteriores a 23/09; o único recente era de índice. A
[consulta agregada de cobertura](../scripts/analysis-outcome-coverage.sql), a
[rubrica offline](AI_ANALYSIS_EVAL_RUBRIC.md) e o
[comparador pareado](../scripts/analysis-eval.mjs) estão preparados. Ainda
faltam logs agregados completos, diagnóstico operacional de cada fonte e
revisão cega dos casos.

O [piloto local](AI_ANALYSIS_PILOT_2026-09-23.md) preserva 48 gráficos
históricos (24 quick, 24 deep), hashes e cortes temporais. Seus oito primeiros
casos, todos BTCUSDT 30m, foram usados em
[duas comparações offline](AI_ANALYSIS_PAIRED_PILOT_2026-09-23.md) com o
prompt ativo v11 congelado. Forex, metais, índices e prints reais autorizados
continuam ausentes; nenhum ganho de produto ou de rentabilidade está provado.

O [recorte de PostHog informado em 23/09](AI_ANALYSIS_POSTHOG_BASELINE_2026-09-23.md)
acrescenta duas métricas de ativação para a comparação pós-mudança: WAIT na
primeira análise e usuários grátis que veem ao menos um BUY/SELL nas três
análises. A taxa de falha e os outcomes continuam guardrails; reduzir WAIT
sem melhorar a qualidade da leitura não é objetivo suficiente.

O [mapa de causas possíveis de WAIT](AI_ANALYSIS_WAIT_DIAGNOSTIC_2026-09-23.md)
separa resposta crua do modelo de rebaixamentos posteriores. O
[preflight offline](../scripts/analysis-pilot-preflight.mjs) verificou os 48
gráficos; o runner isolado já executou 8 casos pareados em cada variante com
modelo, esforço e orçamento locais explícitos. A comparação completa dos 48
exigiria pelo menos 96 chamadas por candidata e ainda não foi feita.

A [auditoria das promessas da página e do contrato real da análise](AI_ANALYSIS_PRODUCT_PROMISE_AUDIT_2026-09-23.md)
encontrou três lacunas a testar: grounding quick depende de flag e pode falhar;
deep não injeta o mesmo bloco OHLCV/RSI; o prompt pode apresentar alinhamento
de três timeframes inferido de uma única imagem. O
[piloto WAIT](AI_ANALYSIS_PAIRED_PILOT_2026-09-23.md) não mostrou ganho de
explicação: o baseline já trazia condição observável nos cinco WAIT. A
[segunda avaliação](AI_ANALYSIS_DATA_COVERAGE_AND_MTF_2026-09-23.md) encontrou
8/8 alegações MTF sem imagem correspondente no baseline; a variante offline
retirou as oito, mas também mudou um SELL para WAIT. Nenhuma variante foi
promovida.

O [runner isolado](../apps/backend/scripts/analysis-pilot-runner.ts) faz
dry-run por padrão, verifica hashes, modo, esforço e teto de chamadas antes de
`--execute`. Três lotes de oito respostas (baseline ativo, candidata WAIT e
candidata MTF) foram executados localmente, com custo calculado pelo uso
retornado de cerca de US$ 0,105 no total. Isso não é a fatura nem um teto de
faturamento do provedor. A instrumentação categórica de cobertura de dados foi
preparada atrás de `AI_DATA_COVERAGE_LOG=false`; não foi implantada ou ativada.
