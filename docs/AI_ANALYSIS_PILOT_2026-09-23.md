# Piloto local de avaliação visual — 23/09/2026

Este piloto prepara entradas para comparar a **leitura do gráfico** pelo motor
atual e por uma variante futura. Não executou nenhuma IA, não mediu acerto e
não alterou a plataforma em produção. Todos os candles, PNGs e manifestos
ficaram no cache ignorado pelo Git do worktree isolado.

## Material congelado nesta rodada

- Fonte: candles spot públicos da Binance para BTCUSDT e ETHUSDT, 30m e 4h,
  obtidos em 23/09/2026 com o script existente `fetch-data.mjs`.
- Amostragem histórica existente: seed `20260713`, 150 cortes sorteados, 120
  candles visíveis antes do corte e 96 posteriores reservados para avaliação
  separada de outcome.
- Seleção para o piloto: seed `tickrify-analysis-pilot-v1`; hash determinístico
  do identificador de cada corte, sem examinar o movimento posterior; 12 casos
  por série, 6 quick e 6 deep. Total: **48 gráficos; 24 quick, 24 deep**.
- Cortes entre `2025-10-11T11:00:00Z` e `2026-09-14T03:30:00Z`. O último candle
  mostrado termina antes do corte em todos os 48 casos. Dois gráficos foram
  inspecionados visualmente quanto a rótulo, candles, eixo, volume e legibilidade.
- `samples.json` SHA-256:
  `e5735cb1243f9be49ffd11f7f919c1b738b6e95cc7103ded82a32e9e934686b7`.
  `pilot-selection.json` SHA-256:
  `310b10a518f1d1a93adb8f2e6d69db36164612d510aebfdd770ee48635d58f7c`.
  O manifesto local guarda hash SHA-256 individual de cada fonte e PNG.

Os arquivos locais estão em `scripts/backtest/data/`, `charts/`,
`samples.json`, `pilot-selection.json` e `pilot-manifest.json`. São arquivos de
trabalho, não parte do commit nem material para usuários. Os 48 PNGs ocupam
aproximadamente 1,56 MiB. A reprodução exata exige os dados e versões de
renderização originais; não tratar o hash PNG como independente do ambiente.
O comando `prepare` reutiliza a seleção congelada quando as entradas são
idênticas e recusa substituí-la silenciosamente quando mudam.

## Limites antes de qualquer conclusão

Esta amostra só cobre **cripto**. A fonte pública tentada para ouro e EUR/USD
respondeu HTTP 429 nesta execução; não usamos chave paga nem outro dado
substituto. **Forex, metais e índices estão ausentes**. Os gráficos são
renderizações padronizadas de OHLCV, não capturas reais da interface nem
imagens privadas de usuários; assim, não medem OCR de layouts variados,
indicadores, desenhos ou qualidade de imagens recebidas hoje. BTC e ETH
também compartilham riscos de mercado e fonte; 48 casos não significam 48
observações independentes para inferência de retorno financeiro. As janelas
visíveis de alguns casos podem se sobrepor, apesar do espaçamento mínimo de
24 horas entre cortes da mesma série; a coleta final deverá controlar essa
dependência antes de estimar incerteza estatística.

Ainda não há respostas baseline/candidato, revisão humana nem gastos de API.
Portanto, este piloto não demonstra melhoria, taxa de acerto, economia ou
calibração. Para a rubrica de leitura, avaliadores não verão candles futuros;
o horizonte posterior fica reservado para a trilha de resultado de mercado.

## Reprodução e próxima etapa

No worktree isolado, com Node 18+ e Python com matplotlib:

```bash
node scripts/backtest/fetch-data.mjs
node scripts/backtest/sample.mjs
node scripts/analysis-pilot.mjs prepare 48
python3 scripts/backtest/render.py --selection scripts/backtest/pilot-selection.json
node scripts/analysis-pilot.mjs finalize
node --test scripts/analysis-pilot.test.mjs
```

Na próxima etapa, obter fontes autorizadas e estáveis para forex, metais e
índices e validar um pequeno conjunto de imagens com formatos próximos aos
que a plataforma recebe. Depois, registrar teto de custo e critérios de
aceitação antes de executar o motor atual e uma única variante sobre as
**mesmas entradas**, com respostas cegas para dois revisores segundo a
[rubrica congelada](AI_ANALYSIS_EVAL_RUBRIC.md). A promoção para produção
continua separada e depende de comparação completa e rollback testado.
