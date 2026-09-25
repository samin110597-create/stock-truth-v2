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


def rows(path, max_cases=None):
    with Path(path).open(encoding="utf-8") as f:
        all_rows = [json.loads(line) for line in f if line.strip()]
    if max_cases and len(all_rows) > max_cases:
        # Deterministic time-spread untouched sample: preserve the full chronological span
        # instead of taking only the earliest/latest regime.
        idx = np.linspace(0, len(all_rows) - 1, max_cases, dtype=int)
        all_rows = [all_rows[int(i)] for i in idx]
    yield from all_rows


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


def evaluate(agent, path, max_cases=None):
    y_true, y_pred, probs = [], [], []
    tradeable_true, tradeable_prob = [], []
    symbols, timestamps, horizons = [], [], []

    for row in rows(path, max_cases=max_cases):
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
        horizons.append(int(state.get("horizon_bars") or 0))

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

    by_horizon = {}
    for h in sorted(set(horizons)):
        idx = np.asarray([i for i, value in enumerate(horizons) if value == h], dtype=int)
        if not len(idx):
            continue
        hy = y_arr[idx]
        hp = probs[idx]
        hpred = np.asarray(y_pred)[idx]
        hoh = np.eye(3)[hy]
        hbrier = float(np.mean(np.sum((hp - hoh) ** 2, axis=1)))
        hbase = np.mean(hoh, axis=0)
        hbase_brier = float(np.mean(np.sum((np.tile(hbase, (len(idx), 1)) - hoh) ** 2, axis=1)))
        by_horizon[str(h)] = {
            "test_cases": int(len(idx)),
            "balanced_accuracy": float(balanced_accuracy_score(hy, hpred)),
            "accuracy": float(np.mean(hy == hpred)),
            "brier_skill": (1 - hbrier / hbase_brier) if hbase_brier > 0 else None,
            "periods": period_skill(hy.tolist(), hp.tolist()),
        }

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
        "by_horizon": by_horizon,
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
    min_cases = int(gates.get("minimum_test_cases", 500))
    min_ba = float(gates.get("minimum_balanced_accuracy", 0.53))
    min_skill = float(gates.get("minimum_brier_skill", 0.02))
    horizon_checks = {}
    for horizon in ("10", "20"):
        row = (metrics.get("by_horizon") or {}).get(horizon) or {}
        horizon_checks[horizon] = {
            "minimum_test_cases": row.get("test_cases", 0) >= max(200, min_cases // 2),
            "minimum_balanced_accuracy": row.get("balanced_accuracy", 0.0) >= min_ba,
            "minimum_brier_skill": row.get("brier_skill") is not None and row["brier_skill"] >= min_skill,
            "positive_periods": sum(
                1 for p in row.get("periods") or []
                if p.get("brier_skill") is not None and p["brier_skill"] > 0
            ) >= 2,
        }
    checks = {
        "minimum_test_cases": metrics["test_cases"] >= min_cases,
        "minimum_balanced_accuracy": metrics["action_balanced_accuracy"] >= min_ba,
        "minimum_brier_skill": metrics.get("brier_skill") is not None and metrics["brier_skill"] >= min_skill,
        "positive_multiple_periods": (not gates.get("positive_multiple_periods", True)) or positive_periods >= 2,
        "no_single_ticker_dominance": (not gates.get("no_single_ticker_dominance", True)) or (
            metrics.get("ticker_count", 0) >= 5 and metrics.get("max_single_ticker_share", 1.0) <= 0.20
        ),
        "both_live_horizons_pass": all(all(v.values()) for v in horizon_checks.values()),
    }
    # Daily 10/20 Q-State is currently not a promoted compatible baseline. Do not compare
    # this daily Stock-Laya model to the validated 15M tactical model. In that case the
    # exact-pair comparison is explicitly NOT APPLICABLE and stricter absolute + per-horizon
    # gates above remain mandatory. If a validated daily Q-State pair is added later, this
    # evaluator should be extended to enforce the exact-row comparison before promotion.
    qstate_policy = gates.get("qstate_comparison_policy", "exact_pair_if_validated_else_not_applicable")
    checks["qstate_policy_valid"] = qstate_policy == "exact_pair_if_validated_else_not_applicable"
    qstate_note = (
        "NOT APPLICABLE: current Q-State has no promoted daily 10/20 model; "
        "15M tactical Q-State is intentionally not used as a mismatched benchmark."
    )
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "horizon_checks": horizon_checks,
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
    ap.add_argument("--max-test-cases", type=int, default=int(__import__("os").environ.get("STOCK_LAYA_FAST_TEST_CAP", "1500")))
    ap.add_argument("--full-test", action="store_true")
    args = ap.parse_args()

    agent = laya.load(args.model, device=args.device)
    cap = None if args.full_test else args.max_test_cases
    main_metrics = evaluate(agent, args.test, max_cases=cap)
    config = json.loads(Path(args.config).read_text())
    promo = promotion(main_metrics, config)

    report = {
        "schema_version": 2,
        "candidate": str(args.model),
        "evaluation_scope": "FULL_UNTOUCHED_TEST" if cap is None else f"DETERMINISTIC_TIME_SPREAD_UNTOUCHED_SAMPLE_{cap}",
        "full_test_required_before_long_term_promotion": cap is not None,
        "test": main_metrics,
        "promotion": promo,
        "promotion_note": (
            "Production stays disabled unless every configured gate passes, including both live daily horizons. "
            "A Q-State comparison is required only when a promoted model exists for the same daily horizon; the validated 15M tactical model is not treated as a compatible baseline."
        ),
    }

    exp_path = Path(args.experience_test)
    if exp_path.exists() and exp_path.stat().st_size:
        report["experience_test"] = evaluate(agent, exp_path, max_cases=None)
    else:
        report["experience_test"] = {"test_cases": 0, "status": "INSUFFICIENT RESOLVED ISSUED SETUPS"}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
