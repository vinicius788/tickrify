#!/usr/bin/env python3
"""Compare paired pilot signals against the fixed, conservative candle rules.

The future candles are used only for outcome scoring, never passed to the model.
This is an offline diagnostic; historical OHLC cannot establish live fill or P&L.
"""
import argparse
import importlib.util
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "backtest"
RESULTS = ROOT / "results"


def load_evaluator():
    spec = importlib.util.spec_from_file_location("tickrify_backtest_evaluate", ROOT / "evaluate.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rows_from_name(name):
    if Path(name).name != name or not name.endswith(".jsonl"):
        raise ValueError("Provide only a local JSONL filename")
    rows = [json.loads(line) for line in (RESULTS / name).read_text().splitlines() if line.strip()]
    ids = [row.get("id") for row in rows]
    if not rows or None in ids or len(ids) != len(set(ids)):
        raise ValueError(f"Missing or duplicate cases in {name}")
    return {row["id"]: row for row in rows}


def score(row, sample, candles, evaluator):
    if row.get("error"):
        return {"outcome": "ERROR", "r": 0}
    action = row.get("recommendation")
    if action == "WAIT":
        return {"outcome": "WAIT", "r": 0}
    if action not in ("BUY", "SELL"):
        return {"outcome": "INVALID_ACTION", "r": 0}
    entry, stop, tp1, tp2 = (row.get(field) for field in
                              ("entry", "stopLoss", "takeProfit1", "takeProfit2"))
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0
               for x in (entry, stop, tp1)) or not evaluator.valid_levels(action, entry, stop, tp1):
        return {"outcome": "INCOMPLETE", "r": 0}
    window = candles[sample["cutIndex"]:sample["cutIndex"] + evaluator.HORIZON]
    if len(window) != evaluator.HORIZON:
        raise ValueError(f"Future candle window incomplete: {sample['id']}")
    outcome, _, _ = evaluator.evaluate_trade(action, window, entry, stop, tp1, tp2)
    reward_r = abs(tp1 - entry) / abs(entry - stop)
    return {"outcome": outcome, "r": reward_r if outcome == "WIN" else -1 if outcome == "LOSS" else 0}


def summarize(scores):
    counts = Counter(item["outcome"] for item in scores)
    decided = counts["WIN"] + counts["LOSS"]
    signals = sum(counts[key] for key in ("WIN", "LOSS", "TIMEOUT", "NO_FILL", "INCOMPLETE"))
    return {
        "cases": len(scores), "counts": dict(sorted(counts.items())), "signals": signals,
        "decidedTrades": decided,
        "winRateAmongDecided": counts["WIN"] / decided if decided else None,
        "totalR": round(sum(item["r"] for item in scores), 4),
        "meanRPerSignalIncludingNoFill": round(sum(item["r"] for item in scores) / signals, 4) if signals else None,
    }


def compare(baseline_name, candidate_name):
    baseline = rows_from_name(baseline_name)
    candidate = rows_from_name(candidate_name)
    manifest = {case["id"]: case for case in json.loads((ROOT / "pilot-manifest.json").read_text())["cases"]}
    samples = {sample["id"]: sample for sample in json.loads((ROOT / "samples.json").read_text())["samples"]}
    if baseline.keys() != candidate.keys() or baseline.keys() != manifest.keys():
        raise ValueError("The two arms must cover the same frozen manifest")
    evaluator = load_evaluator()
    series = evaluator.load_series()
    scored = {"baseline": defaultdict(list), "candidate": defaultdict(list)}
    transitions = Counter()
    for case_id, case in manifest.items():
        sample = samples[case_id]
        if (case["symbol"], case["interval"], case["cutTimeIso"]) != (
            sample["symbol"], sample["interval"], sample["cutTimeIso"]
        ):
            raise ValueError(f"Manifest/sample mismatch: {case_id}")
        pair = (baseline[case_id], candidate[case_id])
        for row in pair:
            if (row.get("chartSha256") != case["chartSha256"] or
                row.get("analysisType") != case["mode"] or
                row.get("assetClass") != case["assetClass"]):
                raise ValueError(f"Paired input mismatch: {case_id}")
        transitions[(pair[0].get("recommendation") or "ERROR", pair[1].get("recommendation") or "ERROR")] += 1
        candle_window = series[(case["symbol"], case["interval"])]
        for arm, row in zip(("baseline", "candidate"), pair):
            result = score(row, sample, candle_window, evaluator)
            for bucket in ("all", case["mode"], case["assetClass"]):
                scored[arm][bucket].append(result)
    return {
        "scope": "Offline 96-candle historical proxy, conservative same-candle loss; no spread, slippage, or live execution",
        "arms": {arm: {bucket: summarize(items) for bucket, items in groups.items()}
                 for arm, groups in scored.items()},
        "signalTransitions": {f"{a}->{b}": count for (a, b), count in sorted(transitions.items())},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(compare(args.baseline, args.candidate), indent=2))
    except (ValueError, KeyError, FileNotFoundError) as error:
        parser.exit(1, f"Pilot outcome audit failed: {error}\n")
