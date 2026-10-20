#!/usr/bin/env python3
"""Regra do candle do fill no evaluate.py e no analysis-pilot-outcomes.py (20/10/2026).

Mesmos casos do apps/backend/src/__tests__/outcome-sweeper.spec.ts, para as duas
implementacoes darem o mesmo resultado com a mesma regra.
Rodar: python3 -I -B scripts/backtest/test_evaluate_fill_rule.py
"""
import importlib.util
import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


os.environ.pop("BT_FILL_CANDLE_RULE", None)
evaluate = load("tickrify_evaluate_test", HERE / "evaluate.py")
pilot = load("tickrify_pilot_test", HERE.parent / "analysis-pilot-outcomes.py")


def c(high, low):
    return [0, low, high, low, high]


BUY = ("BUY", 100, 95, 110, 120)
SELL = ("SELL", 100, 105, 90, 80)

# Janelas reais de 30m (cache de 12/10/2026), as mesmas do teste TypeScript.
REAL = [
    ("cmugsp1hr0", "BUY", 4285.5, 4279.5, 4298, 4302.5, "WIN", "LOSS",
     [[1790341200000, 4299.15, 4299.48, 4280.09, 4280.42], [1790343000000, 4280.87, 4284.12, 4274.78, 4277.57]]),
    ("cmuh92l5h0", "SELL", 4288.5, 4292.6, 4284.2, 4281.2, "WIN", "LOSS",
     [[1790359200000, 4283.01341, 4290.82252, 4283.003, 4285.54542], [1790361000000, 4286.26215, 4296.27084, 4286.26215, 4294.57788]]),
    ("cmump2m6z0", "BUY", 4150, 4143, 4160, 4168, "WIN", "LOSS",
     [[1790694000000, 4171.49336, 4171.49336, 4149.7414, 4150.21563], [1790695800000, 4151.17771, 4159.56075, 4147.65241, 4158.52228],
      [1790697600000, 4157.94141, 4157.94141, 4150.29765, 4153.91368], [1790699400000, 4153.76045, 4154.91863, 4144.45985, 4144.65905],
      [1790701200000, 4145.12124, 4148.37256, 4144.47809, 4147.17254], [1790703000000, 4147.2573, 4148.86114, 4142.62417, 4143.00197]]),
    ("cmuu81tfs0", "BUY", 85200, 85050, 85600, 85800, "WIN", "LOSS",
     [[1791214200000, 85556.7, 85602.2, 85184.5, 85266.4], [1791216000000, 85267.6, 85325.2, 84979.5, 85138.9]]),
    ("cmusqvk0f0", "BUY", 119.45, 119.15, 119.84, 120.25, "WIN", "LOSS",
     [[1791210600000, 120.28, 120.28, 119.2, 119.52], [1791212400000, 119.51, 119.76, 119.34, 119.69],
      [1791214200000, 119.69, 119.74, 119.24, 119.35], [1791216000000, 119.37, 119.54, 118.95, 119.08]]),
]


def run(plan, window, **kw):
    rec, entry, sl, tp1, tp2 = plan
    return evaluate.evaluate_trade(rec, window, entry, sl, tp1, tp2, **kw)


class EvaluateFillCandleRule(unittest.TestCase):
    def test_cli_default_is_legacy_to_reproduce_old_reports(self):
        self.assertEqual(evaluate.FILL_CANDLE_RULE, "legacy")
        self.assertEqual(evaluate.FILL_CANDLE_RULES, ("legacy", "stop_only"))
        w = [c(111, 99), c(102, 94)]
        self.assertEqual(run(BUY, w), run(BUY, w, fill_candle_rule="legacy"))

    def test_legacy_keeps_tp1_on_the_fill_candle(self):
        self.assertEqual(run(BUY, [c(111, 99), c(102, 94)], fill_candle_rule="legacy")[0], "WIN")
        self.assertEqual(run(BUY, [c(111, 99)], fill_candle_rule="legacy")[0], "WIN")

    def test_stop_only_same_cases_as_typescript(self):
        so = {"fill_candle_rule": "stop_only"}
        self.assertEqual(run(BUY, [c(111, 99), c(102, 94)], **so)[0], "LOSS")
        self.assertEqual(run(BUY, [c(111, 99), c(112, 101)], **so)[0], "WIN")
        self.assertEqual(run(BUY, [c(111, 99), c(104, 98)], **so)[0], "TIMEOUT")
        self.assertEqual(run(BUY, [c(111, 94)], **so)[0], "LOSS")
        self.assertEqual(run(SELL, [c(106, 89)], **so)[0], "LOSS")
        self.assertEqual(run(SELL, [c(101, 89), c(106, 99)], **so)[0], "LOSS")
        self.assertEqual(run(SELL, [c(101, 89), c(99, 88)], **so)[0], "WIN")

    def test_real_windows(self):
        for case_id, rec, entry, sl, tp1, tp2, legacy, stop_only, window in REAL:
            with self.subTest(case=case_id):
                plan = (rec, entry, sl, tp1, tp2)
                self.assertEqual(run(plan, window, fill_candle_rule="legacy")[0], legacy)
                self.assertEqual(run(plan, window, fill_candle_rule="stop_only")[0], stop_only)

    def test_without_fill_both_rules_agree(self):
        w = [c(111, 99), c(102, 94)]
        self.assertEqual(run(BUY, w, require_fill=False, fill_candle_rule="legacy"),
                         run(BUY, w, require_fill=False, fill_candle_rule="stop_only"))

    def test_unknown_rule_is_rejected(self):
        with self.assertRaises(ValueError):
            run(BUY, [c(101, 99)], fill_candle_rule="optimistic")


class PilotOutcomesRule(unittest.TestCase):
    def _sample(self):
        window = [c(111, 99), c(102, 94)] + [c(103, 96)] * (evaluate.HORIZON - 2)
        row = {"recommendation": "BUY", "entry": 100, "stopLoss": 95, "takeProfit1": 110, "takeProfit2": 120}
        return row, {"cutIndex": 0}, window

    def test_score_passes_the_chosen_rule(self):
        row, sample, window = self._sample()
        self.assertEqual(pilot.score(row, sample, window, evaluate, "legacy")["outcome"], "WIN")
        self.assertEqual(pilot.score(row, sample, window, evaluate, "stop_only")["outcome"], "LOSS")

    def test_cli_defaults_to_legacy_and_accepts_only_known_rules(self):
        source = (HERE.parent / "analysis-pilot-outcomes.py").read_text()
        self.assertIn('parser.add_argument("--fill-candle-rule", choices=("legacy", "stop_only"), default="legacy")', source)
        self.assertIn('"fillCandleRule": fill_candle_rule', source)


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    unittest.main(verbosity=2)
