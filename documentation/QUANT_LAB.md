# Stock Truth Quant Lab — Q1.0

Quant Lab is an experimental browser-based quantitative chart layered on the existing Stock Truth causal structure/reversal engine.

## Open it

Production path after merge/deploy: `/stock-truth-v2/web/quant/`.

The classic Stock Truth terminal remains at `/stock-truth-v2/web/`.

## API keys

Open **API Keys** in Quant Lab. Keys are stored only in that browser's `localStorage`; they are never committed to the public repository.

- **Massive / Polygon key** — primary price feed; preferred for stocks/ETFs intraday and required for futures/commodities. The router tries `api.massive.com` first and the legacy `api.polygon.io` stock aggregates host second.
- **Financial Modeling Prep key** — daily equity fallback.
- **Alpha Vantage key** — daily/intraday equity fallback when the account entitlement supports the requested endpoint.
- **Finnhub key** — retained in the local key vault for the next quote/event-enrichment layer; Q1.0 does not use it in the score yet.
- **FRED key** — retained in the local key vault for the next macro-factor layer; Q1.0 does not use it in the score yet.

Existing GitHub repository secrets remain useful to scheduled collectors, but GitHub Pages cannot read repository secrets at runtime. Browser-local keys are therefore the immediate path for arbitrary-ticker analysis on a GitHub-only deployment.

## Supported input

Stocks/ETFs: `NVDA`, `SPY`, `GLD`, etc.

Commodity product aliases: `GOLD`/`GC`, `SILVER`/`SI`, `OIL`/`WTI`/`CL`, `NATGAS`/`NG`, `COPPER`/`HG`, `CORN`/`ZC`, `WHEAT`/`ZW`, `SOYBEANS`/`ZS`, `PLATINUM`/`PL`, `PALLADIUM`/`PA`.

With Massive futures access, a product code is resolved to an active dated contract. A specific contract such as `GCZ6` or `CLX6` can also be entered directly.

## Q1.0 calculations

Q1.0 adds normalized price velocity, acceleration and jerk; curvature; Shannon entropy; Hurst persistence estimate; trigonometric/DFT dominant-cycle estimation; realized and Parkinson volatility; ATR compression; volume Z-score and wick/volume absorption proxies; the existing completed-bar structure/reversal engine; regime classification; deterministic Monte Carlo price paths; and retrospective same-direction state frequencies with Wilson intervals.

Quant conviction is an evidence score, **not a probability**. Monte Carlo percentiles are model estimates, not guaranteed targets. Absorption/distribution labels are OHLCV proxies unless true order-book/order-flow data is supplied.

## Integrity rules

- No missing price is invented.
- Quant analysis requires at least 80 completed bars.
- Current/forming bars are rejected by the inherited canonical-bar checks when their end time is in the future.
- Forecast paths use a deterministic seed so a fixed input history produces the same result on refresh.
- Existing Stock Truth structure/reversal logic remains unchanged.
- Q1.0 lives in a separate page and branch until its tests pass and it is deliberately merged.
