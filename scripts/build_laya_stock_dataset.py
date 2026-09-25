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
from collections import Counter
from pathlib import Path

from train_quant_model import FEATURES, block_features, load_blocks

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "laya"

HORIZONS = (5, 10, 20)
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
        "asset_class": "EQUITY",
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
    feature_lookup = {}
    for symbol, timeframe, bars, asset in load_blocks():
        if asset != "EQUITY":
            continue
        parsed = block_features(bars)
        if not parsed:
            continue
        clean_bars, close, highs, lows, _, rows = parsed
        for i, timestamp, x, atr_pct in rows:
            if timeframe == "1D":
                bar = clean_bars[i]
                for key in (timestamp, bar.get("ts"), bar.get("end_ts")):
                    if key:
                        feature_lookup[(symbol, int(key))] = (x, atr_pct)
            for horizon in HORIZONS:
                action = first_barrier_outcome(close, highs, lows, i, horizon, atr_pct)
                if action is None:
                    continue
                case = make_case(symbol, timeframe, asset, timestamp, x, atr_pct, horizon, action)
                case["source"] = "historical_state"
                cases.append(case)
    cases.sort(key=lambda r: (r["timestamp"], r["symbol"], r["timeframe"]))
    return cases, feature_lookup



def terminal_ledger_result(record):
    terminal = {
        "ENTRY EXPIRED",
        "CANCELLED GAP THROUGH STOP",
        "CANCELLED GAP BEYOND ENTRY ZONE",
        "TARGET TESTED BEFORE ENTRY",
        "CANCELLED INVALID FILL",
    }
    for event in reversed(record.get("events") or []):
        result = event.get("result") or {}
        if result.get("complete") or result.get("state") in terminal:
            return result
    return None


def build_experience_cases(feature_lookup):
    path = ROOT / "data" / "ledger.json"
    if not path.exists():
        return []
    try:
        records = (json.loads(path.read_text()) or {}).get("records") or []
    except Exception:
        return []
    out = []
    seen = set()
    for record in records:
        setup = record.get("setup") or {}
        symbol = str(setup.get("symbol") or "").upper()
        signal_ts = setup.get("signal_ts")
        direction = str(setup.get("direction") or "").upper()
        holding = str(setup.get("horizon") or "SWING").upper()
        if not symbol or not signal_ts or direction not in ("LONG", "SHORT"):
            continue
        dedupe = (symbol, int(signal_ts), direction, holding)
        if dedupe in seen:
            continue
        result = terminal_ledger_result(record)
        if not result:
            continue
        label = "WAIT"
        if result.get("entered") and result.get("complete"):
            t1 = ((result.get("targets") or [{}])[0] or {}).get("result")
            if t1 == "TARGET":
                label = "BUY" if direction == "LONG" else "SELL"
            elif t1 not in ("STOP", "TIME EXIT"):
                continue
        lookup = feature_lookup.get((symbol, int(signal_ts)))
        if not lookup:
            continue
        x, atr_pct = lookup
        horizon = 20 if holding == "POSITION" else 10
        case = make_case(symbol, "1D", "EQUITY", int(signal_ts), x, atr_pct, horizon, label)
        case["source"] = "issued_ledger"
        case["issued_direction"] = direction
        case["issued_result"] = result.get("state")
        out.append(case)
        seen.add(dedupe)
    out.sort(key=lambda r: (r["timestamp"], r["symbol"]))
    return out


def split_experience(cases):
    if not cases:
        return {"train": [], "test": []}
    if len(cases) < 10:
        return {"train": cases, "test": []}
    n_test = max(5, int(round(len(cases) * 0.20)))
    n_test = min(n_test, len(cases) - 1)
    return {"train": cases[:-n_test], "test": cases[-n_test:]}


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


def summarize(splits, cuts, experience):
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
        "horizons": list(HORIZONS),
        "experience_replay": {
            "train_cases": len(experience.get("train", [])),
            "test_cases": len(experience.get("test", [])),
            "policy": "Append-only issued setups. Successful TP1 outcomes reinforce the issued direction; stopped, timed-out, cancelled, or expired setups teach WAIT. Experience is kept separate from the chronological base split and capped during training."
        },
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
    cases, feature_lookup = build_cases()
    if len(cases) < args.min_cases:
        raise SystemExit(f"Only {len(cases)} Laya cases available; need at least {args.min_cases}.")
    splits, cuts = split_cases(cases)
    experience = split_experience(build_experience_cases(feature_lookup))
    for name, rows in splits.items():
        write_jsonl(out / f"{name}.jsonl", rows)
    write_jsonl(out / "experience_train.jsonl", experience["train"])
    write_jsonl(out / "experience_test.jsonl", experience["test"])
    report = summarize(splits, cuts, experience)
    (out / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
