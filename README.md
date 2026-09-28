# Stock Truth / Q-State Unified

Q-State Unified is the **single production model and user-facing system** for stock/ETF forecasting, research and analysis in this repository.

Production UI: https://samin110597-create.github.io/stock-truth-v2/quant/

Legacy compatibility URLs such as `/web/` redirect to Q-State Unified. The legacy Stock Truth source remains only for regression tests, historical research and migration reference; its executable modules are not shipped in the GitHub Pages production artifact.

## One production architecture

```text
Market providers + fundamentals + macro
                ↓
       Deno canonical data layer
   freshness · identity · cross-checks
                ↓
     Q-State Unified canonical artifact
   multi-timeframe / multi-horizon heads
                ↓
 forecast · research · analysis · execution map
                ↓
        one Q-State web interface
```

There is no second production forecast model and no equal-vote ensemble of separate products.

- **Q-State Unified** owns production forecasting, technical/state analysis and research presentation.
- **Phase1** is an offline challenger/validation lab only.
- **Stock-Laya** is challenger-only through `/v1/challenger/stock-laya` with `production_weight: 0`.
- Chronos, IBM-style models, or future methods may be tested as challengers, but they have zero production influence unless they pass the promotion contract and are incorporated into the one Q-State artifact.

## Any-ticker data path

GitHub Pages is static, so request-time market/research retrieval is handled by the Deno service defined by `deno.json` and `main.ts`.

Primary routes:

- `GET /health`
- `GET /v1/quote?symbol=AAPL`
- `GET /v1/market?symbol=AAPL&timeframe=1D`
- `GET /v1/research?symbol=AAPL`
- `POST /v1/challenger/stock-laya` — challenger evidence only, never the production decision

Stocks/ETFs are not gated by a watchlist or a precomputed GitHub Actions run. Gold/silver and supported futures aliases remain available through the Q-State data route.

## Canonical data policy

For request-time equity data, Q-State queries available providers independently and cross-checks current prices/bars when multiple current sources are available. It does not silently trust the first successful provider.

Supported sources include Massive/Polygon-compatible aggregates, FMP, Finnhub, Alpha Vantage and Yahoo fallback. The returned frame records the selected provider, freshness and cross-source validation/dispersion when available.

Missing or stale evidence stays missing/stale. Q-State does not fabricate OHLCV, fundamentals, probabilities, targets or institutional order flow.

## Research context

The Deno `/v1/research` route provides:

- sourced public fundamentals / SEC-derived statement context
- FRED macro context including nominal/real 10Y yields, breakeven inflation and trade-weighted USD

**Current fundamentals and macro have 0% production forecast weight until synchronized historical versions pass leakage-controlled out-of-sample ablation.** They are visible for research without being allowed to make a backtest look better through present-day information leakage.

Recommended Deno secrets:

- `MASSIVE_KEY` (or configured Polygon-compatible key)
- `FMP_API_KEY`
- `FINNHUB_API_KEY`
- `ALPHA_VANTAGE_KEY`
- `FRED_API_KEY`

Credentials remain server-side and are never returned to the browser.

## Q-State Unified model

The canonical artifact is generated at `data/quant/model.json` and is versioned as **QSTATE-UNIFIED-3.0**.

One artifact can contain multiple timeframe/horizon heads (15M, 1H, 4H, 1D × 5/10/20 bars). These are components of one model package with one data contract and one promotion policy—not independent production models voting against one another.

Causal features include price/volume returns, EMA state, RSI, ATR/volatility/compression, range position, breakout state, volume anomaly, latent velocity/acceleration and trend/regime interactions.

The runtime also evaluates confirmed multi-scale structure, BOS/CHoCH, liquidity sweeps, RSI pivot divergence, volatility, entropy/Hurst/cycle context, multi-timeframe alignment and explicit WATCH / DEVELOPING / READY execution states.

## Promotion and accuracy rules

A model head may expose a predictive probability only when it passes the predeclared evidence gates. Current rules include:

- chronological expanding walk-forward validation with embargo
- at least 3 qualifying folds
- at least 500 walk-forward OOS observations
- Brier skill versus base rate of at least 0.5%
- log loss no worse than the base-rate forecast
- at least 60% of folds with positive Brier skill and non-worse log loss
- positive median fold Brier skill
- a final **untouched 6% time holdout** with non-negative Brier skill and non-worse log loss

If a head fails, probability is **WITHHELD**. Rule-based market-state analysis may still say WATCH/DEVELOPING, but an unvalidated percentage is not presented as predictive probability.

Targets use validated OOS conditional return bands when promoted; otherwise they remain explicitly labeled scenario/simulation outputs. Stops/invalidation are structural and a published plan is not retroactively rewritten.

## Forward accuracy dashboard

The Q-State page maintains an immutable browser-side forward ledger for every forecast the user actually views. The issued forecast record is never rewritten; later completed bars are stored as separate outcome observations.

The dashboard reports by 15M / 1H / 4H / 1D and 5 / 10 / 20 bars:

- directional accuracy
- exact-label Brier score for the promoted probability head
- calibration gap
- maximum adverse excursion (MAE)
- median-path projection error
- TP1-before-stop rate
- stop-before-TP1 rate
- false-breakout rate
- regime-level breakdowns

Probability scoring uses the model's real label: whether +1 issuance ATR is reached before -1 issuance ATR within the model horizon. Same-bar double touches and unresolved paths are excluded. Trade target/stop collisions are scored conservatively with the stop winning.

The ledger is stored in IndexedDB in the user's browser, so it works without API credentials or a write-capable server. The dashboard can refresh open outcomes from the canonical Deno market-data service. This is forward evidence for forecasts actually issued in that browser; it is not presented as a universal production track record.

## Challenger promotion contract

Phase1, Stock-Laya or another experimental method can affect production only if:

1. every input was available at the decision timestamp;
2. leakage and label timing audits pass;
3. testing is chronological with appropriate purging/embargo;
4. the challenger beats the current Q-State baseline on untouched/OOS evidence;
5. calibration is not worse;
6. improvement is stable across regimes and not dominated by one ticker/sector;
7. ablation proves incremental value;
8. the winning method is incorporated into Q-State Unified and the **whole canonical artifact is revalidated**.

A challenger is never deployed alongside Q-State as a second production decision engine.

## Build and integrity

```sh
npm ci --ignore-scripts
python -m pip install -r requirements.txt
python scripts/generate_calendar.py
npm test
python scripts/train_quant_model.py
npm run build
npm run check
```

The production integrity gate requires:

- Q-State Unified schema/version identity
- the untouched-holdout metadata for every promoted head
- no browser API secrets
- versioned local modules
- the legacy Stock Truth execution engine absent from `dist/`
- root and `/web/` compatibility entries routed to Q-State Unified

The GitHub workflow `.github/workflows/terminal.yml` runs validation before deployment and deploys the exact tested `dist/` artifact to GitHub Pages.

## Phase1

Phase1 remains a separate repository only because research experiments, large training artifacts and historical validation are easier to isolate there. It is **not** a separate product or production model. Its public page redirects to Q-State Unified and its automated live-forecast workflow has been removed.

## Documentation

See `documentation/QUANT_LAB.md` for the detailed one-model architecture, calibration rules and data-integrity policy.
