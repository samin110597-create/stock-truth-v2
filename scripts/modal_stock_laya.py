#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import modal

app = modal.App("stock-laya-training")
volume = modal.Volume.from_name("stock-laya-artifacts", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "torch",
        "laya>=0.3.20",
        "transformers>=5.0.0",
        "huggingface_hub>=1.0.0",
        "safetensors",
        "scikit-learn",
        "numpy",
    )
)

def run(cmd, cwd=None, env=None):
    print("+", " ".join(map(str, cmd)), flush=True)
    subprocess.run([str(x) for x in cmd], cwd=str(cwd) if cwd else None, env=env, check=True)

@app.function(
    image=image,
    gpu="A10G",
    cpu=8,
    memory=32768,
    timeout=12 * 60 * 60,
    volumes={"/persist": volume},
)
def train():
    work = Path("/tmp/stock-laya")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)

    repo = work / "repo"
    data = work / "data-snapshots"

    run(["git","clone","--depth","1","https://github.com/samin110597-create/stock-truth-v2.git",repo])
    run(["git","clone","--depth","1","--filter=blob:none","--sparse","--branch","data-snapshots",
         "https://github.com/samin110597-create/stock-truth-v2.git",data])
    run(["git","-C",data,"sparse-checkout","set","raw"])

    repo_data = repo / "data"
    repo_data.mkdir(exist_ok=True)
    raw_dst = repo_data / "raw"
    if raw_dst.exists() or raw_dst.is_symlink():
        if raw_dst.is_dir() and not raw_dst.is_symlink():
            shutil.rmtree(raw_dst)
        else:
            raw_dst.unlink()
    raw_dst.symlink_to(data / "raw", target_is_directory=True)

    run([sys.executable,"scripts/build_laya_stock_dataset.py","--min-cases","500"],cwd=repo)
    run([sys.executable,"scripts/preprocess_stock_laya.py"],cwd=repo)

    from huggingface_hub import snapshot_download
    base = snapshot_download("convaiinnovations/laya")

    persist = Path("/persist")
    out = persist / "stock-laya-qstate"
    checkpoint = persist / "checkpoint_latest"
    evaluation = persist / "stock-laya-evaluation.json"

    start_epoch = 0
    meta = checkpoint / "checkpoint_meta.json"
    if meta.exists():
        try:
            start_epoch = int(json.loads(meta.read_text()).get("epoch",0))
        except Exception:
            start_epoch = 0
    print(f"Persistent checkpoint currently at epoch {start_epoch}/4", flush=True)

    # Run one epoch at a time. After every completed stage, commit the Modal Volume.
    # If the cloud job is interrupted later, the next run resumes here.
    for target_epoch in range(start_epoch + 1, 5):
        env = os.environ.copy()
        env["STOCK_LAYA_FAST"] = "0"
        env["STOCK_LAYA_EPOCHS"] = str(target_epoch)
        env["STOCK_LAYA_LOCAL_CHECKPOINT_DIR"] = str(checkpoint)
        env["STOCK_LAYA_CHECKPOINT_REPO"] = ""
        env["STOCK_LAYA_RESUME_DIR"] = str(persist / "resume")

        print(f"=== TRAINING STAGE {target_epoch}/4 ===", flush=True)
        run([
            sys.executable,
            "scripts/train_stock_laya_ddp.py",
            base,
            out,
            "data/laya/preprocessed",
        ], cwd=repo, env=env)
        volume.commit()
        print(f"=== SAVED STAGE {target_epoch}/4 TO PERSISTENT STORAGE ===", flush=True)

    print("=== FULL UNTOUCHED EVALUATION ===", flush=True)
    run([
        sys.executable,
        "scripts/evaluate_stock_laya.py",
        "--model", out,
        "--test", "data/laya/test.jsonl",
        "--out", evaluation,
        "--device", "cuda",
        "--full-test",
    ], cwd=repo)
    volume.commit()

    report = json.loads(evaluation.read_text())
    promotion = report.get("promotion") or {}
    status = {
        "promotion_passed": bool(promotion.get("passed")),
        "checks": promotion.get("checks"),
        "horizon_checks": promotion.get("horizon_checks"),
        "evaluation_scope": report.get("evaluation_scope"),
        "test": report.get("test"),
    }
    (persist / "latest-status.json").write_text(json.dumps(status, indent=2))
    volume.commit()
    print(json.dumps(status, indent=2), flush=True)
    return status

@app.local_entrypoint()
def main():
    print("Launching Stock-Laya on Modal A10G. The run is resumable.")
    result = train.remote()
    print(json.dumps(result, indent=2))
