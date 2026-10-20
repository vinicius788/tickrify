#!/usr/bin/env python3
"""BACKTEST — Etapa D: avaliação + relatório.

REGRAS DE AVALIAÇÃO (fixadas ANTES de rodar as análises — não mudar depois):

Janela: 96 candles após o corte (48h no 30m, 16 dias no 4h).

Fill (regra primária, mais honesta que a ingênua):
  - A posição só "existe" quando o preço TOCA o entry (low<=entry<=high de
    algum candle da janela). Sem toque → NO_FILL (não conta no win rate;
    taxa reportada à parte).
  - A corrida TP×SL começa no candle do fill (inclusive).

BUY (SELL espelhado):
  - WIN   = high>=TP1 antes de low<=SL
  - LOSS  = low<=SL antes de TP1
  - mesmo candle toca TP1 e SL → LOSS (convenção conservadora, sempre contra nós)
  - candle do fill toca SL → LOSS (conservador); toca só TP1 → WIN
  - TIMEOUT = fill aconteceu mas nem TP1 nem SL até o fim da janela

Variante ingênua (secundária, só para transparência): ignora o fill e corre
TP×SL direto do 1º candle pós-corte. Tende a SUPERESTIMAR o win rate.

WAIT → abstenção (fora do win rate; taxa própria).
BUY/SELL sem entry/SL/TP1 numéricos ou com níveis incoerentes
(BUY exige SL < entry < TP1; SELL o espelho) → "incompleta" (taxa própria).

Win rate primário = WIN / (WIN + LOSS). Também reportamos WIN/(WIN+LOSS+TIMEOUT).
Expectancy em R: WIN → +R:R do TP1 (calculado dos níveis), LOSS → −1,
TIMEOUT → 0 (aprox. conservadora; sem custos de spread/slippage).

Adendo de 20/10/2026 (regras acima intactas): `fill_candle_rule` explicito em
evaluate_trade(). "legacy" e a regra acima (candle do fill que toca so o TP1 =
WIN) e continua o padrao, para reproduzir os relatorios ja gerados. "stop_only"
(a regra do sweeper a partir do deploy desta correcao): no candle do fill so o SL conta; o TP1
so a partir do candle seguinte. Nenhuma das duas revela a ordem dentro do
candle; stop_only e a leitura pessimista. Sem fill (require_fill=False) nao ha
candle do fill e as duas regras dao o mesmo resultado. O CLI le
BT_FILL_CANDLE_RULE (padrao legacy) e grava a regra no relatorio e no CSV.

Rodar: python3 scripts/backtest/evaluate.py
Saídas: Tickrify_Backtest_Report.md e Tickrify_Backtest_Results.csv (raiz do repo).
"""
import csv
import json
import math
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("BT_OUT") or os.path.abspath(os.path.join(HERE, "..", ".."))
DATA_DIR = os.path.join(HERE, "data")
# BT_RESULTS = nome do jsonl em results/ · BT_TAG = sufixo dos arquivos de saída
RESULTS = os.path.join(HERE, "results", os.environ.get("BT_RESULTS", "analyses.jsonl"))
TAG = os.environ.get("BT_TAG", "")
REPORT = os.path.join(ROOT, f"Tickrify_Backtest_Report{TAG}.md")
CSV_OUT = os.path.join(ROOT, f"Tickrify_Backtest_Results{TAG}.csv")

HORIZON = 96
FILL_CANDLE_RULES = ("legacy", "stop_only")
FILL_CANDLE_RULE = os.environ.get("BT_FILL_CANDLE_RULE", "legacy")
if FILL_CANDLE_RULE not in FILL_CANDLE_RULES:
    raise SystemExit(f"BT_FILL_CANDLE_RULE invalido: {FILL_CANDLE_RULE} (use legacy ou stop_only)")


def wilson(wins, n, z=1.96):
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = wins / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = (z / d) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (p, max(0.0, c - h), min(1.0, c + h))


def load_series():
    series = {}
    for f in sorted(os.listdir(DATA_DIR)):
        if f.endswith(".json") and f != "meta.json":
            with open(os.path.join(DATA_DIR, f)) as fh:
                d = json.load(fh)
            series[(d["symbol"], d["interval"])] = d["candles"]
    return series


def touches(candle, price):
    return candle[3] <= price <= candle[2]  # low <= p <= high


