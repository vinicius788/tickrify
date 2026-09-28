# Próxima avaliação da análise — protocolo congelado em 23/09/2026

## Atualização de 28/09/2026 — rodada pareada concluída

O prompt **ativo em produção é a versão 12**, SHA-256 `c5826b45596a5e466cd5dce8c176b25f60f1dc6ff2a15208c173cb1513fb9319`, conferida em leitura no Render com o literal versionado. Os resultados v11 abaixo são históricos; para a decisão atual, foram executados 48 pares com o prompt v12 e com a candidata MTF v3, em `gpt-5.6-luna`, nos mesmos gráficos BTCUSDT/ETHUSDT de 30m/4h (24 quick e 24 deep). O runner histórico desligou contexto ao vivo, grounding e notícias para impedir vazamento temporal; portanto esta rodada mede leitura visual e consistência, não o fluxo completo de produção. Não houve escrita em banco de produção nem ativação de prompt.

| Indicador, 48 gráficos | Prompt ativo v12 | Candidata v12 MTF v3 |
| --- | ---: | ---: |
| Falhas de resposta | 0 | 0 |
| WAIT / BUY / SELL | 5 / 18 / 25 | 13 / 16 / 19 |
| Campo MTF preenchido sem imagem HTF | 48 | 0 |
| Checklist concede MTF sem HTF | 22 | 0 |
| Divergência entre checklist e X/7 | 29 | 17 (mais 3 sem pontuação verificável) |
| Planos com níveis ausentes, lado errado ou WAIT ativo | 0 | 0 |
| WIN / LOSS / sem preenchimento / timeout no proxy histórico | 10 / 15 / 18 / 0 | 9 / 12 / 13 / 1 |
| R médio por sinal, incluindo sem preenchimento | +0,0949 | +0,1545 |
| R médio por sinal deep | -0,1841 | -0,0074 |
| Custo estimado local deste braço | US$ 0,2255 | US$ 0,2206 |

O proxy de outcome usa 96 candles futuros, perda conservadora quando stop e alvo aparecem no mesmo candle, e **não** inclui spread, slippage, execução real ou uma amostra representativa de mercados. O ganho aparente de R não prova vantagem comercial. O auditor também marcou 24 textos da candidata com nomes de períodos superiores para revisão humana de contexto; isso não equivale automaticamente a afirmar leitura verificada. A candidata cumpre o objetivo estrutural do campo MTF e melhora o checklist, mas ainda requer revisão cega de dois avaliadores independentes e amostra de forex, metais e índices. **Decisão: não ativar a candidata em produção.** O pacote cego de 48 casos foi preparado localmente em `scripts/backtest/results/pilot-v12-mtf-v3-blind-20260928.review.json`, com chave separada, ambos ignorados pelo Git.

Comparar também com a v11 deixa claro por que reduzir WAIT sozinho é insuficiente: na v11 foram 31 WAIT e 17 sinais, enquanto a v12 atual gerou 5 WAIT e 43 sinais, mas manteve MTF preenchido sem HTF em todos os 48 casos e apresentou 29 divergências de checklist. A candidata v3 não resolve por si só a falta de evidência multitemporal nem valida o desempenho dos sinais no mercado real. O próximo gate continua sendo revisão humana cega, classes de ativos adicionais e monitoramento dos marcos PostHog de 23/09 após qualquer mudança controlada.

## Registro histórico de 23/09 (superado pela atualização acima)

O branch `codex/analise-cenario-seguro` corrigiu transparência de evidências, checklist inconsistente e probabilidades fabricadas, mas **não demonstrou melhora dos sinais**. O candidato MTF v1 removeu afirmações de H1/H4 sem imagem nos oito casos do piloto, porém mudou um SELL para WAIT e teve mais divergências internas de checklist (4/8 contra 3/8). O sufixo DEEP foi corrigido na candidata v2, que ainda não recebeu chamadas ao modelo. Nenhum prompt candidato foi ativado.

O runner local agora aceita `--prompt-file-deep` além do arquivo quick e registra hashes dos dois arquivos e dos prompts finais efetivamente montados. Isso impede que o quick receba o sufixo deep ou que o deep receba a instrução antiga por engano. Um teste de dry-run reproduz os hashes sem chave, banco, arquivo de resultado ou chamada de API.

## Lote A/B pronto para execução offline

O manifesto validado contém **48 gráficos históricos públicos**, 24 quick e 24 deep, divididos igualmente entre BTCUSDT/ETHUSDT e 30m/4h. A nova variante deep difere da rodada anterior; para comparação limpa, executar os **48 casos novamente em cada braço**, sem combinar respostas da candidata v1 com a v2. Os dois dry-runs passaram com `caseOffset=0`, `maxCalls=48`, hashes de imagem intactos, `gpt-5.6-luna`, esforço quick `low` e deep padrão. Grounding, contexto de mercado e news guard ficam desligados **somente no runner histórico** para não misturar dados atuais com prints antigos; RR guard permanece ligado. Este lote avalia leitura visual e coerência do plano, **não** a experiência completa de produção.

