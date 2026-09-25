#!/usr/bin/env python3
"""Fine-tune Laya on Stock Truth decision cases with a separate chronological calibration set.

Run with two GPUs:
  torchrun --nproc_per_node=2 scripts/train_stock_laya_ddp.py MODEL_DIR OUTPUT_DIR

The input tensor files are produced by scripts/preprocess_stock_laya.py.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import time
from pathlib import Path

import torch
import torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from safetensors.torch import load_file, save_file
from transformers import AutoTokenizer

from laya.common import build_model, proper_reward


def collate(items, pad_id):
    n = len(items)
    length = max(len(x["ids"]) for x in items)
    kmax = max(len(x["markers"]) for x in items)
    ids = torch.full((n, length), pad_id, dtype=torch.long)
    att = torch.zeros((n, length), dtype=torch.long)
    mpos = torch.zeros((n, kmax), dtype=torch.long)
    mmask = torch.zeros((n, kmax), dtype=torch.bool)
    target = torch.zeros((n, kmax), dtype=torch.float32)
    for i, item in enumerate(items):
        ids[i, : len(item["ids"])] = torch.tensor(item["ids"])
        att[i, : len(item["ids"])] = 1
        k = len(item["markers"])
        mpos[i, :k] = torch.tensor(item["markers"])
        mmask[i, :k] = True
        target[i, : len(item["target"])] = torch.tensor(item["target"], dtype=torch.float32)
    return {
        "input_ids": ids,
        "attention_mask": att,
        "marker_pos": mpos,
        "marker_mask": mmask,
        "target": target,
        "qtype": torch.tensor([x["qtype"] for x in items]),
    }


def fit_temperature(rows):
    if len(rows) < 10:
        return 1.0
    kmax = max(len(z) for z, _ in rows)
    logits = torch.full((len(rows), kmax), -1e4)
    target = torch.zeros((len(rows), kmax))
    for i, (z, t) in enumerate(rows):
        logits[i, : len(z)] = torch.tensor(z)
        target[i, : len(t)] = torch.tensor(t, dtype=torch.float32)
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=100)

    def closure():
        opt.zero_grad()
        loss = -(target * torch.log_softmax(logits / log_t.exp(), -1)).sum(-1).mean()
        loss.backward()
        return loss

    opt.step(closure)
    return float(torch.clamp(log_t.exp(), 0.1, 10.0).item())


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Use: train_stock_laya_ddp.py MODEL_DIR OUTPUT_DIR [PREPROCESSED_DIR]")
    model_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    pre_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("data/laya/preprocessed")

    dist.init_process_group("nccl")
    rank = dist.get_rank()
    world = dist.get_world_size()
    local_rank = int(os.environ.get("LOCAL_RANK", "0"))
    torch.cuda.set_device(local_rank)
    device = torch.device("cuda", local_rank)

    cfg = json.loads((model_dir / "rl_agent_config.json").read_text())
    cfg["gradient_checkpointing"] = True
    cfg["max_tokens_per_batch"] = 4096
    cfg["max_len"] = 1024
    cfg["head_max_len"] = 256

    tok = AutoTokenizer.from_pretrained(model_dir / "tokenizer")
    model = build_model(cfg, encoder_dir=str(model_dir / "encoder"))
    model.load_state_dict(load_file(model_dir / "model.safetensors"), strict=True)
    model.encoder.gradient_checkpointing_enable(
        gradient_checkpointing_kwargs={"use_reentrant": False}
    )
    model.head_checkpointing = True
    model.to(device)
    model.train()
    ddp = DDP(model, device_ids=[local_rank], find_unused_parameters=True)

    train_items = torch.load(pre_dir / "train_items.pt", weights_only=False)
    calib_items = torch.load(pre_dir / "calibration_items.pt", weights_only=False)
    experience_items = []
    exp_path = pre_dir / "experience_items.pt"
    if exp_path.exists():
        experience_items = torch.load(exp_path, weights_only=False)
        cap = max(1, int(len(train_items) * 0.10))
        if len(experience_items) > cap:
            rng = random.Random(20260925)
            experience_items = rng.sample(experience_items, cap)
        train_items = train_items + experience_items
    if len(train_items) < 500 or len(calib_items) < 100:
        raise SystemExit(
            f"Insufficient Stock-Laya data: train={len(train_items)}, calibration={len(calib_items)}"
        )
    my_items = train_items[rank::world]

    epochs = int(os.environ.get("STOCK_LAYA_EPOCHS", "4"))
    micro = int(os.environ.get("STOCK_LAYA_MICRO_BATCH", "8"))
    grad_accum = int(os.environ.get("STOCK_LAYA_GRAD_ACCUM", "4"))
    group_size = 4
    lr_encoder = 2.5e-5
    lr_head = 1.0e-4
    sigma_start, sigma_end = 0.4, 0.1

    encoder_params = [p for n, p in ddp.named_parameters() if "encoder." in n]
    head_params = [p for n, p in ddp.named_parameters() if "encoder." not in n]
    optimizer = torch.optim.AdamW(
        [
            {"params": encoder_params, "lr": lr_encoder},
            {"params": head_params, "lr": lr_head},
        ],
        weight_decay=0.01,
    )
    updates = max(1, (len(my_items) // max(1, micro * grad_accum)) * epochs)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=updates, eta_min=1e-6
    )
    scaler = torch.amp.GradScaler("cuda", enabled=True)

    if rank == 0:
        print(
            f"Stock-Laya: {len(train_items)} training decisions "
            f"(including {len(experience_items)} capped issued-setup experience decisions), "
            f"{len(calib_items)} chronological calibration decisions, {world} GPUs."
        )
    started = time.time()

    for epoch in range(epochs):
        random.Random(4200 + epoch + rank).shuffle(my_items)
        optimizer.zero_grad(set_to_none=True)
        epoch_loss = 0.0
        batches = 0
        sigma = sigma_start + (sigma_end - sigma_start) * (
            epoch / max(1, epochs - 1)
        )

        for start in range(0, len(my_items), micro):
            chunk = my_items[start : start + micro]
            if not chunk:
                continue
            batch = collate(chunk, tok.pad_token_id)
            with torch.autocast("cuda", dtype=torch.float16):
                logits, act = ddp(
                    batch["input_ids"].to(device),
                    batch["attention_mask"].to(device),
                    batch["marker_pos"].to(device),
                    batch["marker_mask"].to(device),
                    batch["qtype"].to(device),
                )
            logits = logits.float()
            mask = batch["marker_mask"].to(device)
            target = batch["target"].to(device)
            k = mask.sum(-1, keepdim=True).float()

            eps = torch.randn(
                (group_size,) + logits.shape, device=device
            ) * sigma * mask
            eps = (eps - eps.sum(-1, keepdim=True) / k) * mask
            noisy = logits.detach().unsqueeze(0) + eps
            probs = torch.softmax(noisy.masked_fill(~mask, -1e4), -1)
            with torch.no_grad():
                reward = proper_reward(
                    probs,
                    target.unsqueeze(0),
                    batch["qtype"].to(device),
                    mask,
                    w_sph=0.75,
                    w_rps=1.0,
                )
                advantage = reward - reward.mean(0, keepdim=True)
                advantage = advantage / (advantage.std() + 1e-6)

            logp = -(((noisy - logits.unsqueeze(0)) ** 2) * mask).sum(-1) / (
                2 * sigma**2
            )
            loss_rl = -(advantage * logp).mean()
            loss_ce = -(
                target
                * torch.log_softmax(logits.masked_fill(~mask, -1e4), -1)
            ).sum(-1).mean()
            loss = (loss_rl + loss_ce) / grad_accum + 0.0 * act.sum()
            scaler.scale(loss).backward()

            batches += 1
            if batches % grad_accum == 0 or start + micro >= len(my_items):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(ddp.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)
            epoch_loss += float(loss.item() * grad_accum)

        dist.barrier()
        if rank == 0:
            print(
                f"Epoch {epoch+1}/{epochs}: loss={epoch_loss/max(1,batches):.4f} "
                f"elapsed={time.time()-started:.0f}s"
            )
            checkpoint = output_dir / "checkpoint_latest"
            checkpoint.mkdir(parents=True, exist_ok=True)
            save_file(
                {k: v.half().contiguous().cpu() for k, v in model.state_dict().items()},
                checkpoint / "model.safetensors",
            )
            model.encoder.config.save_pretrained(checkpoint / "encoder")
            tok.save_pretrained(checkpoint / "tokenizer")
            (checkpoint / "checkpoint_meta.json").write_text(
                json.dumps(
                    {
                        "epoch": epoch + 1,
                        "epochs": epochs,
                        "avg_loss": epoch_loss / max(1, batches),
                    },
                    indent=2,
                )
            )

    dist.barrier()

    if rank == 0:
        model.eval()
        calibration = []
        with torch.no_grad():
            for start in range(0, len(calib_items), 16):
                chunk = calib_items[start : start + 16]
                batch = collate(chunk, tok.pad_token_id)
                with torch.autocast("cuda", dtype=torch.float16):
                    logits, _ = model(
                        batch["input_ids"].to(device),
                        batch["attention_mask"].to(device),
                        batch["marker_pos"].to(device),
                        batch["marker_mask"].to(device),
                        batch["qtype"].to(device),
                    )
                values = logits.float().cpu().numpy()
                for i, item in enumerate(chunk):
                    k = len(item["markers"])
                    calibration.append(
                        (item["qtype"], values[i, :k], item["target"])
                    )

        temperatures = [1.2, 1.2, 1.2]
        for qtype in range(3):
            rows = [(z, t) for qt, z, t in calibration if qt == qtype]
            if rows:
                temperatures[qtype] = fit_temperature(rows)

        output_dir.mkdir(parents=True, exist_ok=True)
        save_file(
            {k: v.half().contiguous().cpu() for k, v in model.state_dict().items()},
            output_dir / "model.safetensors",
        )
        model.encoder.config.save_pretrained(output_dir / "encoder")
        tok.save_pretrained(output_dir / "tokenizer")
        cfg["fine_tuned"] = True
        cfg["model_name"] = "stock-laya-qstate"
        cfg["temperature"] = temperatures
        cfg.pop("temperature_by_options", None)
        (output_dir / "rl_agent_config.json").write_text(json.dumps(cfg, indent=2))
        (output_dir / "stock_laya_training.json").write_text(
            json.dumps(
                {
                    "base_model": "convaiinnovations/laya",
                    "train_decisions": len(train_items),
                    "calibration_decisions": len(calib_items),
                    "epochs": epochs,
                    "temperatures": temperatures,
                    "policy": "Calibration split was chronological and excluded from gradient training.",
                },
                indent=2,
            )
        )
        print("Saved Stock-Laya candidate:", output_dir)

    dist.destroy_process_group()


if __name__ == "__main__":
    main()
