# Technical interpretation revision — 2026-10-14

This release corrects the interpretation of the existing canonical Q-State model; it does not introduce another prediction model or claim improved trading accuracy.

- A confirmed break after the latest swing overrides an older HH/HL or LH/LL sequence.
- RSI is 50 for a fully flat series. Old pivot divergence expires after ten bars.
- Plain-language paths use confirmed pivots from the most recent 252 completed bars, grouped within 0.15 ATR. Levels are sorted around the latest verified quote; crossed levels cannot remain ahead-of-price destinations.
- Quotes crossing a mapped level or moving at least 0.5 ATR from the completed close invalidate the old numerical projection display and prevent new forecast issuance from that old view. This is a heuristic review threshold, not a calibrated probability.
- Quote refresh updates entry/invalidation checks as well as the displayed quote. It does not turn a quote into OHLCV or a completed bar.
- The 5/10/20-period projection table uses the existing model's P10/P50/P90 outputs with exchange-calendar end times. Model quantiles are not claimed to have verified coverage or to predict target-arrival times.
- Added three-period RSI change, five-candle closing pressure, and ten-period path efficiency to timeframe explanations. These are descriptive measurements, not actual institutional order flow.
- Optional 0.1 ATR clearance is explicitly a noise filter, not a measured edge.

Validation: 87 automated checks pass, including new-break precedence, flat RSI, level ordering/deduplication/recency, unconfirmed-pivot exclusion, quote-cross invalidation, stale-feed handling, opposing timeframe evidence and short-session/calendar projection dates. These are correctness checks, not a trading-performance backtest.

Known limitation: current hourly history depends on provider availability/entitlement. Stale 1H/4H data remains labeled stale and does not count as current timeframe agreement.

Method references: https://www.cmegroup.com/education/courses/technical-analysis/support-and-resistance and https://otexts.com/fpp3/prediction-intervals.html . Numerical thresholds above are implementation choices, not source claims.
