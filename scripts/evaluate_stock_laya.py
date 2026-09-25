#!/usr/bin/env python3
"""Evaluate a Stock-Laya candidate on untouched chronological tests and enforce promotion gates."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import laya
import numpy as np
from sklearn.metrics import balanced_accuracy_score, brier_score_loss, log_loss


LABELS = ["BUY", "WAIT", "SELL"]


def rows(path):
    with Path(path).open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def normalize_action_probs(answer):
    dist = answer.get("probabilities") or {}
    p = np.array([float(dist.get(k, 0.0)) for k in LABELS], dtype=float)
    if not np.isfinite(p).all() or p.sum() <= 0:
        return np.full(3, 1 / 3)
    return p / p.sum()


def period_skill(y_true, probs, periods=3):
    n = len(y_true)
    if n < periods * 10:
        return []
    cuts = np.array_split(np.arange(n), periods)
    out = []
    onehot_all = np.eye(3)[np.asarray(y_true)]
    for i, idx in enumerate(cuts, 1):
        y = np.asarray(y_true)[idx]
        p = np.asarray(probs)[idx]
        oh = onehot_all[idx]
        brier = float(np.mean(np.sum((p - oh) ** 2, axis=1)))
        base = np.mean(oh, axis=0)
        base_brier = float(np.mean(np.sum((np.tile(base, (len(idx), 1)) - oh) ** 2, axis=1)))
        skill = 1 - brier / base_brier if base_brier > 0 else None
        pred = p.argmax(axis=1)
        out.append({
            "period": i,
            "n": int(len(idx)),
            "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
            "brier_skill": skill,
        })
    return out


def evaluate(agent, path):
    y_true, y_pred, probs = [], [], []
    tradeable_true, tradeable_prob = [], []
    symbols, timestamps = [], []

    for row in rows(path):
        state = json.loads(row["state"])
        questions = json.loads(row["questions"])
        gold = json.loads(row["gold"])
        truth_probs = gold["trade_action"]["probabilities"]
        truth = max(LABELS, key=lambda k: truth_probs.get(k, 0.0))
        result = agent.predict(state, questions)
        action = result["answers"]["trade_action"]
        p = normalize_action_probs(action)

        y_true.append(LABELS.index(truth))
        y_pred.append(LABELS.index(action.get("choice", LABELS[int(p.argmax())])))
        probs.append(p)

        t = gold["tradeable"]["probabilities"].get("true", 0.5)
        tradeable_true.append(1 if t >= 0.5 else 0)
        tradeable_prob.append(float(result["answers"]["tradeable"].get("noul", 0.5)))

        meta = row.get("meta") or {}
        symbols.append(meta.get("symbol") or "UNKNOWN")
        timestamps.append(meta.get("timestamp"))

    if not y_true:
        raise SystemExit(f"No test cases in {path}.")

    probs = np.asarray(probs)
    y_arr = np.asarray(y_true)
    onehot = np.eye(3)[y_arr]
    multiclass_brier = float(np.mean(np.sum((probs - onehot) ** 2, axis=1)))
    base = np.mean(onehot, axis=0)
    base_probs = np.tile(base, (len(y_true), 1))
    base_brier = float(np.mean(np.sum((base_probs - onehot) ** 2, axis=1)))
    brier_skill = 1 - multiclass_brier / base_brier if base_brier > 0 else None
    symbol_counts = Counter(symbols)
    max_symbol_share = max(symbol_counts.values()) / len(symbols) if symbols else 1.0

    return {
        "test_cases": len(y_true),
        "action_balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "action_accuracy": float(np.mean(y_arr == np.asarray(y_pred))),
        "action_log_loss": float(log_loss(y_true, probs, labels=[0, 1, 2])),
        "action_brier": multiclass_brier,
        "base_rate_brier": base_brier,
        "brier_skill": brier_skill,
        "tradeable_brier": float(brier_score_loss(tradeable_true, tradeable_prob)),
        "class_counts": {k: int(sum(v == i for v in y_true)) for i, k in enumerate(LABELS)},
        "periods": period_skill(y_true, probs),
        "ticker_count": len(symbol_counts),
        "max_single_ticker_share": max_symbol_share,
        "top_tickers": dict(symbol_counts.most_common(10)),
        "timestamp_min": min((x for x in timestamps if x is not None), default=None),
        "timestamp_max": max((x for x in timestamps if x is not None), default=None),
    }


def promotion(metrics, config):
    gates = config.get("promotion_policy") or {}
    period_rows = metrics.get("periods") or []
    positive_periods = sum(
        1 for row in period_rows
        if row.get("brier_skill") is not None and row["brier_skill"] > 0
    )
    checks = {
        "minimum_test_cases": metrics["test_cases"] >= int(gates.get("minimum_test_cases", 500)),
        "minimum_balanced_accuracy": metrics["action_balanced_accuracy"] >= float(gates.get("minimum_balanced_accuracy", 0.53)),
        "minimum_brier_skill": metrics.get("brier_skill") is not None and metrics["brier_skill"] >= float(gates.get("minimum_brier_skill", 0.02)),
        "positive_multiple_periods": (not gates.get("positive_multiple_periods", True)) or positive_periods >= 2,
        "no_single_ticker_dominance": (not gates.get("no_single_ticker_dominance", True)) or (
            metrics.get("ticker_count", 0) >= 5 and metrics.get("max_single_ticker_share", 1.0) <= 0.20
        ),
    }
    # Current Q-State comparison remains a required manual/automated promotion check until
    # a compatible directional benchmark is available for the exact test rows.
    if gates.get("must_beat_current_qstate", True):
        checks["must_beat_current_qstate"] = False
        qstate_note = "PENDING: compare candidate against current validated Q-State on compatible directional rows."
    else:
        checks["must_beat_current_qstate"] = True
        qstate_note = "Not required by config."
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "positive_periods": positive_periods,
        "qstate_comparison": qstate_note,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--test", default="data/laya/test.jsonl")
    ap.add_argument("--experience-test", default="data/laya/experience_test.jsonl")
    ap.add_argument("--config", default="config/laya.json")
    ap.add_argument("--out", default="data/laya/candidate-evaluation.json")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    agent = laya.load(args.model, device=args.device)
    main_metrics = evaluate(agent, args.test)
    config = json.loads(Path(args.config).read_text())
    promo = promotion(main_metrics, config)

    report = {
        "schema_version": 2,
        "candidate": str(args.model),
        "test": main_metrics,
        "promotion": promo,
        "promotion_note": (
            "Production stays disabled unless every configured gate passes. "
            "The current Q-State comparison is intentionally fail-closed until an exact compatible benchmark is computed."
        ),
    }

    exp_path = Path(args.experience_test)
    if exp_path.exists() and exp_path.stat().st_size:
        report["experience_test"] = evaluate(agent, exp_path)
    else:
        report["experience_test"] = {"test_cases": 0, "status": "INSUFFICIENT RESOLVED ISSUED SETUPS"}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
