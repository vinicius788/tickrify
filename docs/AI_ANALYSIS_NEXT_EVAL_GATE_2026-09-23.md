# Próxima avaliação da análise — protocolo congelado em 23/09/2026

## Estado da decisão

O branch `codex/analise-cenario-seguro` corrigiu transparência de evidências, checklist inconsistente e probabilidades fabricadas, mas **não demonstrou melhora dos sinais**. O candidato MTF v1 removeu afirmações de H1/H4 sem imagem nos oito casos do piloto, porém mudou um SELL para WAIT e teve mais divergências internas de checklist (4/8 contra 3/8). O sufixo DEEP foi corrigido na candidata v2, que ainda não recebeu chamadas ao modelo. Nenhum prompt candidato foi ativado.

O runner local agora aceita `--prompt-file-deep` além do arquivo quick e registra hashes dos dois arquivos e dos prompts finais efetivamente montados. Isso impede que o quick receba o sufixo deep ou que o deep receba a instrução antiga por engano. Um teste de dry-run reproduz os hashes sem chave, banco, arquivo de resultado ou chamada de API.

## Lote A/B pronto para execução offline

O manifesto validado contém **48 gráficos históricos públicos**, 24 quick e 24 deep, divididos igualmente entre BTCUSDT/ETHUSDT e 30m/4h. A nova variante deep difere da rodada anterior; para comparação limpa, executar os **48 casos novamente em cada braço**, sem combinar respostas da candidata v1 com a v2. Os dois dry-runs passaram com `caseOffset=0`, `maxCalls=48`, hashes de imagem intactos, `gpt-5.6-luna`, esforço quick `low` e deep padrão. Grounding, contexto de mercado e news guard ficam desligados **somente no runner histórico** para não misturar dados atuais com prints antigos; RR guard permanece ligado. Este lote avalia leitura visual e coerência do plano, **não** a experiência completa de produção.

Arquivos congelados: baseline `active-prompt-v11-2026-09-23.txt` (SHA-256 `00783ace62ae49315d8c33648d834c9475f428f00361c9d08f24cc85540a78bb`), candidata quick `candidate-active-v11-mtf-evidence-v2-base.txt` (`43881a9266aa94ceb98511a2b4506062b1b5e89cebbc0176e2decb5a9cef2fd9`) e candidata deep `candidate-active-v11-mtf-evidence-v2-deep.txt` (`706b90c701c2fb7c16804d0faf1d404f77464564d0cf29776b10dba6460a56a6`). Todos ficam em `scripts/backtest/results/`, ignorados pelo Git. O teste automatizado da CLI usa arquivos temporários gerados de fontes versionadas, sem depender desses artefatos locais.

Nos oito pares anteriores, o custo calculado a partir dos tokens retornados foi US$ 0,07022 no total. **Extrapolação ilustrativa** para 96 chamadas com mistura igual de quick/deep: aproximadamente US$ 0,42 e 30 minutos em série. ETH, 4h, variação do modelo ou falhas podem mudar custo e duração. O plano reserva US$ 0,02 por chamada e teto **local estimado** de US$ 1 por braço; isso não é um limite rígido de cobrança da OpenAI. Executar em lotes menores se a primeira chamada custar acima da reserva. `OPENAI_API_KEY` não está configurada neste worktree, então a execução paga não foi feita.

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
