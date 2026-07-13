#!/usr/bin/env python3
"""BACKTEST — Etapa C (parte 1): render dos gráficos candlestick.

Para cada amostra em samples.json, renderiza um PNG com os 120 candles
ANTERIORES ao corte — estilo print de TradingView (tema escuro, candles
verde/vermelho, eixo de preço à direita, volume embaixo, rótulo do
ativo/timeframe). ZERO look-ahead: nenhum candle >= cutIndex aparece.

Rodar: python3 scripts/backtest/render.py [--start N] [--end N]
Saída: scripts/backtest/charts/{id}.png + scripts/backtest/manifest.json
(--start/--end permitem renderizar em lotes; o manifest é mesclado.)
"""
import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MaxNLocator

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
CHARTS_DIR = os.path.join(HERE, "charts")
MANIFEST = os.path.join(HERE, "manifest.json")

BG = "#131722"        # fundo TradingView dark
PANEL = "#131722"
GRID = "#1e222d"
TEXT = "#b2b5be"
UP = "#26a69a"
DOWN = "#ef5350"

LOOKBACK = 120


def load_series():
    series = {}
    for f in sorted(os.listdir(DATA_DIR)):
        if f.endswith(".json") and f != "meta.json":
            with open(os.path.join(DATA_DIR, f)) as fh:
                d = json.load(fh)
            default_label = "Binance" if d["symbol"].endswith("USDT") else ""
            series[(d["symbol"], d["interval"])] = {
                "candles": d["candles"],
                "label": d.get("sourceLabel", default_label),
            }
    return series


def fmt_price(v, _pos=None):
    if v >= 1000:
        return f"{v:,.0f}"
    if v >= 10:
        return f"{v:,.2f}"
    return f"{v:.4f}"


def render(sample, data):
    candles = data["candles"]
    i = sample["cutIndex"]
    window = candles[i - LOOKBACK : i]  # estritamente antes do corte
    assert len(window) == LOOKBACK
    assert window[-1][0] < sample["cutTime"], "look-ahead detectado!"

    opens = [c[1] for c in window]
    highs = [c[2] for c in window]
    lows = [c[3] for c in window]
    closes = [c[4] for c in window]
    vols = [c[5] for c in window]
    xs = list(range(LOOKBACK))
    has_vol = max(vols) > 0  # forex/metais spot não têm volume → sem painel

    fig = plt.figure(figsize=(14, 8), dpi=100, facecolor=BG)
    if has_vol:
        gs = fig.add_gridspec(2, 1, height_ratios=[4, 1], hspace=0.04)
        ax = fig.add_subplot(gs[0], facecolor=PANEL)
        axv = fig.add_subplot(gs[1], sharex=ax, facecolor=PANEL)
    else:
        ax = fig.add_subplot(111, facecolor=PANEL)
        axv = None

    for x in xs:
        color = UP if closes[x] >= opens[x] else DOWN
        # pavio
        ax.plot([x, x], [lows[x], highs[x]], color=color, linewidth=0.9, zorder=2)
        # corpo
        body_low = min(opens[x], closes[x])
        body_h = max(abs(closes[x] - opens[x]), (max(highs) - min(lows)) * 1e-4)
        ax.add_patch(
            plt.Rectangle((x - 0.33, body_low), 0.66, body_h, facecolor=color, edgecolor=color, zorder=3)
        )
        if axv is not None:
            axv.add_patch(
                plt.Rectangle((x - 0.33, 0), 0.66, vols[x], facecolor=color, edgecolor="none", alpha=0.45)
            )

    # linha do último preço (como TradingView)
    last = closes[-1]
    last_color = UP if closes[-1] >= opens[-1] else DOWN
    ax.axhline(last, color=last_color, linewidth=0.7, linestyle=(0, (4, 3)), alpha=0.9)
    ax.annotate(
        fmt_price(last),
        xy=(1.001, last),
        xycoords=("axes fraction", "data"),
        fontsize=9,
        color="#ffffff",
        va="center",
        ha="left",
        bbox=dict(boxstyle="round,pad=0.25", fc=last_color, ec="none"),
        annotation_clip=False,
    )

    axes = (ax, axv) if axv is not None else (ax,)
    for a in axes:
        a.set_xlim(-1, LOOKBACK)
        a.grid(True, color=GRID, linewidth=0.6, zorder=0)
        a.tick_params(colors=TEXT, labelsize=9)
        for s in a.spines.values():
            s.set_color(GRID)
        a.yaxis.tick_right()
        a.yaxis.set_label_position("right")

    pad = (max(highs) - min(lows)) * 0.05
    ax.set_ylim(min(lows) - pad, max(highs) + pad)
    ax.yaxis.set_major_formatter(FuncFormatter(fmt_price))
    if axv is not None:
        plt.setp(ax.get_xticklabels(), visible=False)
        axv.set_ylim(0, max(vols) * 1.2)
        axv.yaxis.set_major_locator(MaxNLocator(3))
        axv.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v/1000:.1f}K" if v >= 1000 else f"{v:.0f}"))

    # eixo de tempo: datas dos candles visíveis (nada após o corte)
    tick_idx = list(range(0, LOOKBACK, 20))
    fmt = "%d %b %H:%M" if sample["interval"] != "4h" else "%d %b"
    import datetime as dt

    labels = [
        dt.datetime.utcfromtimestamp(window[t][0] / 1000).strftime(fmt) for t in tick_idx
    ]
    time_ax = axv if axv is not None else ax
    time_ax.set_xticks(tick_idx)
    time_ax.set_xticklabels(labels, color=TEXT, fontsize=8)

    src = f" · {data['label']}" if data.get("label") else ""
    ax.text(
        0.01,
        0.985,
        f"{sample['symbol']} · {sample['interval'].upper()}{src}",
        transform=ax.transAxes,
        fontsize=12,
        color="#d1d4dc",
        va="top",
        fontweight="bold",
        zorder=5,
    )

    out = os.path.join(CHARTS_DIR, f"{sample['id']}.png")
    fig.savefig(out, facecolor=BG, bbox_inches="tight", pad_inches=0.15)
    plt.close(fig)
    return {
        "id": sample["id"],
        "symbol": sample["symbol"],
        "interval": sample["interval"],
        "cutIndex": sample["cutIndex"],
        "cutTime": sample["cutTime"],
        "cutTimeIso": sample["cutTimeIso"],
        "file": os.path.relpath(out, HERE),
        "lastClose": last,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=10**9)
    args = ap.parse_args()

    os.makedirs(CHARTS_DIR, exist_ok=True)
    with open(os.path.join(HERE, "samples.json")) as fh:
        samples = json.load(fh)["samples"]
    series = load_series()

    entries = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as fh:
            entries = {e["id"]: e for e in json.load(fh)["entries"]}

    batch = samples[args.start : args.end]
    for n, s in enumerate(batch):
        entries[s["id"]] = render(s, series[(s["symbol"], s["interval"])])
        if (n + 1) % 25 == 0:
            print(f"{n + 1}/{len(batch)} renderizados")

    ordered = [entries[s["id"]] for s in samples if s["id"] in entries]
    with open(MANIFEST, "w") as fh:
        json.dump({"lookback": LOOKBACK, "entries": ordered}, fh, indent=1)
    print(f"OK: {len(batch)} renderizados nesta rodada · manifest com {len(ordered)} entradas")


if __name__ == "__main__":
    main()
