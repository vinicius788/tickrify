# Cobertura de dados e evidência de múltiplos períodos — 23/09/2026

## O que foi encontrado

Nos oito casos BTCUSDT 30m do [piloto pareado](AI_ANALYSIS_PAIRED_PILOT_2026-09-23.md), o modelo recebeu **uma imagem por caso**. Mesmo assim, o prompt ativo produziu em 8/8 um `multiTimeframeAlignment` com H1/H4 ou “2/3”/“3/3”. O campo descrevia inferências do próprio gráfico de 30m como se fossem leituras de períodos adicionais. Isso é uma lacuna de evidência, independentemente de o sinal final ter sido BUY, SELL ou WAIT.

O caminho quick pode acrescentar candles atuais, RSI e contexto de mercado, mas o bloco é best-effort. Antes desta mudança, o log `[QuickGrounding]` só aparecia quando algum bloco era montado; a ausência de log não distinguia flag desligada, símbolo ilegível, período desconhecido, fonte indisponível, print antigo e timeout. O deep acrescenta contexto/calendário, **não** o bloco OHLCV/RSI do quick. Portanto, a cobertura real da promessa “candles antes de cada leitura” ainda precisa ser medida e, no deep, implementada ou descrita corretamente antes de qualquer afirmação universal.

## Preparação segura no branch isolado

- `AI_DATA_COVERAGE_LOG=true` habilita **uma linha categórica por análise**, antes da chamada principal ao modelo. O padrão é desligado. A linha contém modo, classe ampla do ativo, número limitado de imagens HTF solicitadas/entregues e estados de candles/contexto. Não contém ID, símbolo, preço, prompt, imagem, resposta ou erro bruto. Não há nova chamada de rede nem alteração de decisão.
- Estados de candles quick: `injected`, `symbol_unreadable`, `timeframe_unreadable`, `unsupported_asset`, `provider_unconfigured`, `source_unavailable`, `stale_withheld`, `block_unavailable`, `timeout` ou `error`. `disabled` indica flag desligada; `not_attempted` identifica o deep. O bloco de contexto tem estados separados.
- A mensagem enviada ao modelo só diz que há **múltiplos gráficos** quando ao menos uma imagem extra realmente foi preparada. Se todas falharem, usa a instrução de gráfico único. Isso corrige uma afirmação factual sem mudar a decisão por regra.
- A guarda de print antigo já retinha candles atuais, mas ainda acrescentava **contexto de mercado atual** ao mesmo prompt histórico. O branch isolado agora retém ambos quando detecta divergência de preço; o estado do contexto vira `stale_withheld`. É uma mudança de comportamento que deve ser avaliada antes de qualquer deploy, pois a leitura de preço da imagem pode ocasionalmente errar.
- O registro não mede disponibilidade do calendário de forma separada, nem prova correção dos candles recebidos. A própria análise pode falhar antes da montagem do conteúdo; falhas continuam na trilha de erros. Não se deve interpretar ausência de linha como ausência de análise.

O uso futuro do registro deve separar quick/deep e classe de ativo, medir denominadores e comparar cobertura ao longo de dias. A ativação em produção, a consulta aos logs e qualquer mudança de texto público ou no motor exigem etapa operacional separada. **Nada foi ativado ou implantado nesta etapa.**

## Variante offline de evidência MTF

O gerador `scripts/analysis-mtf-candidate.mjs` parte do prompt ativo v11 congelado e altera nove trechos ligados à leitura de períodos. Com uma imagem, ele manda descrever somente a estrutura visível, deixar `multiTimeframeAlignment=null` e marcar o item MTF do checklist como não avaliável e sem ponto. Com imagens extras legíveis, permite alinhamento apenas entre os períodos realmente fornecidos. As bandas de decisão 6–7, 4–5 e ≤3 não mudaram.

SHA-256 do baseline: `00783ace62ae49315d8c33648d834c9475f428f00361c9d08f24cc85540a78bb`. SHA-256 da variante: `43881a9266aa94ceb98511a2b4506062b1b5e89cebbc0176e2decb5a9cef2fd9`. A saída local é `scripts/backtest/results/candidate-active-v11-mtf-evidence-v1.txt`; o runner a usou nos mesmos oito casos e com o mesmo modelo `gpt-5.6-luna`, quick `low`, deep no esforço padrão, grounding/enriquecimento/news guard desligados apenas no piloto histórico.

| Medida nos oito casos | Prompt ativo | Variante MTF |
| --- | ---: | ---: |
| `multiTimeframeAlignment` preenchido sem imagem HTF | 8/8 | 0/8 |
| Alegação H1/H4/D1 ou 2/3/3/3 nos campos principais | 8/8 | 0/8 |
| BUY / SELL / WAIT | 2 / 1 / 5 | 2 / 0 / 6 |
| Falhas | 0 | 0 |
| Custo estimado do lote pelos tokens retornados | US$ 0,03553 | US$ 0,03469 |

A variante retirou as oito alegações sem fonte nesta amostra, mas transformou o SELL de 17/07/2026 em WAIT. O modelo é não determinístico: uma única chamada por variante e caso não separa o efeito do prompt da variância natural. Todos os gráficos são da mesma classe/período e o piloto não incluiu o grounding de produção, outros ativos nem resultado financeiro adjudicado. **Não promover a variante a partir deste teste.**

## Próxima avaliação necessária

1. Rodar a rubrica cega já definida em `docs/AI_ANALYSIS_EVAL_RUBRIC.md` para o baseline e a variante, destacando erro crítico de dado/HTF inventado, qualidade do plano e mudança BUY/SELL/WAIT.
2. Adicionar gráficos de forex, metais e índices e casos com duas ou três imagens reais; nesses casos, verificar se a variante continua usando HTF quando ele foi fornecido. Repetir pelo menos alguns casos para medir a variância do modelo.
3. Medir cobertura efetiva de candles/contexto por modo e classe antes de alterar promessa ou ampliar o grounding. Avaliar separadamente uma forma de fornecer OHLCV/RSI também ao deep, com fonte, frescor, timeout e fallback explícitos.
4. Comparar eventual mudança de produto com os marcos de 23/09 do PostHog: WAIT na primeira análise, ao menos um BUY/SELL nas três grátis, falhas com código e outcome maduro. Menos WAIT sozinho não é critério de aprovação.

Arquivos JSONL do piloto ficam ignorados pelo Git em `scripts/backtest/results/`. O código e este relatório permanecem apenas no worktree `codex/analise-cenario-seguro`; não houve push, deploy ou escrita em produção.