def evaluate_trade(rec, window, entry, sl, tp1, tp2, require_fill=True, fill_candle_rule="legacy"):
    """Retorna (outcome, fill_idx, tp2_hit). outcome ∈ WIN/LOSS/TIMEOUT/NO_FILL.

    fill_candle_rule: "legacy" (TP1 vale no candle do fill) ou "stop_only"
    (no candle do fill so o SL conta). Igual ao evaluateTrade() do
    apps/backend/worker/outcome.sweeper.ts com a mesma regra.
    """
    if fill_candle_rule not in FILL_CANDLE_RULES:
        raise ValueError(f"fill_candle_rule invalido: {fill_candle_rule}")
    is_buy = rec == "BUY"

    def sl_hit(c):
        return (c[3] <= sl) if is_buy else (c[2] >= sl)

    def tp_hit(c, tp):
        return (c[2] >= tp) if is_buy else (c[3] <= tp)

    start = None
    if require_fill:
        for idx, c in enumerate(window):
            if touches(c, entry):
                start = idx
                break
        if start is None:
            return ("NO_FILL", None, False)
    else:
        start = 0

    outcome = "TIMEOUT"
    resolved_at = None
    for idx in range(start, len(window)):
        c = window[idx]
        s, t = sl_hit(c), tp_hit(c, tp1)
        if s:  # SL tocado — mesmo candle com TP = LOSS (conservador)
            outcome = "LOSS"
            resolved_at = idx
            break
        if t and (fill_candle_rule == "legacy" or not require_fill or idx > start):
            outcome = "WIN"
            resolved_at = idx
            break

    tp2_hit = False
    if outcome == "WIN" and tp2 is not None:
        for idx in range(resolved_at, len(window)):
            c = window[idx]
            if sl_hit(c):
                break
            if tp_hit(c, tp2):
                tp2_hit = True
                break
    return (outcome, start, tp2_hit)


def valid_levels(rec, entry, sl, tp1):
    if entry is None or sl is None or tp1 is None:
        return False
    if rec == "BUY":
        return sl < entry < tp1
    return tp1 < entry < sl  # SELL


def band(conf):
    if conf is None:
        return "n/a"
    if conf < 50:
        return "<50"
    if conf < 60:
        return "50-60"
    if conf < 70:
        return "60-70"
    if conf < 80:
        return "70-80"
    return "80+"


def pct(x):
    return f"{100 * x:.1f}%"


def wr_line(wins, losses, timeouts=None):
    n = wins + losses
    p, lo, hi = wilson(wins, n)
    s = f"{pct(p)} (IC95% {pct(lo)}–{pct(hi)}, n={n})"
    if timeouts is not None:
        n2 = n + timeouts
        if n2 > 0:
            s += f" · incl. timeouts: {pct(wins / n2)} (n={n2})"
    return s