Arquivos congelados: baseline `active-prompt-v11-2026-09-23.txt` (SHA-256 `00783ace62ae49315d8c33648d834c9475f428f00361c9d08f24cc85540a78bb`), candidata quick `candidate-active-v11-mtf-evidence-v2-base.txt` (`43881a9266aa94ceb98511a2b4506062b1b5e89cebbc0176e2decb5a9cef2fd9`) e candidata deep `candidate-active-v11-mtf-evidence-v2-deep.txt` (`706b90c701c2fb7c16804d0faf1d404f77464564d0cf29776b10dba6460a56a6`). Todos ficam em `scripts/backtest/results/`, ignorados pelo Git. O teste automatizado da CLI usa arquivos temporários gerados de fontes versionadas, sem depender desses artefatos locais.

Nos oito pares anteriores, o custo calculado a partir dos tokens retornados foi US$ 0,07022 no total. **Extrapolação ilustrativa feita em 23/09** para 96 chamadas com mistura igual de quick/deep: aproximadamente US$ 0,42 e 30 minutos em série. ETH, 4h, variação do modelo ou falhas podem mudar custo e duração. O plano reserva US$ 0,02 por chamada e teto **local estimado** de US$ 1 por braço; isso não é um limite rígido de cobrança da OpenAI. A chave de desenvolvimento foi disponibilizada posteriormente no `.env` local do backend e usada na rodada de 28/09, sem copiar seu valor para este worktree.

## Critérios registrados antes da rodada

1. Contar os 48 pares, inclusive falhas e timeouts. Verificar mesmo hash de gráfico, modo, modelo, esforço e flags por par. Reportar quick/deep e cada símbolo/período separadamente.
2. Para uma imagem única, o candidato não deve apresentar H1/H4/D1 ou fração de alinhamento como leitura verificada. Qualquer ocorrência é erro crítico para esta hipótese. Verificar campo MTF, checklist, resumo, análise técnica e raciocínio; o auditor automático sinaliza casos, e revisores confirmam contexto.
3. Contar checklists completos em que ✅ diverge de `X/7`, direção de stop/TP, WAIT com níveis ativos, JSON inválido, falhas, latência e custo. A candidata só avança para uma amostra mais ampla se não aumentar erros críticos, falhas de resposta ou divergências de checklist frente ao baseline. Queda de WAIT isolada não conta como ganho.
4. Registrar mudança pareada BUY/SELL/WAIT e a fração de casos com plano negociável. Avaliar entradas preenchidas, TP1 antes do stop e casos sem fill pela regra temporal congelada, sem usar o futuro para pontuar a leitura visual. Os dois revisores independentes devem aplicar a [rubrica já congelada](AI_ANALYSIS_EVAL_RUBRIC.md) ao pacote cego; adjudicar divergências antes de abrir a chave A/B.
5. Mesmo que passe neste lote, **não promover à produção** com 48 gráficos só de cripto. Acrescentar forex, metais, índices, capturas reais autorizadas, imagens com HTF adicional e repetições do mesmo prompt; depois comparar também o modo com grounding/contexto de produção e os marcos do PostHog de 23/09 (primeiro WAIT, ao menos um sinal nas três análises grátis, falhas e outcomes maduros).

O runner usa um único arquivo de saída por braço e recusa sobrescrever resultados. No diretório `apps/backend`, o dry-run validado foi equivalente a:

```bash
pnpm exec ts-node scripts/analysis-pilot-runner.ts \
  --prompt-file ../../scripts/backtest/results/active-prompt-v11-2026-09-23.txt \
  --prompt-origin active-snapshot --model-quick gpt-5.6-luna --model-deep gpt-5.6-luna \
  --effort-quick low --effort-deep default --case-offset 0 --max-calls 48 \
  --max-estimated-usd 1 --reserve-per-call-usd 0.02 --out pilot-active-v11-baseline-full48-v2.jsonl

pnpm exec ts-node scripts/analysis-pilot-runner.ts \
  --prompt-file ../../scripts/backtest/results/candidate-active-v11-mtf-evidence-v2-base.txt \
  --prompt-file-deep ../../scripts/backtest/results/candidate-active-v11-mtf-evidence-v2-deep.txt \
  --prompt-origin active-snapshot --model-quick gpt-5.6-luna --model-deep gpt-5.6-luna \
  --effort-quick low --effort-deep default --case-offset 0 --max-calls 48 \
  --max-estimated-usd 1 --reserve-per-call-usd 0.02 --out pilot-active-v11-mtf-v2-full48.jsonl
```

Sem `--execute`, os comandos não gravam resultados nem chamam API. A rodada paga acrescentaria `--execute` a cada comando após a chave estar disponível em ambiente local seguro; nunca colar a chave no comando ou no chat. Nenhuma etapa deste protocolo escreve no banco, envia push ou implanta a plataforma.
