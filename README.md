# Stock Truth — GitHub-only research terminal

**Type any supported stock/ETF ticker and analyze it immediately.** Ticker entry is not gated by the scan watchlist or a GitHub Actions run. The browser requests public price/history data and computes the active model locally in a Web Worker. Components that cannot be sourced remain unavailable.

Production: GitHub Pages, `main`, generated `dist/` artifact. Entry: `/stock-truth-v2/web/`. The dashboard displays the exact source commit and model version. Current model: **5.0.0-causal-swing**, the consolidated successor to the audited V3/V4 layers.

## One production path

`web/app.mjs → src/providers.mjs → src/bars.mjs → technicals → structure → reversal → setups → validation → analysis → dashboard`

All executable modules and Lightweight Charts are shipped in the same Pages artifact. There is no runtime JavaScript download/eval, remote V3/V4 patch chain, serverless endpoint, Vercel configuration, or private key in the application. Original versions are preserved in `archive/` and the rollback branch, excluded from the deployed artifact.

## Direct ticker analysis and optional supplements

- A browser-compatible Stock Analysis public quote/history endpoint is attempted for every entered symbol. It requires no embedded key or proxy. Ticker identity is verified; current public coverage is U.S. stocks/ETFs, and an unknown/unsupported symbol returns an honest component error. This is an **unofficial endpoint, not a supported API contract**. It may stop working, restrict depth, or reject requests. We do not bypass authentication, paywalls, rate limits or browser protections.
- Daily OHLCV drives local technical, structure, reversal, setup and thesis calculations. Weekly/monthly candles are resampled only when all scheduled sessions are complete. A closing-price-only chart cannot be converted into fictitious OHLCV.
- GitHub Actions optionally adds longer Yahoo daily history, 5-minute/hourly bars, SEC companyfacts, market benchmarks, scans and an append-only setup ledger. A deeper daily source replaces the whole series only after overlapping completed closes pass a cross-check. Different providers' candles are never spliced together.
- Browser-only intraday and SEC fundamentals are unavailable when a source cannot support the request. That does not block available daily analysis. Public endpoints do not guarantee exchange real-time data: the header reports timestamps and unspecified provider latency.
- `config/watchlist.json` controls scans and quick access only. It does **not** restrict the search input.

## Accuracy rules

- Confirmed calculations use completed exchange-session bars, including early closes and daylight-saving time. Daily collection has a 15-minute close grace; intraday uses 60 seconds. No quote is spliced into a historical candle.
- Null remains null. Warmup values, missing volume, missing fundamentals and unsupported timeframes are never replaced by invented prices or zero-valued facts.
- Confirmed pivots have a three-bar delay. ATR impulse, time separation, participation and post-pivot displacement determine swing degree. BOS/CHoCH only uses levels known at that time.
- Reversals have watch/developing/confirmed states. Absorption, distribution, capitulation, sweeps, divergence and OHLCV VWAP are explicitly **proxies**, not proof of institutional orders.
- Setup stops follow structural invalidation. Targets use actual known pivot levels or a measured structural range. The nearest obstacle is not skipped to exaggerate R:R. Strict and Adaptive thresholds are fixed; missing evidence reduces the score.
- A score of 80/100 is not an 80% probability. Historical target frequencies, Wilson intervals and sample counts are separately labeled. No calibrated directional probability or verified predictive edge is currently claimed.
- Historical setup replay is causal, non-overlapping and uses a one-bar embargo. Stops win unresolved same-bar target/stop collisions; entry-bar targets are not credited; adverse gaps and fixed 10 bps per-side costs are included. This is **retrospective replay, not untouched out-of-sample evidence**.
- Issued setup records never rewrite entry/stop/targets. Changed plans receive new IDs. Browser history is local to that browser; scheduled history is stored in the `data-snapshots` branch with append-only observations.

## Develop and verify

```sh
npm ci --ignore-scripts
python -m pip install -r requirements.txt
python scripts/generate_calendar.py
npm test
# Optional real sourced data; not required for a never-seen ticker to work:
python scripts/collect.py --symbols NVDA MU VRT CRWV CIFR SNDK GOOG META AVGO MRVL SPY
npm run analyze
npm run build
npm run check
npm run serve
```

The deterministic test fixtures are isolated from production and never presented as real market data. Validation results are generated from the actual fetched datasets, without an optimization step.

## GitHub deployment

One workflow, `.github/workflows/terminal.yml`, validates branches/PRs. On `main`, it collects optional datasets, appends setup observations, saves data to `data-snapshots`, builds, checks and uploads the artifact, deploys Pages, then verifies the production commit.

GitHub Pages must have **Settings → Pages → Build and deployment → Source: GitHub Actions** selected. The connected integration previously returned `Resource not accessible by integration` when attempting to enable it. No application code can override this account/repository setting.

Scheduled collection: `:17` and `:47`, 13:00–21:59 UTC weekdays, plus 22:17 UTC. Scheduling is best effort and can be delayed. U.S. calendar checks exclude holidays and incomplete candles. SEC facts are cached for 24 hours. Direct quote/history retrieval occurs when a ticker is entered or refreshed.

Optional repository secrets: `POLYGON_KEY` for a daily-bar fallback and `SEC_USER_AGENT` for an identified SEC client. The related legacy repository's Finnhub/Twelve/FMP/Polygon/Alpha Vantage secret names were identified, but secrets are repository-scoped and were not copied, exposed or assumed present here.

## Documentation and rollback

See `documentation/AUDIT.md`, `documentation/ACCEPTANCE.md`, `documentation/SOURCES.md` and generated `data-snapshots:validation-report.json`.

Rollback point: branch `rollback/pre-github-only-terminal-20260911`, commit `97cffb64256521e8283ec3763836461db4eeabde`. Prefer reverting the implementation PR through a new reviewed PR; reverting to the original commit also restores its known Vercel-dependent architecture, so it is an archival rollback, not a GitHub-only production solution.