def main():
    series = load_series()
    rows = []
    with open(RESULTS) as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))

    # dedup por id (mantém a última linha — caso de retry manual)
    rows = list({r["id"]: r for r in rows}.values())

    # só IDs da amostra oficial (samples.json) — análises fora dela (ex.: piloto
    # rodado antes de um ajuste de metas) ficam de fora do relatório
    with open(os.path.join(HERE, "samples.json")) as fh:
        official = {s["id"] for s in json.load(fh)["samples"]}
    dropped = [r["id"] for r in rows if r["id"] not in official]
    rows = [r for r in rows if r["id"] in official]
    if dropped:
        print(f"nota: {len(dropped)} análise(s) fora da amostra oficial ignoradas: {', '.join(dropped[:5])}...")

    evaluated = []
    counts = defaultdict(int)
    for r in rows:
        counts["total"] += 1
        if r.get("error"):
            counts["error"] += 1
            r["outcome"] = f"ERROR:{r['error']}"
            evaluated.append(r)
            continue
        rec = r["recommendation"]
        if rec == "WAIT":
            counts["wait"] += 1
            r["outcome"] = "WAIT"
            evaluated.append(r)
            continue
        entry, sl, tp1, tp2 = r.get("entry"), r.get("stopLoss"), r.get("takeProfit1"), r.get("takeProfit2")
        if not valid_levels(rec, entry, sl, tp1):
            counts["incomplete"] += 1
            r["outcome"] = "INCOMPLETE"
            evaluated.append(r)
            continue

        candles = series[(r["symbol"], r["interval"])]
        i = r["cutIndex"]
        window = candles[i : i + HORIZON]
        outcome, fill_idx, tp2_hit = evaluate_trade(rec, window, entry, sl, tp1, tp2,
                                                    fill_candle_rule=FILL_CANDLE_RULE)
        naive_outcome, _, _ = evaluate_trade(rec, window, entry, sl, tp1, tp2, require_fill=False,
                                             fill_candle_rule=FILL_CANDLE_RULE)
        rr = r.get("riskRewardTp1")
        if rr is None:
            risk = abs(entry - sl)
            rr = abs(tp1 - entry) / risk if risk > 0 else None
        r.update(
            outcome=outcome,
            naiveOutcome=naive_outcome,
            fillIdx=fill_idx,
            tp2Hit=tp2_hit,
            rrTp1=rr,
            fillCandleRule=FILL_CANDLE_RULE,
        )
        counts[outcome.lower()] += 1
        evaluated.append(r)

    trades = [r for r in evaluated if r["outcome"] in ("WIN", "LOSS", "TIMEOUT", "NO_FILL")]
    decided = [r for r in trades if r["outcome"] in ("WIN", "LOSS")]

    def tally(rs):
        w = sum(1 for r in rs if r["outcome"] == "WIN")
        l = sum(1 for r in rs if r["outcome"] == "LOSS")
        t = sum(1 for r in rs if r["outcome"] == "TIMEOUT")
        return w, l, t

    # ---- Relatório -----------------------------------------------------
    L = []
    L.append("# Tickrify — Backtest Estatístico do Motor de Análise (quick)\n")
    src_lines = []
    for f in sorted(os.listdir(DATA_DIR)):
        if f.endswith(".json") and f != "meta.json":
            with open(os.path.join(DATA_DIR, f)) as fh:
                d = json.load(fh)
            n_days = d.get("rangeDays", 365)
            src = d.get("source", "Binance spot /api/v3/klines")
            src_lines.append(f"- {d['symbol']} {d['interval']}: {len(d['candles'])} candles, ~{n_days} dias — {src}")
    model = rows[0].get("model", "?") if rows else "?"
    L.append(
        f"**Modelo:** {model}. **Amostragem:** cega, seed fixa (20260713), gap mínimo de 24h por série. "
        f"**Análises:** {counts['total']} ({counts['error']} com erro de API).\n\n**Dados:**\n"
        + "\n".join(src_lines) + "\n"
    )
    L.append(
        "> Número interno de produto. NÃO usar em marketing sem decisão explícita "
        "+ metodologia + disclaimer (past performance ≠ future results).\n"
    )

    L.append(f"Regra do candle do fill: `{FILL_CANDLE_RULE}` (ver adendo de 20/10/2026 no evaluate.py).\n")
    L.append("## 1. Win rate geral (TP1 antes do SL, com exigência de fill)\n")
    w, l, t = tally(trades)
    nf = sum(1 for r in trades if r["outcome"] == "NO_FILL")
    L.append(f"- **Win rate: {wr_line(w, l, t)}**")
    L.append(f"- Timeouts (sem TP nem SL na janela): {t} · No-fill (entry nunca tocado): {nf}")
    nw, nl, nt = 0, 0, 0
    for r in trades:
        if r.get("naiveOutcome") == "WIN":
            nw += 1
        elif r.get("naiveOutcome") == "LOSS":
            nl += 1
        elif r.get("naiveOutcome") == "TIMEOUT":
            nt += 1
    L.append(f"- Variante ingênua (sem exigir fill — só transparência): {wr_line(nw, nl, nt)}\n")

    L.append("## 2. Por ativo, timeframe e direção\n")
    L.append("| Recorte | Win rate (IC95%) | W/L/TO/NF |")
    L.append("|---|---|---|")
    def cut_rows(key):
        groups = defaultdict(list)
        for r in trades:
            groups[key(r)].append(r)
        for g in sorted(groups):
            rs = groups[g]
            w, l, t = tally(rs)
            nf = sum(1 for r in rs if r["outcome"] == "NO_FILL")
            L.append(f"| {g} | {wr_line(w, l)} | {w}/{l}/{t}/{nf} |")
    cut_rows(lambda r: r["symbol"])
    cut_rows(lambda r: r["interval"])
    cut_rows(lambda r: r["recommendation"])
    cut_rows(lambda r: f"{r['symbol']} {r['interval']}")
    L.append("")

    L.append("## 3. Curva de calibração (a métrica mais importante pro produto)\n")
    L.append("Win rate real por faixa de confiança declarada. Calibração perfeita = "
             "win rate ≈ confiança. Acima = motor subconfiante; abaixo = superconfiante.\n")
    L.append("| Confiança declarada | Win rate real (IC95%) | n decididos | WAIT na faixa |")
    L.append("|---|---|---|---|")
    bands_order = ["<50", "50-60", "60-70", "70-80", "80+"]
    waits_by_band = defaultdict(int)
    for r in evaluated:
        if r["outcome"] == "WAIT":
            waits_by_band[band(r.get("confidence"))] += 1
    for b in bands_order:
        rs = [r for r in decided if band(r.get("confidence")) == b]
        w = sum(1 for r in rs if r["outcome"] == "WIN")
        n = len(rs)
        cell = wr_line(w, n - w) if n else "—"
        L.append(f"| {b} | {cell} | {n} | {waits_by_band.get(b, 0)} |")
    L.append("")

    L.append("## 4. Expectancy em R\n")
    rs_with_rr = [r for r in decided + [x for x in trades if x['outcome']=='TIMEOUT'] if r.get("rrTp1")]
    if rs_with_rr:
        total_r = 0.0
        for r in rs_with_rr:
            if r["outcome"] == "WIN":
                total_r += r["rrTp1"]
            elif r["outcome"] == "LOSS":
                total_r -= 1.0
        exp_all = total_r / len(rs_with_rr)
        dec = [r for r in rs_with_rr if r["outcome"] != "TIMEOUT"]
        exp_dec = (sum(r["rrTp1"] for r in dec if r["outcome"] == "WIN") - sum(1 for r in dec if r["outcome"] == "LOSS")) / len(dec) if dec else 0
        avg_rr = sum(r["rrTp1"] for r in rs_with_rr) / len(rs_with_rr)
        tp2n = sum(1 for r in rs_with_rr if r.get("tp2Hit"))
        L.append(f"- Expectancy média: **{exp_dec:+.2f}R por trade decidido** ({exp_all:+.2f}R incluindo timeouts como 0R)")
        L.append(f"- R:R médio proposto no TP1: {avg_rr:.2f} · TP2 também atingido em {tp2n} wins")
        L.append("- Saída considerada: 100% no TP1 (conservador — produção sugere parciais TP1/TP2)\n")

    L.append("## 5. Abstenção e completude\n")
    n_total_ok = counts["total"] - counts["error"]
    if n_total_ok:
        L.append(f"- Taxa de WAIT (abstenção): {pct(counts['wait'] / n_total_ok)} ({counts['wait']}/{n_total_ok})")
        L.append(f"- Análises incompletas (sem níveis coerentes): {pct(counts['incomplete'] / n_total_ok)} ({counts['incomplete']}/{n_total_ok})")
        L.append(f"- Erros de API: {counts['error']}\n")

    L.append("## 6. Limitações (leitura obrigatória antes de citar qualquer número)\n")
    L.append(
        "1. **Gráfico renderizado ≠ print real de usuário.** Os candles são reais, mas o visual "
        "(matplotlib estilo TradingView) difere de screenshots reais — sem indicadores, "
        "sem desenhos do trader, resolução uniforme.\n"
        "2. **Cobertura desigual entre ativos.** Cripto (BTC/ETH): 12 meses em 30m e 4h via "
        "Binance. XAUUSD/EURUSD vieram da Twelve Data: o 30m só cobre os últimos ~60 dias "
        "(limite da janela usada), o 4h cobre 12 meses. Amostras de XAU/EUR em 30m são "
        "pequenas (menos poder estatístico) e os gráficos de FX/metais não têm volume. "
        "Resultados não generalizam para índices nem para outros regimes de mercado.\n"
        "3. **Sem custos:** spread, slippage, funding e taxas não entram — o resultado real de "
        "um trader seria pior.\n"
        "4. **News guard desligado** no backtest (ele consulta o calendário econômico de HOJE; "
        "aplicá-lo a gráficos históricos contaminaria a amostra). Em produção ele só rebaixa "
        "sinais para WAIT — ou seja, produção tende a ser igual ou mais conservadora.\n"
        "5. **Fill simplificado:** toque no entry = executado (sem fila de book, sem parcial). "
        "Timeout tratado como 0R.\n"
        "6. **Uma chamada por gráfico** com temperatura baixa e seed — variação entre execuções "
        "existe, mas é pequena por design.\n"
        "7. O período testado é posterior ao corte de treino do modelo, minimizando (não "
        "eliminando) risco de memorização de preços.\n"
    )

    with open(REPORT, "w") as fh:
        fh.write("\n".join(L))

    # ---- CSV ------------------------------------------------------------
    cols = [
        "id", "symbol", "interval", "cutTimeIso", "recommendation", "confidence",
        "rawRecommendation", "rawConfidence", "entry", "stopLoss", "takeProfit1",
        "takeProfit2", "rrTp1", "outcome", "naiveOutcome", "fillIdx", "tp2Hit", "fillCandleRule",
        "factorsPresent", "trendStrength", "marketRegime", "symbolRead",
        "timeframeRead", "currentPriceRead", "lastClose", "durationMs", "error",
    ]
    with open(CSV_OUT, "w", newline="") as fh:
        wtr = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        wtr.writeheader()
        for r in sorted(evaluated, key=lambda x: x["id"]):
            wtr.writerow({c: r.get(c) for c in cols})

    print(f"Relatório: {REPORT}")
    print(f"CSV: {CSV_OUT}")
    w, l, t = tally(trades)
    print(f"\nResumo: WIN {w} · LOSS {l} · TIMEOUT {t} · NO_FILL {nf} · WAIT {counts['wait']} · incompletas {counts['incomplete']} · erros {counts['error']}")
    if w + l:
        p, lo, hi = wilson(w, w + l)
        print(f"Win rate: {pct(p)} (IC95% {pct(lo)}–{pct(hi)})")


if __name__ == "__main__":
    main()
