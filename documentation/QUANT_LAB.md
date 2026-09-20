# Stock Truth Quant Lab — Q1.1

Quant Lab is a browser-based quantitative chart layered on the existing Stock Truth causal structure/reversal engine.

## Credential architecture

API credentials are **GitHub Actions repository secrets only**. The browser has no API-key form, does not use localStorage for secrets, and never receives a credential. GitHub Actions uses the keys to fetch market data and publishes only sanitized OHLCV snapshots.

Add secrets at **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**. Supported names are:

- `MASSIVE_KEY` (preferred for futures/commodities) or existing `POLYGON_KEY`
- `FMP_KEY` or `FMP_API_KEY`
- `FINNHUB_KEY` or `FINNHUB_API_KEY`
- `ALPHA_VANTAGE_KEY` or `ALPHAVANTAGE_KEY`
- `FRED_KEY` or `FRED_API_KEY`
- `SEC_USER_AGENT`

Q1.1's secure commodity collector currently consumes Massive/Polygon-compatible futures access. The other secret names are wired into the Actions environment for later macro/fundamental enrichment; they are not yet used to alter the Q1.1 score.

## Data behavior

- U.S. stocks/ETFs: GitHub scheduled snapshots are preferred when available. Daily analysis can still fall back to the existing public daily source for a never-seen ticker.
- Intraday equities: use the scheduled GitHub snapshot when available.
- Futures/commodities: GitHub Actions resolves the active dated contract and publishes sanitized 15m, 1h, 4h and session bars under `data/quant/`.
- The default secure futures universe is GC, SI, CL, NG, HG, PL, PA, ZC, ZW and ZS.
- GitHub Pages cannot directly read repository secrets at visitor runtime. Therefore a completely arbitrary never-before-seen intraday ticker cannot use a private secret on demand without a separate server/API proxy. The page fails closed rather than exposing the key.

## Q1.1 trading output

The page now separates model state from trade readiness. It publishes a model action only when the directional state, structure alignment, entropy filter and projected reward/risk clear minimum thresholds.

Outputs include preferred pullback entry zone, breakout/breakdown trigger, fixed invalidation/stop, TP1/TP2/TP3 when supported, nearest-target R:R, model quality, and projected 5/10/20-bar primary, pullback, expansion and failure paths. A weak state displays WATCH or NO TRADE instead of fabricating a setup.

## Quant calculations

Q1.1 includes normalized price velocity, acceleration and jerk; curvature; Shannon entropy; Hurst persistence estimate; trigonometric/DFT dominant-cycle estimation; realized and Parkinson volatility; ATR compression; volume Z-score and wick/volume absorption proxies; the existing completed-bar structure/reversal engine; regime classification; deterministic Monte Carlo price paths; and retrospective same-direction state frequencies with Wilson intervals.

Quant conviction is an evidence score, **not a probability**. Monte Carlo percentiles are model estimates, not guaranteed targets. Historical same-direction frequencies are retrospective context, not untouched out-of-sample probabilities. Absorption/distribution labels remain OHLCV proxies unless true order-book/order-flow data is supplied.
