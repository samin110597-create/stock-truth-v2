#!/usr/bin/env python3
"""Convert chronological Stock-Laya JSONL splits into Laya training tensors.

This mirrors the upstream Laya typed-decisions preprocessing contract but keeps
Stock Truth's calibration split completely separate from gradient training.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer
from huggingface_hub import snapshot_download
from laya.agent import _fix_tokenizer_config
from laya.common import build_sequence, render_options, QTYPES


def load_rows(path: Path):
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def build_item(tok, cfg, state, question, gold):
    qtype = question["type"]
    criteria = question.get("criteria", {})
    if qtype == "choice":
        keys = list(criteria.keys())
        target = [gold["probabilities"].get(k, 0.0) for k in keys]
    elif qtype == "noul":
        target = [
            gold["probabilities"].get("false", 0.5),
            gold["probabilities"].get("true", 0.5),
        ]
    elif qtype == "score":
        n = len(criteria) if isinstance(criteria, list) else 4
        target = [gold["probabilities"].get(str(i), 0.0) for i in range(n)]
    else:
        return None
    total = sum(target)
    if total <= 0:
        return None
    target = [float(v / total) for v in target]
    rendered = {"t": qtype, "ins": question["instructions"], "crit": criteria}
    seq, markers = build_sequence(tok, state, rendered, cfg["max_len"], cfg["head_max_len"])
    expected = len(render_options(rendered))
    if len(markers) != expected:
        return None
    return {
        "ids": seq,
        "markers": markers,
        "qtype": QTYPES[qtype],
        "target": target,
        "label": target.index(max(target)),
    }


def convert(path: Path, tok, cfg):
    items = []
    cases = 0
    for row in load_rows(path):
        state = json.loads(row["state"])
        questions = json.loads(row["questions"])
        gold = json.loads(row["gold"])
        cases += 1
        for qid, q in questions.items():
            if qid not in gold:
                continue
            item = build_item(tok, cfg, state, q, gold[qid])
            if item:
                items.append(item)
    return items, cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-model", default="convaiinnovations/laya")
    ap.add_argument("--dataset-dir", default="data/laya")
    ap.add_argument("--out-dir", default="data/laya/preprocessed")
    args = ap.parse_args()

    model_dir = snapshot_download(args.base_model)
    _fix_tokenizer_config(model_dir)
    tok = AutoTokenizer.from_pretrained(str(Path(model_dir) / "tokenizer"))
    cfg = json.loads((Path(model_dir) / "rl_agent_config.json").read_text())
    cfg["max_len"] = 1024
    cfg["head_max_len"] = 256

    dataset = Path(args.dataset_dir)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    report = {}
    for split in ("train", "calibration"):
        items, cases = convert(dataset / f"{split}.jsonl", tok, cfg)
        if not items:
            raise SystemExit(f"No usable {split} items.")
        torch.save(items, out / f"{split}_items.pt")
        report[split] = {"cases": cases, "decision_items": len(items)}
    (out / "preprocess-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
