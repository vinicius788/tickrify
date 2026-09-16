#!/usr/bin/env bash
# ============================================================================
# TESTE v9 vs v7.3 — roda as duas pernas do backtest e avalia as duas.
#
# Por que este script existe: o teste tem 6 comandos, 3 variáveis de ambiente
# que precisam estar vazias e 2 arquivos de saída. Errar UMA dessas coisas
# invalida o teste inteiro e o dinheiro já foi gasto. Aqui é um comando só, e
# ele checa tudo antes de gastar.
#
#   ./scripts/backtest/rodar-teste-v9.sh piloto     # 10 análises por perna (~US$0,20)
#   ./scripts/backtest/rodar-teste-v9.sh completo   # 75 análises por perna
#   ./scripts/backtest/rodar-teste-v9.sh avaliar    # só gera os relatórios
#
# É retomável: se cair no meio, rode de novo — ele pula o que já foi analisado.
# ============================================================================
set -euo pipefail

MODO="${1:-}"
PERNA="${2:-ambas}"   # ambas | v73 | v9 — para re-rodar só uma perna sem gastar na outra
if [[ "$MODO" != "piloto" && "$MODO" != "completo" && "$MODO" != "avaliar" ]]; then
  echo "Uso: $0 piloto|completo|avaliar [ambas|v73|v9]"
  echo
  echo "  piloto    10 análises por perna — para conferir o custo real antes de gastar"
  echo "  completo  75 análises por perna — o teste de verdade"
  echo "  avaliar   não gasta nada, só gera os relatórios do que já foi rodado"
  echo
  echo "Segundo argumento (opcional): roda só uma perna."
  echo "  $0 piloto v9     # só o prompt novo — use ao re-testar depois de um ajuste"
  echo "  $0 piloto v73    # só o prompt atual"
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$RAIZ/apps/backend"
RESULTADOS="$RAIZ/scripts/backtest/results"

V73="src/common/prompts/trading-system-prompt.ts"
V9="src/common/prompts/trading-system-prompt-v9.ts"
OUT_V73="v73g.jsonl"
OUT_V9="v9g.jsonl"

echo "════════════════════════════════════════════════════════════"
echo " TESTE v9 vs v7.3 — modo: $MODO"
echo "════════════════════════════════════════════════════════════"

# ── Checagens que salvam o teste ────────────────────────────────────────────
if [[ "$MODO" != "avaliar" ]]; then
  if [[ -z "${OPENAI_API_KEY:-}" ]]; then
    echo "✗ OPENAI_API_KEY não está no ambiente."
    echo "  Rode:  export OPENAI_API_KEY=sk-..."
    exit 1
  fi
  echo "✓ Chave da OpenAI presente"

  # O teste PRECISA rodar no gpt-4o-mini: a baseline foi medida nele. Rodar no
  # modelo novo mudaria modelo E prompt ao mesmo tempo — e aí não dá para saber
  # o que causou a diferença.
  for VAR in AI_MODEL AI_MODEL_QUICK AI_MODEL_DEEP; do
    if [[ -n "${!VAR:-}" ]]; then
      echo "✗ $VAR está definida como '${!VAR}'."
      echo "  O teste tem que rodar no gpt-4o-mini (é o modelo da baseline)."
      echo "  Rode:  unset AI_MODEL AI_MODEL_QUICK AI_MODEL_DEEP"
      exit 1
    fi
  done
  echo "✓ Modelo: gpt-4o-mini (padrão, igual à baseline)"

  # Se o grounding do backend estiver ligado, ele injeta um SEGUNDO bloco de
  # dados buscado na internet por cima do bloco do teste. Resultado: lixo.
  if [[ "${ENABLE_QUICK_GROUNDING:-}" == "true" ]]; then
    echo "✗ ENABLE_QUICK_GROUNDING=true — isso injetaria dados em duplicidade."
    echo "  Rode:  unset ENABLE_QUICK_GROUNDING"
    exit 1
  fi
  echo "✓ Grounding: só o do teste (dataset local, determinístico)"

  # Teto de tempo por análise. O padrão do motor é 55s, calibrado para o prompt
  # curto. O v9 é mais longo e no gpt-4o-mini pode passar disso só gerando texto
  # — e um timeout vira "erro", não "resposta ruim", o que contamina o teste.
  # 120s é o máximo que o motor aceita. Vale para as DUAS pernas, para não criar
  # diferença entre elas.
  export AI_ANALYZE_TIMEOUT_MS=120000
  echo "✓ Teto de tempo por análise: 120s (igual nas duas pernas)"

  for P in "$V73" "$V9"; do
    [[ -f "$BACKEND/$P" ]] || { echo "✗ Não achei $P"; exit 1; }
  done
  echo "✓ Os dois prompts no lugar"
