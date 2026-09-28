#!/usr/bin/env python3
"""Run the complete Stock-Laya training/evaluation pipeline on Hugging Face Jobs.

This script is intentionally non-interactive:
- rebuilds the current stock-only daily dataset from the data-snapshots branch
- preprocesses it
- downloads the base Laya checkpoint
- resumes from the private checkpoint repo if available
- performs full Stock-Laya fine-tuning
- runs the full untouched chronological evaluation
- uploads the final model only if every promotion gate passes
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

ROOT = Path(__file__).resolve().parents[1]
DATA_REPO = "https://github.com/samin110597-create/stock-truth-v2.git"
BASE_MODEL = "convaiinnovations/laya"
FINAL_REPO = "Smit1105/stock-laya-qstate"
CHECKPOINT_REPO = "Smit1105/stock-laya-qstate-checkpoints"

def run(cmd, cwd=ROOT, env=None):
    print("+", " ".join(map(str, cmd)), flush=True)
    subprocess.run([str(x) for x in cmd], cwd=str(cwd), env=env, check=True)

def main():
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        raise SystemExit("HF_TOKEN secret is required.")

    work = Path(os.environ.get("STOCK_LAYA_WORKDIR", "/tmp/stock-laya-job"))
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)

    snap = work / "stock-truth-data"
    run(["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
         "--branch", "data-snapshots", DATA_REPO, snap])
    run(["git", "-C", snap, "sparse-checkout", "set", "raw"])

    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    raw_dst = data_dir / "raw"
    if raw_dst.is_symlink() or raw_dst.exists():
        if raw_dst.is_symlink() or raw_dst.is_file():
            raw_dst.unlink()
        else:
            shutil.rmtree(raw_dst)
    raw_dst.symlink_to(snap / "raw", target_is_directory=True)
    print("Using historical raw data in place (no duplicate copy).", flush=True)

    run([sys.executable, "scripts/build_laya_stock_dataset.py", "--min-cases", "500"])
    run([sys.executable, "scripts/preprocess_stock_laya.py"])

    base_dir = snapshot_download(BASE_MODEL, token=token)
    out_dir = work / "stock-laya-qstate"

    env = os.environ.copy()
    env["HF_TOKEN"] = token
    env["STOCK_LAYA_CHECKPOINT_REPO"] = CHECKPOINT_REPO
    env["STOCK_LAYA_FAST"] = "0"
    env["STOCK_LAYA_EPOCHS"] = os.environ.get("STOCK_LAYA_EPOCHS", "4")
    env["STOCK_LAYA_RESUME_DIR"] = str(work / "resume")

    run([
        sys.executable,
        "scripts/train_stock_laya_ddp.py",
        base_dir,
        out_dir,
        "data/laya/preprocessed",
    ], env=env)

    report_path = work / "stock-laya-evaluation.json"
    run([
        sys.executable,
        "scripts/evaluate_stock_laya.py",
        "--model", out_dir,
        "--test", "data/laya/test.jsonl",
        "--out", report_path,
        "--device", "cuda",
        "--full-test",
    ], env=env)

    report = json.loads(report_path.read_text())
    promo = report.get("promotion") or {}
    print(json.dumps({
        "promotion_passed": bool(promo.get("passed")),
        "checks": promo.get("checks"),
        "horizon_checks": promo.get("horizon_checks"),
        "test": report.get("test"),
    }, indent=2), flush=True)

    api = HfApi(token=token)
    api.create_repo(CHECKPOINT_REPO, repo_type="model", private=True, exist_ok=True)
    api.upload_file(
        repo_id=CHECKPOINT_REPO,
        repo_type="model",
        path_or_fileobj=str(report_path),
        path_in_repo="latest-evaluation.json",
        commit_message="Latest Stock-Laya full evaluation",
    )

    if promo.get("passed"):
        api.create_repo(FINAL_REPO, repo_type="model", private=True, exist_ok=True)
        api.upload_folder(
            repo_id=FINAL_REPO,
            repo_type="model",
            folder_path=str(out_dir),
            commit_message="Validated Stock-Laya candidate",
        )
        api.upload_file(
            repo_id=FINAL_REPO,
            repo_type="model",
            path_or_fileobj=str(report_path),
            path_in_repo="stock-laya-evaluation.json",
            commit_message="Add promotion evaluation",
        )
        print("PROMOTION PASSED: uploaded", FINAL_REPO, flush=True)
    else:
        print("PROMOTION FAILED: final model was NOT published.", flush=True)

if __name__ == "__main__":
    main()
