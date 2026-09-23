# Auditoria da análise entregue versus o que a Tickrify anuncia — 23/09/2026

Escopo: leitura do código e textos versionados neste branch isolado. **Não é
uma auditoria de respostas reais nem das flags ativas em produção.** Nenhum
prompt, modelo, flag, banco ou página pública foi alterado nesta etapa.

| Promessa visível na página | O que o código faz hoje | Consequência a medir |
| --- | --- | --- |
| Estrutura, BOS/CHoCH e contexto antes de entrar | O prompt pede esses campos, mas também manda inferir 1H/4H/D1 e escrever alinhamento `2/3` ou `3/3` com **um único gráfico**. Com vários gráficos, o adapter os envia ao modelo. | Uma inferência de swings do gráfico atual pode parecer leitura de timeframes que não foram fornecidos. Contar afirmações HTF sem imagem/fonte correspondente na rubrica cega. |
| Candles reais, RSI e momentum “antes de cada leitura” | O caminho **quick** só tenta buscar candles quando `ENABLE_QUICK_GROUNDING` está ligado; o padrão versionado é `false`, embora uma flag do banco ou ambiente possa ligá-lo em produção. Mesmo ligado, símbolo/período ilegíveis, print antigo, fonte indisponível ou timeout podem impedir a injeção. O caminho **deep** chama enriquecimento de contexto/calendário, não o bloco OHLCV/RSI de `buildRealDataBlock`. | A frase universal da vitrine não é sustentada pelo caminho de código para toda análise. Confirmar estado efetivo da flag, cobertura de fonte por ativo/período e presença de dados por resposta, sem expor imagens/prompts. |
| Guarda do calendário “antes de cada leitura” | `decideSignal` consulta o calendário depois da resposta do modelo, apenas quando ainda há sinal e a flag está ligada. A consulta é best-effort: falha ou timeout não bloqueiam. | A proteção não equivale a calendário confirmado em toda análise. Medir disponibilidade da fonte e casos em que a verificação foi impossível. |
| Entrada, stop, alvo e R:R derivados da estrutura | O prompt solicita níveis; `decideSignal` rebaixa BUY/SELL se o melhor R:R **calculável** for <1,2. Quando não há R:R numérico válido, a guarda não decide por ele. | Rever coerência aritmética, escala e fonte dos níveis em casos reais; não supor que o guard valida todo plano. |
| WAIT explícito e “o que mudaria isso” | O prompt atual exige plano de observação quando um setup está se formando, mas permite `alternativeScenario: null` em mercado lateral sem setup. A interface só exibe o que o motor devolver. | Uma pessoa pode gastar uma análise e receber WAIT sem um próximo critério observável. Medir isso separadamente de % de WAIT e da taxa de sinais. |
| Probabilidade/confiança do setup | O número é estimado pelo modelo e limitado por regras; o prompt diz que representa chance de TP1 antes de SL, mas isso ainda não prova calibração empírica por ativo, modo e faixa de confiança. | Comparar previsão com outcomes maduros e cobertura, sem divulgar confiança como probabilidade validada antes dessa medição. |

As promessas foram lidas nas traduções da landing (`pt.ts`, `en.ts` e demais
idiomas) e o fluxo foi conferido em `ai.adapter.ts`, `signal-decision.ts` e
`feature-flags.ts`. A auditoria aponta divergências **de contrato e de
evidência**, não afirma que determinada resposta de um usuário foi errada.
Não há amostras reais de resposta no piloto para concluir taxa de erro.

## Primeira candidata de análise, sem trocar a ação

O [gerador offline](../scripts/analysis-wait-candidate.mjs) cria uma variante
que modifica **somente a instrução de explicação do HOLD/WAIT**. Para um gráfico
legível, o modelo deve dizer qual evidência falta e uma condição observável
para reavaliar; quando nenhum nível confiável puder ser lido, deve dizer isso
sem inventar entrada ou gatilho numérico. Mantém intactos os limiares 6–7,
4–5 e ≤3 confluências, os itens eliminatórios de estrutura e R:R e todas as
guardas do backend. Logo, ela testa utilidade do WAIT, **não uma estratégia
para emitir mais BUY/SELL**.

O gerador recusa um baseline incompatível e nunca sobrescreve uma candidata
congelada. A primeira saída local foi criada a partir do prompt **versionado**
`trading-system-prompt.ts`: hash SHA-256 do texto base
`00783ace62ae49315d8c33648d834c9475f428f00361c9d08f24cc85540a78bb`;
hash da candidata
`984c28b0a6b48237c6ae286b8f26f96ebc147246a75e835f8756855fbc85c83d`.
Essa base **não foi verificada contra o PromptConfig ativo**. A saída completa
fica no cache ignorado pelo Git em `scripts/backtest/results/`.

```bash
node scripts/analysis-wait-candidate.mjs
node --test scripts/analysis-wait-candidate.test.mjs
```

Para comparar com o sistema atual, primeiro congelar por leitura o prompt
efetivamente ativo, os modelos, esforços de raciocínio e flags; registrar
origem/hash sem publicar segredo. Se o prompt ativo diferir, gerar a candidata
a partir dessa cópia local. Depois, executar **baseline e candidata nos mesmos
gráficos** com um único fator alterado, medir explicações de WAIT na rubrica,
erros críticos, sinais, falhas, latência e custo. Não promover essa variante
com base só no texto do prompt ou em queda de WAIT.

Em uma trilha separada, tratar a promessa de candles e calendário: medir
cobertura real e ajustar capacidade ou texto público conforme o que puder ser
entregue. Ligar grounding ou mudar guards agora alteraria custo, latência e
decisão para usuários pagantes, então requer avaliação e rollout próprios.
