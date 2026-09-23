# Linha de base da análise — 23/09/2026

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

O endpoint não publica volume por quick/deep, ativo, período, latência, erros ou custo. O backend emite `[Metrics]` e `[Cost]`, mas não há exportação desses logs neste checkout. Portanto **não há número honesto de gasto médio, custo mensal, p95 ou taxa de falha** nesta linha de base. Os preços na tabela interna do backend são estimativas datadas, não fatura. Logs de custo não têm `analysisId`, logo não se pode atribuir custo a acerto/erro de uma análise individual. Também não há amostra de imagens autorizadas para avaliar qualidade visual das respostas.

O próximo diagnóstico deve separar `UNTRACKABLE` por classe de ativo, símbolo, período, provedor de candles e motivo técnico, em consulta **agregada e somente leitura**. Antes, conferir a cobertura dos campos e não incluir prints, prompts ou dados identificáveis em exportações.

### Mapa de fontes e hipótese verificável

- O caminho **quick** extrai símbolo e timeframe do print. Se não consegue ler o período, não injeta candles; quando consegue, tenta OKX/Binance para cripto e Twelve Data para forex/metais. Candles incompatíveis com o preço visível são retidos para não misturar um print histórico com preço atual. Uma falha de grounding reduz evidência disponível, mas não interrompe a análise.
- O enriquecimento **deep** escolhe contexto por classe de ativo e calendário econômico. Ausência ou degradação da fonte volta como `null`; não equivale a comprovação de que nenhum evento existe. O resultado final não armazena um campo estruturado dizendo quais fontes chegaram ao prompt.
- O avaliador de resultados espera 48 horas, busca candles de 30 minutos e classifica `WAIT` como `ABSTAIN`. Para trades, tenta OKX/Binance em cripto e Twelve Data em forex/metais. **Índices não têm uma fonte de candles no avaliador atual**: passam pelo caminho forex, cujo filtro de símbolos os rejeita. Assim, trades de índices ficam `UNTRACKABLE` pela lógica atual; ainda não sabemos quantos dos 92 são índices. Ausência de chave Twelve Data, símbolo fora do filtro ou indisponibilidade temporária das fontes também podem produzir o mesmo resultado. O registro marca `UNTRACKABLE` de forma definitiva e grava uma razão genérica, sem distinguir essas causas.

Ordem de investigação: (1) contar os 92 por classe de ativo e símbolo normalizado, sempre agregado; (2) verificar se a chave Twelve Data **existe**, sem revelar seu valor, e as taxas de sucesso/falha por fonte; (3) separar falhas permanentes de indisponibilidade temporária; (4) só então decidir entre ampliar cobertura de dados, ajustar o avaliador ou mudar a forma de apresentar a métrica. Não preencher resultados ausentes como LOSS nem somar `UNTRACKABLE` ao denominador de acerto.

Para medir operação, exportar 2–4 semanas de linhas `[Metrics]` e `[Cost]` do serviço de worker para arquivo local fora do Git; executar:

```bash
node scripts/analysis-baseline.mjs --accuracy docs/AI_ANALYSIS_BASELINE_SNAPSHOT_2026-09-23.json --logs /caminho/local/worker.log --out /caminho/local/relatorio.md
node --test scripts/analysis-baseline.test.mjs
```

O script emite apenas agregados; IDs, `userId`, códigos de erro e linhas brutas não aparecem no relatório. Mesmo assim, **o arquivo bruto contém identificadores** e deve ficar fora do repositório. Exports parciais podem terminar em `retry`; logs de custo sobrepostos não podem ser deduplicados. Só após medir custo real e casos visuais autorizados faz sentido orçar e testar mudanças de prompt/modelo.

## Decisão para a próxima etapa

Priorizar cobertura de outcomes e a avaliação cega da leitura de gráficos, usando a [rubrica congelada](AI_ANALYSIS_EVAL_RUBRIC.md). O candidato deve ser medido na mesma amostra do motor atual. Por ora, nenhuma alteração de prompt, modelo, cobrança, fila, API ou produção decorre destes números.
