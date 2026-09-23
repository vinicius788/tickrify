# Diagnóstico de WAIT antes de alterar o motor — 23/09/2026

O [recorte informado de PostHog](AI_ANALYSIS_POSTHOG_BASELINE_2026-09-23.md)
mostra 82 WAIT em 97 primeiras análises observadas desde 24/08 e 78–94% de
WAIT/HOLD nas semanas recentes. Esses números justificam investigar a
experiência inicial, mas não dizem **por que** o motor aguarda nem se os
sinais ausentes seriam operações melhores. Não mudar o prompt ou remover
guardas com base apenas nessa taxa.

## Onde a decisão pode virar WAIT

1. **Modelo/prompt:** o prompt versionado neste checkout manda aguardar quando há pouca
   confluência (até 3 de 7 itens), estrutura não confirmada, R:R insuficiente,
   imagem inutilizável, liquidez contrária sem plano ou falta de gatilho para
   uma entrada. Para mercados de sessão também há regra de horário; cripto é
   explicitamente isenta. O prompt já orienta uso de ordem limit quando o
   movimento está estendido, em vez de transformar todo contexto direcional
   em HOLD. O PromptConfig ativo no banco pode diferir desse arquivo; sua
   origem deve ser congelada antes do baseline. Logo, “o modelo ficou abstrato”
   é hipótese a testar, não diagnóstico.
2. **Guardas depois do modelo:** `decideSignal` só conserva ou rebaixa ações;
   nunca converte WAIT em BUY/SELL. Caps de confiança não mudam a ação. O
   guard de risco/retorno pode rebaixar BUY/SELL para WAIT quando o melhor
   alvo calculado fica abaixo de 1,2R (o prompt pede pelo menos 1,5R); o
   guard de notícia pode fazer o mesmo
   perto de evento de alto impacto. No backtest histórico, o guard de notícia
   fica desligado para não consultar o calendário de hoje para um gráfico do
   passado. Isso não prova o peso de cada guarda na produção.
3. **Entrada incompleta:** imagem, ativo, período ou contexto externo
   insuficientes podem levar a WAIT correto. O caminho quick pode perder
   grounding quando não reconhece o timeframe do print. Precisamos medir a
   disponibilidade da evidência antes de culpar um modelo ou incentivar
   entradas sem suporte.

## Medição offline preparada

O [diagnóstico agregado](../scripts/analysis-signal-diagnostic.mjs) lê os
JSONL locais do backtest, restringe aos IDs congelados do piloto e mostra:
WAIT na resposta crua, WAIT após regras, sinais crus rebaixados, falhas e
cobertura. Quando há baseline e candidata, compara ações **apenas nos casos
concluídos em ambos com modo, hash do gráfico, ativo e período verificados**.
Ele não envia dados a serviço externo, não imprime IDs, textos de erro nem
respostas brutas e não chama IA.

```bash
node scripts/analysis-signal-diagnostic.mjs \
  --manifest scripts/backtest/pilot-manifest.json \
  --baseline scripts/backtest/results/baseline.jsonl \
  --candidate scripts/backtest/results/candidate.jsonl \
  --out /caminho/local/diagnostico-wait.md
node --test scripts/analysis-signal-diagnostic.test.mjs
```

No estado atual, há **48 gráficos congelados e nenhuma resposta do motor**.
Portanto, a origem do WAIT permanece indeterminada. O piloto cobre apenas
BTC/ETH e tem 24 casos quick + 24 deep; não permite inferir comportamento de
forex, metais, índices ou da interface real dos usuários.

O [preflight offline](../scripts/analysis-pilot-preflight.mjs) confere os hashes
do manifesto, da seleção, das amostras, de cada PNG e dos dados de cada série;
recusa arquivo fora dos diretórios previstos, PNG inválido, caso repetido e
modo ausente. A execução em 23/09 verificou os 48 casos: 24 quick, 24 deep,
quatro séries e 1.634.160 bytes de gráficos. Baseline + uma candidata exigem
**pelo menos 96 chamadas principais**, sem contar falhas, retries ou chamadas
auxiliares. É uma quantidade de requisições, **não uma estimativa de custo**.
O comando abaixo apenas lê arquivos locais; não importa o backend nem usa
credenciais:

```bash
node scripts/analysis-pilot-preflight.mjs
node --test scripts/analysis-pilot-preflight.test.mjs
```

## Bloqueios para uma rodada paga comparável

O `apps/backend/scripts/backtest-runner.ts` existente não deve ser usado para
esta comparação sem ajuste: chama `analyzeImage(..., 'quick')` em todos os
casos; o custo exibido é uma constante de US$ 0,01 por análise, inferior à
média de **US$ 0,0193** observada nas 50 linhas quick recentes de `[Cost]`;
permite até quatro chamadas por caso devido a retries; pode consultar o
PromptConfig ativo se houver conexão ao banco; e não registra no JSONL o
modo ou hash do PNG recebido. A média observada não é teto nem orçamento,
e ainda não temos custo deep confiável. A regra antiga `--yes` pula só uma
pergunta no terminal, não limita gasto.

Antes de chamar a API, o runner da avaliação precisa selecionar exatamente os
48 IDs congelados, passar quick/deep corretamente, verificar hash da imagem,
fixar a origem e o hash do prompt sem acesso implícito ao banco, exigir teto de
requisições que conte retries e registrar uso/custo por chamada, inclusive
falhas. Só então calcular e aprovar um limite financeiro para uma rodada
pequena. A primeira variante deve mudar **um fator** em relação ao baseline;
os resultados serão julgados pela [rubrica cega](AI_ANALYSIS_EVAL_RUBRIC.md),
não apenas pelo percentual de WAIT.

O motor também pode fazer chamadas extras quando o grounding quick ou o
enriquecimento deep estão ligados. Essas opções terão de ficar explicitamente
fixadas para o piloto; o total de 96 acima só conta a análise principal. O
prompt ativo da plataforma deve ser congelado em uma cópia local identificada
por hash antes de chamar de “baseline atual” qualquer resultado. O preflight
não substitui esses dois bloqueios nem autoriza a execução paga.
