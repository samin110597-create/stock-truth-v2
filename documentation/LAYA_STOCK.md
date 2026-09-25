# Stock Truth + Stock-Laya

## Purpose

Stock-Laya is an additional decision layer for Stock Truth. It does **not** replace the existing data collectors, technical engines, Q-State 2.0 model, Wyckoff/Elliott/reversal analysis, setup engine, risk rules, or validation gates.

The intended production path is:

```
existing market providers
  -> existing Stock Truth / Q-State feature engines
  -> existing forecast models
  -> Stock-Laya typed decision layer
  -> validation / abstention gate
  -> Stock Truth decision cockpit
```

## What "learn from mistakes" means

A live decision is immutable once issued. Later price action resolves the outcome. That resolved example is retained for a future candidate training set. We do **not** change production weights immediately after one losing trade.

A new Stock-Laya candidate is promoted only after chronological out-of-sample testing. A candidate must beat the current baseline on probability quality and directional performance rather than merely fit old trades better.

This prevents the system from "learning" by moving the goalposts after every mistake.

## Existing assets reused

The stock state begins with the same causal Q-State feature builder already used by `scripts/train_quant_model.py`. Current features include returns, EMA distances, RSI, ATR, volume anomaly, compression, range position, breakout state, latent velocity/acceleration, realized volatility, trend state, and mean-reversion context.

The first Stock-Laya label is deliberately simple and auditable:

- **BUY**: +1 ATR is touched first within the horizon.
- **SELL**: -1 ATR is touched first.
- **WAIT**: neither barrier is touched, or both occur in the same OHLC bar and order is unknowable.

The training set covers Q-State’s existing 5-, 10-, and 20-bar horizons on every supported stock timeframe (15M, 1H, 4H, 1D). The first live Stock-Laya integration uses daily 10-bar decisions for Swing and daily 20-bar decisions for Position.

## Build the training data

Run:

```
python scripts/build_laya_stock_dataset.py
```

It creates ignored files under `data/laya/`:

- `train.jsonl`
- `calibration.jsonl`
- `test.jsonl`
- `report.json`

Each row follows Laya's actual fine-tuning contract: JSON strings named `state`, `questions`, and `gold`.

The split is chronological. Future bars are used only for the gold label and never in state features.

## Training target

Base checkpoint: `convaiinnovations/laya`

Planned user checkpoint: `Smit1105/stock-laya-qstate`

The training notebook should be based on upstream Laya's official two-T4 Kaggle notebook, but must load Stock Truth's `train.jsonl` instead of the demo typed-decisions dataset. It must **not** mix the chronological calibration or test files into gradient training.

## Promotion

The UI must not present Laya confidence as a verified stock probability until the stock-domain holdout passes the configured gates in `config/laya.json`.

At minimum evaluate:

- balanced accuracy
- Brier score and Brier skill versus a base-rate forecast
- log loss
- coverage / abstention rate
- per-ticker and per-regime stability
- calibration reliability
- chronological test periods
- comparison with current Q-State 2.0

The final test split must remain untouched during model selection.

## Runtime

The intended cloud path is:

```
GitHub Pages Stock Truth
        |
        v
Deno Deploy gateway
        |
        v
Hugging Face Gradio ZeroGPU Space
        |
        v
Smit1105/stock-laya-qstate
```

Deno keeps the public web application independent from model-host details. No Hugging Face token or market-data key belongs in browser JavaScript.

Until the stock-specific checkpoint is trained and deployed, the Stock Truth UI must say that the Laya decision is **WITHHELD / TRAINING REQUIRED** rather than silently falling back to the generic zero-shot Laya model.