fi

# ── Execução ────────────────────────────────────────────────────────────────
if [[ "$MODO" != "avaliar" ]]; then
  if [[ "$MODO" == "piloto" ]]; then
    EXTRA="--limit 10"
    echo
    echo "PILOTO: 10 análises por perna, ~US\$0,20 no total."
    echo "Depois confira o gasto real no painel da OpenAI e multiplique por 7,5"
    echo "para estimar o teste completo."
  else
    EXTRA=""
    echo
    echo "COMPLETO: ~75 análises por perna (150 no total), ~US\$1,50."
    echo "O que o piloto já rodou NÃO será refeito."
  fi

  echo
  read -r -p "Continuar? [s/N] " OK
  [[ "$OK" == "s" || "$OK" == "S" ]] || { echo "Cancelado."; exit 0; }

  cd "$BACKEND"

  if [[ "$PERNA" == "ambas" || "$PERNA" == "v73" ]]; then
    echo
    echo "── PERNA: prompt ATUAL (v7.3) ──────────────────────────────"
    pnpm exec ts-node scripts/backtest-runner.ts \
      --prompt-file "$V73" --ground --every 4 $EXTRA --out "$OUT_V73" --yes
  else
    echo
    echo "(pulando a perna v7.3 — já rodada)"
  fi

  if [[ "$PERNA" == "ambas" || "$PERNA" == "v9" ]]; then
    echo
    echo "── PERNA: prompt NOVO (v9) ─────────────────────────────────"
    pnpm exec ts-node scripts/backtest-runner.ts \
      --prompt-file "$V9" --ground --every 4 $EXTRA --out "$OUT_V9" --yes
  else
    echo
    echo "(pulando a perna v9)"
  fi
fi

# ── Avaliação ───────────────────────────────────────────────────────────────
echo
echo "── Gerando os relatórios ───────────────────────────────────"
cd "$RAIZ"

for PAR in "$OUT_V73:_v73g:v7.3 (atual)" "$OUT_V9:_v9g:v9 (novo)"; do
  ARQ="${PAR%%:*}"; RESTO="${PAR#*:}"; TAG="${RESTO%%:*}"; NOME="${RESTO#*:}"
  if [[ -f "$RESULTADOS/$ARQ" ]]; then
    N=$(grep -c . "$RESULTADOS/$ARQ" || echo 0)
    echo
    echo "▸ $NOME — $N análises"
    BT_RESULTS="$ARQ" BT_TAG="$TAG" python3 scripts/backtest/evaluate.py
  else
    echo "▸ $NOME — ainda não rodou"
  fi
done

echo
echo "════════════════════════════════════════════════════════════"
echo " Pronto. Os relatórios ficaram em:"
echo "   $RESULTADOS/"
echo
echo " Cole os DOIS no chat com o Claude. O que importa, em ordem:"
echo "   1. Calibração (acerto real por faixa de confiança)"
echo "   2. Expectancy em R (hoje: -0,19R)"
echo "   3. R:R médio no TP1 (hoje: 1,19 prometendo 1,5)"
echo "   4. Taxa de no-fill"
echo "   5. Win rate bruto — por último, é o mais barulhento"
echo "════════════════════════════════════════════════════════════"
