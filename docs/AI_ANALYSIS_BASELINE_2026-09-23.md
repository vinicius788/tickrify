# Linha de base da análise — 23/09/2026

O [recorte de ativação e falhas informado a partir do PostHog](AI_ANALYSIS_POSTHOG_BASELINE_2026-09-23.md)
usa outra fonte e outros filtros; suas taxas de WAIT devem ser comparadas
separadamente desta API pública.

Fonte: [endpoint público de acurácia](https://tickrify.onrender.com/api/ai/accuracy), consultado em 23/09/2026. O [snapshot agregado](AI_ANALYSIS_BASELINE_SNAPSHOT_2026-09-23.json) preserva a resposta recebida (`updatedAt`: 2026-09-23T03:20:07.952Z). Não contém dados de usuário ou análises individuais. O endpoint tem cache de uma hora.

## O que os números permitem dizer

| Medida | Retrato | Leitura correta |
| --- | ---: | --- |
| WIN / (WIN + LOSS) | 51 / 123 = **41,5%**; intervalo Wilson 95% **33,1–50,3%** | Apenas operações com desfecho conclusivo. Não mede retorno financeiro. |
| WAIT entre análises concluídas com recomendação | 261 / 542 = **48,2%** | Mede a ação de aguardar, inclusive quando o cenário é direcional. |
| `UNTRACKABLE` | **92** | O outcome não pôde ser acompanhado; investigar fonte de candles/ativo/período antes de atribuir isso ao modelo. |
| `NO_FILL` | **61** | O preço não acionou a entrada; não equivale a erro nem a acerto. |
| `ABSTAIN` | **251** | Resultado do avaliador de outcomes; tem definição e denominador diferentes do contador de ação WAIT. |
| Outros outcomes | 72 LOSS, 51 WIN, 2 INCOMPLETE, 1 TIMEOUT | Os outcomes automáticos somam 530; a contagem de 542 recomendações concluídas é outra consulta. Não combinar denominadores. |

A confiança registrada **não está calibrada de forma demonstrada**: abaixo de 60, 5/10 acertos (50,0%); 60–69, 19/45 (42,2%); 70+, 27/68 (39,7%). Os intervalos são largos e se sobrepõem. Esse retrato sugere investigar confiança e composição dos casos, mas não justifica alterar o score com base nestes percentuais.

Depois da data de grounding, há 12/19 resultados conclusivos (63,2%; IC 41,0–80,9%), contra 39/104 antes (37,5%; IC 28,8–47,1%). As coortes têm períodos e composição diferentes; o grupo recente tem só 19 casos. Isso **não prova** que o grounding causou melhora. A divisão por modelo também é insuficiente: 15 casos conclusivos com `gpt-5.6-luna`, 4 com `gpt-4o` e 104 dos 123 sem modelo registrado nas linhas desse corte. A comparação por prompt tem 0 conclusivos em `v9` e 123 em `current`, então não há comparação A/B de outcome disponível aqui.

## O que ainda falta medir

O endpoint não publica volume por quick/deep, ativo, período, latência, erros ou custo. O backend emite `[Metrics]` e `[Cost]`, mas não há exportação desses logs neste checkout. Os preços na tabela interna do backend são estimativas datadas, não fatura. Logs de custo não têm `analysisId`, logo não se pode atribuir custo a acerto/erro de uma análise individual. Também não há amostra de imagens autorizadas para avaliar qualidade visual das respostas.

### Amostra operacional consultada no Render em 23/09/2026

No painel **tickrify → Logs → Application logs → Last 7 days**, a busca `[Metrics]` exibiu 50 linhas de 20 a 23/09: 49 análises quick concluídas e 1 inválida, todas com identificador de análise distinto. Nas 49 concluídas, latência total p50 **11.354 ms** e p95 **15.054 ms**; tempo de IA p50 **11.293 ms** e p95 **14.986 ms**; espera na fila p50 **4 ms** e p95 **8 ms**. A maior parte do tempo observado ficou na chamada de IA, não na fila.

A busca separada `[Cost]` exibiu 50 chamadas quick com `gpt-5.6-luna`: custo estimado médio **US$ 0,0193**, p95 **US$ 0,0215**, soma das 50 linhas **US$ 0,9671**. Médias aproximadas: 12.340 tokens de entrada, 1.167 de saída (incluindo 171 de raciocínio). Esses logs podem incluir análises demo e não têm `analysisId`; **não correspondem necessariamente às mesmas 50 linhas de `[Metrics]`**.

**Correção da estimativa em 23/09:** esses valores foram calculados pela tabela
local antiga de US$ 1/6 por milhão de tokens para luna. A
[página oficial do GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
agora lista US$ 0,20/1,20 no preço Standard. Aplicar apenas essa correção às
mesmas linhas dá aproximadamente **US$ 0,00386 de média, US$ 0,00430 de p95 e
US$ 0,1934 de soma**. Os números originais acima ficam preservados como
registro do que os logs mostraram; nenhum deles é fatura conferida. Cache,
serviço contratado e outros encargos podem alterar a cobrança efetiva.

Períodos personalizados anteriores também exibiram 50 linhas, indicando limite de resultados por consulta. Estas são **linhas exibidas**, não a semana inteira nem uma amostra aleatória. Não usar 1/50 como taxa de falha real, US$ 0,9671 como gasto semanal ou a margem teórica do log como lucro. Um export completo ou consultas por janelas curtas, sem sobreposição, ainda são necessários para fechar a linha de base de custo e confiabilidade.

O diagnóstico de `UNTRACKABLE` já foi separado por classe de ativo. Ainda faltam provedor, motivo técnico e disponibilidade histórica, que não são registrados de forma estruturada hoje. Novas consultas devem continuar **agregadas e somente leitura**, sem prints, prompts ou dados identificáveis.

### Mapa de fontes e hipótese verificável

- O caminho **quick**, **se `ENABLE_QUICK_GROUNDING` estiver ligado**, extrai símbolo e timeframe do print. Se não consegue ler o período, não injeta candles; quando consegue, tenta OKX/Binance para cripto e Twelve Data para forex/metais. Candles incompatíveis com o preço visível são retidos para não misturar um print histórico com preço atual. Uma falha de grounding reduz evidência disponível, mas não interrompe a análise. A flag vem desligada por padrão no código; seu estado efetivo em produção não foi confirmado nesta auditoria.
- O enriquecimento **deep** escolhe contexto por classe de ativo e calendário econômico. Ausência ou degradação da fonte volta como `null`; não equivale a comprovação de que nenhum evento existe. O resultado final não armazena um campo estruturado dizendo quais fontes chegaram ao prompt.
- O avaliador de resultados espera 48 horas, busca candles de 30 minutos e classifica `WAIT` como `ABSTAIN`. Para trades, tenta OKX/Binance em cripto e Twelve Data em forex/metais. **Índices não têm uma fonte de candles no avaliador atual**: passam pelo caminho forex, cujo filtro de símbolos os rejeita. Sete dos 92 casos históricos são índices. Ausência histórica de chave Twelve Data, símbolo fora do filtro ou indisponibilidade temporária das fontes também podem produzir `UNTRACKABLE`, mas não é possível distinguir essas causas no registro atual. O resultado é marcado de forma definitiva com razão genérica.

Próxima investigação: medir daqui em diante as taxas de sucesso/falha por fonte e distinguir ausência permanente de indisponibilidade temporária. A chave Twelve Data existe atualmente, sem que isso prove sua disponibilidade histórica. Não preencher resultados ausentes como LOSS nem somar `UNTRACKABLE` ao denominador de acerto.

A [consulta de cobertura por classe](../scripts/analysis-outcome-coverage.sql) está preparada com os mesmos filtros do endpoint público. Consultas agregadas equivalentes foram executadas em **transação somente leitura** pelo terminal do serviço no Render, sem retornar IDs, imagens ou respostas individuais. A credencial local continua inválida; isso não impediu a leitura pela conexão já configurada no serviço.

| `UNTRACKABLE` histórico por símbolo normalizado | Casos |
| --- | ---: |
| Metais (`XAU`/`XAG`) | **63** |
| Forex (pares suportados pelo avaliador) | **13** |
| Índices conhecidos | **7** |
| Demais ou sem símbolo reconhecido nessas classes | **9** |
| Total | **92** |

O serviço tem uma chave Twelve Data configurada atualmente; a presença da chave **não demonstra** que ela existia ou funcionava quando os 63 casos históricos de metais foram avaliados. Nos **14 dias anteriores à consulta de 23/09/2026**, houve apenas **1 `UNTRACKABLE`** em todas as classes, e ele era de índice. Para metais nesse mesmo período: 0 `UNTRACKABLE`, 4 `NO_FILL`, 3 `WIN`, 1 `LOSS` e 9 `ABSTAIN`. O problema histórico de metais não aparece nessa janela recente; a lacuna atual comprovada é a ausência de candles de índices no avaliador. Não reclassificar nem recalcular outcomes históricos sem regras e dados que permitam fazê-lo corretamente.

O plano atual do Render permite consultar até **7 dias de logs**. Para montar uma linha de base de 2–4 semanas, coletar agregados por janelas curtas e repetir semanalmente; não há como recuperar semanas anteriores que já saíram da retenção. Se houver exportação das linhas `[Metrics]` e `[Cost]`, guardar o arquivo bruto localmente fora do Git e executar:

```bash
node scripts/analysis-baseline.mjs --accuracy docs/AI_ANALYSIS_BASELINE_SNAPSHOT_2026-09-23.json --logs /caminho/local/worker.log --out /caminho/local/relatorio.md
node --test scripts/analysis-baseline.test.mjs
```

O script emite apenas agregados; IDs, `userId`, códigos de erro e linhas brutas não aparecem no relatório. Mesmo assim, **o arquivo bruto contém identificadores** e deve ficar fora do repositório. Exports parciais podem terminar em `retry`; logs de custo sobrepostos não podem ser deduplicados. Só após medir custo real e casos visuais autorizados faz sentido orçar e testar mudanças de prompt/modelo.

## Decisão para a próxima etapa

Priorizar a **avaliação cega da leitura de gráficos**, usando a [rubrica congelada](AI_ANALYSIS_EVAL_RUBRIC.md), e fechar a linha de base operacional com exportações completas. Documentar a falta de candles para índices; só decidir uma nova fonte após medir volume recente e custo. O candidato deve ser medido na mesma amostra do motor atual. Por ora, nenhuma alteração de prompt, modelo, cobrança, fila, API ou produção decorre destes números.
