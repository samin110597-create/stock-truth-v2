#!/usr/bin/env python3
"""Evaluate a Stock-Laya candidate on the untouched chronological test split."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import laya
import numpy as np
from sklearn.metrics import balanced_accuracy_score, brier_score_loss, log_loss


def rows(path):
    with Path(path).open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--test", default="data/laya/test.jsonl")
    ap.add_argument("--out", default="data/laya/candidate-evaluation.json")
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    agent = laya.load(args.model, device=args.device)
    labels = ["BUY", "WAIT", "SELL"]
    y_true, y_pred, probs = [], [], []
    tradeable_true, tradeable_prob = [], []

    for row in rows(args.test):
        state = json.loads(row["state"])
        questions = json.loads(row["questions"])
        gold = json.loads(row["gold"])
        truth_probs = gold["trade_action"]["probabilities"]
        truth = max(labels, key=lambda k: truth_probs.get(k, 0.0))
        result = agent.predict(state, questions)
        action = result["answers"]["trade_action"]
        dist = action.get("probabilities") or {}
        p = np.array([float(dist.get(k, 0.0)) for k in labels], dtype=float)
        if not np.isfinite(p).all() or p.sum() <= 0:
            p = np.full(3, 1 / 3)
        else:
            p /= p.sum()
        y_true.append(labels.index(truth))
        y_pred.append(labels.index(action.get("choice", labels[int(p.argmax())])))
        probs.append(p)

        t = gold["tradeable"]["probabilities"].get("true", 0.5)
        tradeable_true.append(1 if t >= 0.5 else 0)
        tradeable_prob.append(float(result["answers"]["tradeable"].get("noul", 0.5)))

    if not y_true:
        raise SystemExit("No test cases.")
    probs = np.asarray(probs)
    onehot = np.eye(3)[np.asarray(y_true)]
    multiclass_brier = float(np.mean(np.sum((probs - onehot) ** 2, axis=1)))
    base = np.mean(onehot, axis=0)
    base_probs = np.tile(base, (len(y_true), 1))
    base_brier = float(np.mean(np.sum((base_probs - onehot) ** 2, axis=1)))
    brier_skill = 1 - multiclass_brier / base_brier if base_brier > 0 else None

    report = {
        "schema_version": 1,
        "candidate": str(args.model),
        "test_cases": len(y_true),
        "action_balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "action_accuracy": float(np.mean(np.asarray(y_true) == np.asarray(y_pred))),
        "action_log_loss": float(log_loss(y_true, probs, labels=[0, 1, 2])),
        "action_brier": multiclass_brier,
        "base_rate_brier": base_brier,
        "brier_skill": brier_skill,
        "tradeable_brier": float(brier_score_loss(tradeable_true, tradeable_prob)),
        "class_counts": {k: int(sum(v == i for v in y_true)) for i, k in enumerate(labels)},
        "promotion_note": (
            "This is the untouched chronological Stock-Laya test split. Production promotion "
            "still requires the gates in config/laya.json and a comparison against the current "
            "Q-State model on compatible directional cases."
        ),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
