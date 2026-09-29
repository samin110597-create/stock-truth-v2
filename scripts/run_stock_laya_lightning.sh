#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PERSIST="/teamspace/studios/this_studio/stock-laya-persist"
DATA_REPO="$PERSIST/data-snapshots"
CHECKPOINT="$PERSIST/checkpoint_latest"
OUT="$PERSIST/stock-laya-qstate"
EVAL="$PERSIST/stock-laya-evaluation.json"

mkdir -p "$PERSIST"

echo "== Stock-Laya Lightning runner =="
echo "Persistent folder: $PERSIST"
python - <<'PY'
import torch
print("CUDA:", torch.cuda.is_available(), "GPUs:", torch.cuda.device_count())
if torch.cuda.is_available():
    for i in range(torch.cuda.device_count()):
        print(i, torch.cuda.get_device_name(i))
else:
    raise SystemExit("GPU is not enabled. In Lightning Studio, switch the machine to a GPU first.")
PY

echo "Installing/updating required packages..."
python -m pip install -q -U 'laya>=0.3.20' 'transformers>=5.0.0' 'huggingface_hub>=1.0.0' safetensors scikit-learn numpy

if [ ! -d "$DATA_REPO/.git" ]; then
  echo "Downloading historical Stock Truth data once..."
  git clone --depth 1 --filter=blob:none --sparse --branch data-snapshots \
    https://github.com/samin110597-create/stock-truth-v2.git "$DATA_REPO"
  git -C "$DATA_REPO" sparse-checkout set raw
else
  echo "Historical data already present; updating it..."
  git -C "$DATA_REPO" pull --ff-only
fi

mkdir -p "$ROOT/data"
rm -rf "$ROOT/data/raw"
ln -s "$DATA_REPO/raw" "$ROOT/data/raw"

cd "$ROOT"

echo "Building stock-only daily 10/20-bar dataset..."
python scripts/build_laya_stock_dataset.py --min-cases 500
python scripts/preprocess_stock_laya.py

echo "Downloading/caching base Laya model..."
MODEL_DIR="$(python - <<'PY'
from huggingface_hub import snapshot_download
print(snapshot_download('convaiinnovations/laya'))
PY
)"

export STOCK_LAYA_FAST=0
export STOCK_LAYA_EPOCHS=4
export STOCK_LAYA_MICRO_BATCH=1
export STOCK_LAYA_GRAD_ACCUM=32
export STOCK_LAYA_LOCAL_CHECKPOINT_DIR="$CHECKPOINT"
export STOCK_LAYA_CHECKPOINT_REPO=""
export STOCK_LAYA_RESUME_DIR="$PERSIST/resume"

echo "Starting/resuming FULL Stock-Laya training..."
python scripts/train_stock_laya_ddp.py "$MODEL_DIR" "$OUT" data/laya/preprocessed

echo "Running full untouched chronological evaluation..."
python scripts/evaluate_stock_laya.py \
  --model "$OUT" \
  --test data/laya/test.jsonl \
  --out "$EVAL" \
  --device cuda \
  --full-test

echo
echo "DONE. Evaluation saved to:"
echo "$EVAL"
python - <<PY
import json
r=json.load(open("$EVAL"))
p=r.get("promotion") or {}
print("PROMOTION PASSED:", bool(p.get("passed")))
print(json.dumps(p, indent=2))
PY
