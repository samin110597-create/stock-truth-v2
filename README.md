# Stock Truth — GitHub-only research terminal

**Type any supported stock/ETF ticker and analyze it immediately.** Ticker entry is not gated by the scan watchlist or a GitHub Actions run. The browser requests public price/history data and computes the active model locally in a Web Worker. Components that cannot be sourced remain unavailable.

Production: GitHub Pages, `main`, generated `dist/` artifact. Entry: `/stock-truth-v2/web/`. The dashboard displays the exact source commit and model version. Current model: **5.1.0-restored-terminal**, the consolidated successor to the audited V3/V4 layers.

## One production path

`web/app.mjs → src/providers.mjs → src/bars.mjs → technicals → structure → reversal → setups → validation → analysis → dashboard`

All executable modules and Lightweight Charts are shipped in the same Pages artifact. There is no runtime JavaScript download/eval, remote V3/V4 patch chain, serverless endpoint, Vercel configuration, or private key in the application. Original versions are preserved in `archive/` and the rollback branch, excluded from the deployed artifact.

## Direct ticker analysis and optional supplements

- A browser-compatible Stock Analysis public quote/history endpoint is attempted for every entered symbol. It requires no embedded key or proxy. Ticker identity is verified; current public coverage is U.S. stocks/ETFs, and an unknown/unsupported symbol returns an honest component error. This is an **unofficial endpoint, not a supported API contract**. It may stop working, restrict depth, or reject requests. We do not bypass authentication, paywalls, rate limits or browser protections.
- Daily OHLCV drives local technical, structure, reversal, setup and thesis calculations. Weekly/monthly candles are resampled only when all scheduled sessions are complete. A closing-price-only chart cannot be converted into fictitious OHLCV.
- GitHub Actions optionally adds longer Yahoo daily history, 5-minute/hourly bars, SEC companyfacts, market benchmarks, scans and an append-only setup ledger. A deeper daily source can be reconciled with up to five newer sourced daily candles only after at least ten overlapping dates agree in open, high, low and close within 0.5%. Original prices and per-row sources are retained. A rejected trailing row may be resolved only by an actual replacement; interior omissions, price-basis differences and unresolved split anomalies reject reconciliation. No quote becomes a historical candle.
- Browser-only intraday and SEC fundamentals are unavailable when a source cannot support the request. That does not block available daily analysis. Public endpoints do not guarantee exchange real-time data: the header reports timestamps and unspecified provider latency.
- `config/watchlist.json` controls scans and quick access only. It does **not** restrict the search input.

## Accuracy rules

- Confirmed calculations use completed exchange-session bars, including early closes and daylight-saving time. Daily collection has a 15-minute close grace; intraday uses 60 seconds. No quote is spliced into a historical candle.
- Null remains null. Warmup values, missing volume, missing fundamentals and unsupported timeframes are never replaced by invented prices or zero-valued facts.
- Confirmed pivots have a three-bar delay. ATR impulse, time separation, participation and post-pivot displacement determine swing degree. BOS/CHoCH only uses levels known at that time.
- Reversals have watch/developing/confirmed states. Absorption, distribution, capitulation, sweeps, divergence and OHLCV VWAP are explicitly **proxies**, not proof of institutional orders.
- Every setup requires a completed rejection/reclaim or structural-break candle; proximity or oversold alone does not qualify. Setup stops follow structural invalidation. Targets use actual known pivot levels or a measured structural range. The nearest obstacle is not skipped to exaggerate R:R. Strict and Adaptive thresholds are fixed; missing evidence reduces the score.
- A score of 80/100 is not an 80% probability. Historical target frequencies, Wilson intervals and sample counts are separately labeled. No calibrated directional probability or verified predictive edge is currently claimed.
- Historical setup replay is causal, non-overlapping and uses a one-bar embargo. Stops win unresolved same-bar target/stop collisions; entry-bar targets are not credited; adverse gaps and fixed 10 bps per-side costs are included. This is **retrospective replay, not untouched out-of-sample evidence**.
- Issued setup records never rewrite entry/stop/targets. A plan is replayed from its original confirmation until it expires or resolves. An old sweep/break cannot keep reissuing a moving plan. New confirmations receive new IDs. Post-signal session stop/target tests suppress fresh entries; a quote is never evidence of a user fill. Browser history is local to that browser; scheduled history is stored in the `data-snapshots` branch with append-only observations.

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

