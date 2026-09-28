# Single-Model Architecture

## Goal

There is one production intelligence system: **Q-State**. It owns stock-price forecasts, calibrated directional probabilities, scenario ranges, market-structure interpretation, reversal evidence, execution maps, and the final research/analysis narrative shown to the user.

The system may use many data sources and many internal features, but it must not expose multiple independent forecast models that can disagree with one another.

## Production topology

```
Market / fundamentals / macro providers
        ↓
Deno canonical data layer (main.ts)
        ↓
validation + normalization + freshness + source reconciliation
        ↓
Q-State feature engine
        ↓
Q-State calibrated forecasting model
        ↓
Q-State structure / reversal / execution analysis
        ↓
ONE forecast contract → UI / alerts / research output
```

## Repository roles

### stock-truth-v2
Production repository. It contains the canonical Deno data layer, Q-State model, analysis engine, UI, deployment, and the only public forecast contract.

### Phase1
Research laboratory. It is allowed to:
- build datasets;
- test candidate features and algorithms;
- run ablations and walk-forward validation;
- compare candidates against the current Q-State baseline;
- collect forward evidence;
- produce promotion reports.

It is not allowed to publish a separate production BUY/SELL forecast, probability, target, or model identity.

## Canonical forecast contract

A production result should contain, when evidence supports it:

- symbol and source symbol;
- data timestamp in America/New_York;
- provider/freshness/consensus metadata;
- direction: bullish / bearish / neutral;
- model state: WATCH / DEVELOPING / READY;
- calibrated probability only when promotion gates pass;
- expected return / price distribution for fixed horizons;
- entry zone, trigger, structural invalidation and immutable targets;
- market structure: HH/HL/LH/LL, BOS, CHoCH and liquidity sweeps;
- reversal evidence: sweep/failure + RSI divergence + volume/absorption proxies;
- multi-timeframe alignment;
- macro/fundamental context as descriptive inputs unless separately validated as predictive features;
- model version and validation evidence.

## Data authority

Deno is the canonical live-data gateway. It should prefer agreement over provider priority alone. The target state is:

1. request multiple eligible providers concurrently where quota permits;
2. normalize timestamps, adjustments and sessions;
3. reject stale or malformed series;
4. compare overlapping completed bars;
5. choose a canonical series only when overlap is consistent;
6. surface disagreement and reduce confidence rather than silently mixing incompatible series;
7. never synthesize OHLCV from quote-only data;
8. expose source, timestamp and freshness in every result.

## Model policy

Q-State may internally be an ensemble, but it is still **one model contract**. Internal sub-models are components, not separate public forecasters.

A candidate model or feature can replace part of Q-State only after it passes all required gates on chronological data. At minimum:

- no look-ahead or leakage;
- sufficient walk-forward folds and OOS sample size;
- Brier score better than base rate for probabilistic outputs;
- log loss no worse than baseline;
- stable performance across folds/regimes rather than one lucky period;
- calibration error within the current model's tolerance;
- directional/return error improvement that survives transaction-cost assumptions where relevant;
- no material degradation in tail-risk or false-breakout behavior;
- prospective forward evidence before high-confidence production labels are enabled.

Until those gates pass, the candidate remains research-only and the existing Q-State production logic remains unchanged.

## Research feedback loop

```
Q-State production observations
        ↓
immutable forward log
        ↓
Phase1 research + failure analysis
        ↓
candidate change
        ↓
walk-forward / regime / calibration tests
        ↓
promotion report
        ↓
merge validated change into Q-State
        ↓
new Q-State version
```

This is how the system learns from mistakes without rewriting historical signals or retroactively changing targets.

## Anti-fragmentation rules

- No second production model name may appear in the public UI.
- No separate model may publish an alternative directional probability for the same symbol/horizon.
- No research workflow may silently overwrite the Q-State production artifact.
- No candidate may be promoted because it looks better on one ticker or one period.
- No probability may be displayed simply because a classifier emits one.
- No model may alter a previously issued setup's entry, stop, or targets after publication.
- Old/experimental pipelines should be archived or clearly marked research-only rather than left active on schedules.

## Immediate consolidation decisions

1. Q-State remains the only production forecaster.
2. The external Stock-Laya decision endpoint is retired from production.
3. Phase1 scheduled live forecasting is removed; Phase1 becomes manual/CI research validation.
4. Phase1 runtime dependencies are pinned to the version used by persisted model artifacts to avoid silent deserialization drift.
5. Future Phase1 experiments should consume the same canonical Deno market-data contract used by Q-State.
