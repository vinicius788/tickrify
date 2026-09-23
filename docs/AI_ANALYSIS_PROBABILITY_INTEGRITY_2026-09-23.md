# Integridade das probabilidades da análise — 23/09/2026

## Achado verificável

O prompt ativo v11 define `probabilityTp1` como chance de TP1 antes do stop, `probabilityTp2` como chance de TP2 antes do stop e `probabilityStop` como chance do stop antes de TP1. Ele também manda **somar os três a aproximadamente 100%**, embora TP2 esteja contido em TP1. Essa soma de três eventos não é uma distribuição de resultados exclusivos. Falta ainda um horizonte temporal explícito.

Nos oito gráficos públicos BTCUSDT 30m do piloto MTF, cinco respostas propuseram BUY/SELL. Seus trios TP1/TP2/Stop foram `58/43/42`, `64/50/36`, `58/20/42`, `59/40/41` e `61/44/39`: todos têm TP2 ≤ TP1 e TP1 + Stop = 100, mas a soma dos três fica entre 120 e 150. Esses exemplos ilustram a contradição do prompt, não demonstram calibração ou acerto das probabilidades. A amostra é pequena, só cripto e contém duas variantes sobre os mesmos gráficos.

Além disso, `normalizeTargetProbabilities` criava um trio a partir da confiança quando o modelo omitia algum campo (`TP1≈0,85×confiança`, `Stop=100−TP1`, `TP2≈0,55×TP1`). Esses números não vinham do modelo nem de uma taxa histórica medida. Esse fallback corria tanto no adapter quanto no worker. A interface de análises antigas podia ainda mostrar trios incompletos ou impossíveis armazenados antes de qualquer correção.

## Mudança preparada no branch isolado

- O normalizador compartilhado só preserva um trio completo com valores válidos, TP2 ≤ TP1 e TP1 + Stop ≤ 101 (um ponto de tolerância para arredondamento). Falta, zero ou contradição tornam os três campos `null`. Ele não deriva porcentagens da confiança.
- Adapter e worker usam a mesma regra. A mudança atinge apenas os campos exibidos como estimativas, **não** BUY/SELL/WAIT, confiança, entrada, stop ou alvos.
- A interface também valida o trio ao ler análises antigas. Sem plano completo ou sem trio válido, oculta a seção. Com trio válido, informa que os valores são estimativas da IA, não taxas históricas medidas.
- O prompt ativo e o banco de produção permanecem como estavam. O gerador offline `scripts/analysis-probability-candidate.mjs` criou uma variante independente do MTF a partir do snapshot v11: define o horizonte de 96 candles do período de execução após entrada válida, esclarece que TP2 está dentro de TP1, deixa o restante de TP1 + Stop como “nenhum nível atingido” no horizonte e proíbe inventar campos ausentes. SHA-256 da candidata: `7acf8b5195221c52ccd8178ff3129616945c54325dbbd67cb5f8d46e6b94da20`.

```bash
node scripts/analysis-probability-candidate.mjs \
  --baseline-file scripts/backtest/results/active-prompt-v11-2026-09-23.txt \
  --out scripts/backtest/results/candidate-active-v11-probability-v1.txt
node --test scripts/analysis-probability-candidate.test.mjs
```

O arquivo gerado é local e ignorado pelo Git. O gerador recusa sobrescrevê-lo; uma nova rodada precisa de outro nome. Não houve chamada de API para essa candidata e seu horizonte de 96 candles **não foi avaliado no modelo**. Uma estimativa pode ser completa e aritmeticamente possível sem ser bem calibrada: validar isso requer acompanhar outcomes com janela, fonte, fill, taxas e desfechos inconclusivos predefinidos. O rótulo atual não deve ser lido como taxa histórica até existir essa medição.

Validação local: TypeScript backend/frontend sem erros; 35 suítes/311 testes do backend, 12 suítes/80 testes do frontend, build Vite e os testes do gerador passaram. Essa verificação cobre comportamento de código e apresentação, não qualidade preditiva. Nenhuma migração, push, deploy ou alteração de configuração de produção foi executada.
