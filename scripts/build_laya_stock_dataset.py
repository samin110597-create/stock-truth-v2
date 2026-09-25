#!/usr/bin/env python3
"""Build a Laya-compatible stock decision dataset from Stock Truth's existing Q-State snapshots.

This does not invent a second market model. It reuses the exact causal Q-State feature
builder in scripts/train_quant_model.py, then labels each historical state only from bars
that occur after that state.

Rows match Laya's fine-tuning contract:
  state     JSON string
  questions JSON string
  gold      JSON string with per-option probabilities

The split is chronological, not random, to reduce time-series leakage.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from train_quant_model import FEATURES, block_features, load_blocks

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "laya"

PRIMARY_HORIZON = {"15M": 20, "1H": 10, "4H": 5, "1D": 10}
ACTION_OPTIONS = ("BUY", "WAIT", "SELL")


def finite(x):
    try:
        return math.isfinite(float(x))
    except Exception:
        return False


def soft_choice(label: str, main: float = 0.98):
    rest = (1.0 - main) / (len(ACTION_OPTIONS) - 1)
    return {k: (main if k == label else rest) for k in ACTION_OPTIONS}


def binary_probs(value: bool, main: float = 0.98):
    return {
        "false": 1.0 - main if value else main,
        "true": main if value else 1.0 - main,
    }


def first_barrier_outcome(close, highs, lows, i, horizon, atr_pct):
    """Conservative 1-ATR first-touch label used only after the state timestamp."""
    if not finite(atr_pct) or atr_pct <= 0 or i + horizon >= len(close):
        return None
    upper = close[i] * (1.0 + atr_pct)
    lower = close[i] * (1.0 - atr_pct)
    for j in range(i + 1, i + horizon + 1):
        hit_up = highs[j] >= upper
        hit_down = lows[j] <= lower
        if hit_up and hit_down:
            return "WAIT"  # intrabar order is unknowable from OHLC; never fabricate it
        if hit_up:
            return "BUY"
        if hit_down:
            return "SELL"
    return "WAIT"


def questions_for(horizon):
    return {
        "trade_action": {
            "type": "choice",
            "instructions": (
                f"Choose the best directional action for the next {horizon} bars using only "
                "the supplied causal market state. BUY means the +1 ATR barrier should be "
                "favored before the -1 ATR barrier; SELL means the reverse; WAIT means no "
                "reliable first-touch directional edge or an ambiguous path."
            ),
            "criteria": {
                "BUY": "Favor a long directional setup.",
                "WAIT": "Abstain because the directional edge is weak, unresolved, or ambiguous.",
                "SELL": "Favor a short directional setup.",
            },
        },
        "tradeable": {
            "type": "noul",
            "instructions": (
                f"Is there a directional edge strong enough to prefer BUY or SELL rather than "
                f"WAIT over the next {horizon} bars?"
            ),
            "criteria": {
                "false": "No sufficiently resolved directional edge; abstain.",
                "true": "A directional first-touch edge resolves to BUY or SELL.",
            },
        },
    }


def make_case(symbol, timeframe, asset, timestamp, x, atr_pct, horizon, action):
    feature_values = {
        name: round(float(value), 8)
        for name, value in zip(FEATURES, x)
    }
    state = {
        "schema": "stock-truth-laya-state-v1",
        "symbol": symbol,
        "asset_class": asset,
        "timeframe": timeframe,
        "horizon_bars": horizon,
        "timestamp": int(timestamp),
        "label_definition": "First unambiguous touch of +1 ATR or -1 ATR after the state; otherwise WAIT.",
        "features": feature_values,
    }
    questions = questions_for(horizon)
    gold = {
        "trade_action": {"probabilities": soft_choice(action)},
        "tradeable": {"probabilities": binary_probs(action != "WAIT")},
    }
    return {
        "state": json.dumps(state, separators=(",", ":"), allow_nan=False),
        "questions": json.dumps(questions, separators=(",", ":"), allow_nan=False),
        "gold": json.dumps(gold, separators=(",", ":"), allow_nan=False),
        "symbol": symbol,
        "timeframe": timeframe,
        "timestamp": int(timestamp),
        "target": action,
    }


def build_cases():
    cases = []
    for symbol, timeframe, bars, asset in load_blocks():
        if timeframe not in PRIMARY_HORIZON:
            continue
        parsed = block_features(bars)
        if not parsed:
            continue
        _, close, highs, lows, _, rows = parsed
        horizon = PRIMARY_HORIZON[timeframe]
        for i, timestamp, x, atr_pct in rows:
            action = first_barrier_outcome(close, highs, lows, i, horizon, atr_pct)
            if action is None:
                continue
            cases.append(make_case(symbol, timeframe, asset, timestamp, x, atr_pct, horizon, action))
    cases.sort(key=lambda r: (r["timestamp"], r["symbol"], r["timeframe"]))
    return cases


def split_cases(cases, train_frac=0.70, calib_frac=0.15):
    times = sorted({r["timestamp"] for r in cases})
    if len(times) < 20:
        return {"train": [], "calibration": [], "test": []}, {}
    train_ix = max(1, min(len(times) - 2, int(len(times) * train_frac)))
    calib_ix = max(train_ix + 1, min(len(times) - 1, int(len(times) * (train_frac + calib_frac))))
    train_cut = times[train_ix - 1]
    calib_cut = times[calib_ix - 1]
    out = {"train": [], "calibration": [], "test": []}
    for row in cases:
        if row["timestamp"] <= train_cut:
            out["train"].append(row)
        elif row["timestamp"] <= calib_cut:
            out["calibration"].append(row)
        else:
            out["test"].append(row)
    return out, {"train_through": train_cut, "calibration_through": calib_cut}


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            portable = {k: row[k] for k in ("state", "questions", "gold")}
            f.write(json.dumps(portable, separators=(",", ":"), allow_nan=False) + "\n")


def summarize(splits, cuts):
    action_counts = {}
    symbol_counts = {}
    timeframe_counts = {}
    for name, rows in splits.items():
        action_counts[name] = dict(Counter(r["target"] for r in rows))
        symbol_counts[name] = dict(Counter(r["symbol"] for r in rows).most_common())
        timeframe_counts[name] = dict(Counter(r["timeframe"] for r in rows))
    total = sum(len(v) for v in splits.values())
    return {
        "schema_version": 1,
        "dataset": "stock-truth-laya-v1",
        "cases": total,
        "splits": {k: len(v) for k, v in splits.items()},
        "cutoffs": cuts,
        "action_counts": action_counts,
        "timeframe_counts": timeframe_counts,
        "symbol_counts": symbol_counts,
        "features": list(FEATURES),
        "primary_horizons": PRIMARY_HORIZON,
        "leakage_policy": (
            "State uses Q-State causal features available at timestamp t. "
            "Bars t+1..t+horizon are used only to create the gold outcome."
        ),
        "ambiguity_policy": "If both ATR barriers occur in the same OHLC bar, label WAIT.",
        "calibration_policy": "Calibration and final test are later chronological periods and are not used for gradient updates.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--min-cases", type=int, default=500)
    args = parser.parse_args()
    out = Path(args.out)
    cases = build_cases()
    if len(cases) < args.min_cases:
        raise SystemExit(f"Only {len(cases)} Laya cases available; need at least {args.min_cases}.")
    splits, cuts = split_cases(cases)
    for name, rows in splits.items():
        write_jsonl(out / f"{name}.jsonl", rows)
    report = summarize(splits, cuts)
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
