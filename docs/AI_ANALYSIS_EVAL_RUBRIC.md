# Rubrica offline para respostas de análise de gráfico

Versão 1, congelada em 23/09/2026 **antes de avaliar um candidato**. Mede qualidade da leitura e do plano; o resultado futuro da operação é avaliado separadamente. Não usar esta rubrica para aprovar promessa de lucro.

## Casos e revisão

Usar gráficos próprios, públicos com licença compatível ou autorizados expressamente para avaliação. Guardar a autorização, origem, data, classe de ativo, quick/deep, período, regime de mercado e hash do arquivo. Não copiar imagens privadas de produção por conveniência. Começar com piloto de 40–60 casos para testar instruções e concordância; depois congelar um conjunto de 100–200 casos, balanceando cripto, forex, metais e índices, quick/deep, tendência/range/volatilidade e imagens difíceis. Esses tamanhos são **metas de coleta**, não afirmação de representatividade estatística.

Para cada caso, preservar exatamente o que a IA recebeu naquele momento: imagem, campos enviados, carimbo de tempo e fontes externas disponíveis. Não usar candles ou notícia posteriores na avaliação da **leitura**. Executar baseline e candidato com as mesmas entradas e configuração documentada. Ocultar o nome da variante para dois revisores; cada um pontua independentemente, registra evidência visível e marca itens não avaliáveis. Resolver divergências por terceira revisão antes de calcular médias. Publicar total de casos, casos excluídos e motivos; não trocar casos depois de ver respostas.

## Pontuação por resposta

Em cada item, **2** = correto e sustentado pela evidência, **1** = parcial/ambíguo sem afirmação falsa importante, **0** = incorreto, inventado ou contraditório. Marcar **N/A** apenas quando a entrada realmente não permite avaliar o item; retirar N/A do denominador. O modelo deve declarar ausência de dados, nunca preencher lacunas por suposição.

| Item | Para receber 2 pontos | Falha típica |
| --- | --- | --- |
| 1. Contexto | Ativo, período e preço identificados corretamente quando visíveis; ausência explicitada quando não visíveis. | Inventar símbolo, timeframe ou preço. |
| 2. Estrutura | Tendência, range, rompimento ou reversão descritos com níveis/trechos verificáveis na imagem. | Afirmar tendência oposta ou indicador inexistente. |
| 3. Evidência e origem | Separa o que a imagem mostra, o que veio de fonte externa datada e o que é hipótese. | Apresentar notícia, volume, candle ou outro período que não recebeu. |
| 4. Cenário e ação | Bullish/Bearish/Neutral coerente com a leitura; Comprar/Vender/Aguardar justificado separadamente. | Tratar WAIT como sinônimo obrigatório de Neutral. |
| 5. Plano | Entrada, stop, alvo e relação risco/retorno coerentes quando propõe trade; se aguarda, explicita gatilho observável. | Stop do lado errado, alvo inalcançável sem explicação ou R:R aritmeticamente falso. |
| 6. Invalidação e risco | Diz o que derruba a tese, limita certeza e evita instrução categórica sem evidência. | Prometer resultado ou omitir invalidação. |
| 7. Clareza | Texto compreensível, específico para o gráfico e sem contradições internas. | Texto genérico, redundante ou que contradiz os próprios níveis. |

Registrar soma obtida e soma possível (`2 × itens avaliáveis`) por resposta. Reportar distribuição, mediana, casos com zero em cada item e diferença **pareada** candidato–baseline. Uma resposta com preço/símbolo inventado, dado externo fabricado ou níveis de trade incoerentes recebe marcador de **erro crítico**, mesmo que a soma seja alta. Registrar também JSON inválido, timeout, latência e custo por variante; uma resposta ausente não desaparece da análise.

## Resultado de mercado em trilha separada

Fixar previamente regra de entrada/fill, TP e SL, desempate intrabar, janela de acompanhamento, fonte/horário dos candles, taxas e slippage quando disponíveis. Reportar WIN, LOSS, NO_FILL, TIMEOUT, ABSTAIN, INCOMPLETE e UNTRACKABLE com denominadores próprios. Calcular `WIN/(WIN+LOSS)` e retorno líquido apenas quando os dados permitem; incluir intervalo de confiança e cobertura de sinais. Não usar o preço futuro para corrigir nota de leitura da imagem. Um modelo que emite mais WAIT pode parecer mais preciso por selecionar menos trades: acompanhar cobertura e abstenção junto do acerto.

## Regra de decisão inicial

Não declarar vitória por poucos exemplos, uma única taxa de acerto ou diferença não pareada. Exigir que o candidato reduza erros críticos e melhore a nota de leitura na mesma amostra, sem piora material de falhas, latência, custo ou cobertura. Os limites numéricos de aceitação e o teto de gasto devem ser registrados **antes** de executar o candidato, quando a linha de base operacional estiver disponível. Qualquer experimento em produção exige etapa separada de rollout pequeno e rollback por flag.