The original charcoal/amber terminal concept is restored: Verdict, Technicals, Fundamentals, Rank, Model lab and Sources; bullish/bearish evidence; conditional scenarios; Strict/Adaptive swing/position trade matrix; local risk sizing; candles, volume, EMA20/50/200, RSI/MACD panes and native candle markers. The technical BUY/SELL stance is separate from entry permission. Multi-horizon history is descriptive, never invented forecast odds.

One workflow, `.github/workflows/terminal.yml`, validates branches/PRs. Code pushes restore optional snapshots, run analysis and integrity gates, and deploy the tested artifact without waiting for provider collection. Scheduled/manual runs additionally collect, reconcile and save source data. Every release versions the complete local module graph and CSS by commit, including Worker imports, to prevent mixed old-engine/new-layout browser caches.

GitHub Pages is enabled and deployments were observed succeeding on September 13, 2026. The production URL is https://samin110597-create.github.io/stock-truth-v2/web/. Data-provider or snapshot-publication failures do not block a tested application build. Source syntax, calculation tests, artifact checks and Pages deployment remain required gates.

Scheduled collection: `:17` and `:47`, 13:00–21:59 UTC weekdays, plus 22:17 UTC. Scheduling is best effort and can be delayed. U.S. calendar checks exclude holidays and incomplete candles. SEC facts are cached for 24 hours. Direct quote/history retrieval occurs when a ticker is entered or refreshed.

Optional repository secrets: `POLYGON_KEY` for a daily-bar fallback and `SEC_USER_AGENT` for an identified SEC client. The related legacy repository's Finnhub/Twelve/FMP/Polygon/Alpha Vantage secret names were identified, but secrets are repository-scoped and were not copied, exposed or assumed present here.

## Standalone Q-State Quant Terminal

The quant terminal is a **separate application** at `/quant/`. It does not reuse the classic terminal HTML, CSS, provider router, technical engine, structure/reversal engine, or setup engine. It shares only sanitized market-data snapshots, the bundled chart library, and deployment infrastructure.

Its independent engine now includes Q-State 2.0 walk-forward calibration: causal price/volume features are trained separately by timeframe and horizon, probabilities are promoted only when out-of-sample Brier/log-loss gates pass, and validated conditional return bands replace Monte Carlo targets when available. The runtime also uses confirmed multi-scale structure, state-filtered velocity/acceleration, multi-timeframe execution alignment, entropy/Hurst/cycle context, volatility/compression, execution levels and explicit WATCH/DEVELOPING/READY states. API credentials remain GitHub Actions secrets and are never entered into the browser.

See `documentation/QUANT_LAB.md` for the standalone architecture and integrity rules.

## Documentation and rollback

See `documentation/AUDIT.md`, `documentation/ACCEPTANCE.md`, `documentation/SOURCES.md` and generated `data-snapshots:validation-report.json`.

Rollback point: branch `rollback/pre-github-only-terminal-20260911`, commit `97cffb64256521e8283ec3763836461db4eeabde`. Prefer reverting the implementation PR through a new reviewed PR; reverting to the original commit also restores its known Vercel-dependent architecture, so it is an archival rollback, not a GitHub-only production solution.


## Arbitrary stock / ETF on-demand mode

GitHub Pages is static and cannot read GitHub Actions secrets during an interactive ticker search. Q-State therefore uses a separate **Hugging Face Gradio ZeroGPU Space** under `backend/hf-space/`.

When deployed, every stock/ETF search first calls the Space's Gradio API. The backend:
- accepts valid stock/ETF symbols rather than a configured watchlist
- keeps Massive/FMP/Finnhub/Alpha Vantage credentials as Hugging Face Space secrets
- rejects stale data
- uses secured providers first and server-side Yahoo as an independent fallback
- returns 15M/1H/4H/1D together
- supports Gold/Silver aliases server-side (`GOLD/GC/XAU` and `SILVER/SI/XAG`) without exposing credentials

The existing snapshot system remains fallback only.

The production Space ID is `Smit1105/qstate-market-api`, served from:
`https://smit1105-qstate-market-api.hf.space`.

To let GitHub Actions create/update that Space, add one repository secret:
- `HF_TOKEN` — a Hugging Face User Access Token with **write** permission for the `Smit1105` account. The deploy script creates the Space as a free-compatible Gradio `zero-a10g`/ZeroGPU Space rather than Docker/CPU Basic.

Existing market-data secrets remain unchanged. The deploy script copies those provider secrets into the Space's private secret store; values are never written to the Space source code or returned to the browser. After deployment, CI checks `/health` and probes AAPL through a secured provider before injecting the Space URL into `quant/runtime-config.json`.
