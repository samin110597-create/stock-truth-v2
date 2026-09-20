# Stock Truth research release 5.2

This release extends the classic `/web/` terminal. The separate `/quant/` application remains independent. The 5.1 fixed setup rules and issued-plan identities remain unchanged; new research has its own version.

## Fundamentals

The former page depended on a successful scheduled SEC collection. SEC's company-facts service does not support browser CORS, and the direct ticker provider replaced collection failures with a generic unavailable state. The price provider now preserves those diagnostics. Financial retrieval runs independently of price retrieval, so a failed statement cannot block a chart or technical calculation.

The browser requests TGMCharts' documented, keyless, CORS-open summary and SEC-derived statement endpoints for the entered symbol. No watchlist membership or Action run is required. Requests validate ticker identity, time out independently and preserve missing components. Supported summaries include market cap, trailing and forward valuation ratios, margins, financial-health ratios, dividends and growth. These are provider calculations, not locally reconstructed SEC facts. Source update dates are visible; updates older than 72 hours are flagged. Forward P/E is explicitly an estimate.

Income and cash-flow facts use annual periods. Balance-sheet facts use quarterly snapshots. Each value retains its unit, period end, filing date, form, tag and accession. Values filed in the future are rejected. Annual free cash flow and margins require matching periods. Missing capex is not zero; annual EPS is not TTM or implicitly split adjusted. Present-day fundamentals never enter historical price tests. Local browser cache lasts one hour; optional Action caches refresh daily. Provider coverage is not universal: an unsupported company's fundamentals remain unavailable without disabling technical analysis.

Attribution and source contract: [TGMCharts developers](https://tgmcharts.com/developers), [OpenAPI specification](https://tgmcharts.com/api/v1/openapi.json). Official SEC limitation: [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). Free-tier attribution is displayed next to data; no private API key is sent to the browser.

## Wyckoff interpretation

A qualifying range uses 40 prior completed candles, at least two separated tests of each boundary, width between 2 and 12 ATR, and directional efficiency no greater than 0.4. Its boundaries freeze when established. Springs and upthrusts require a penetration and close back inside. A test requires a later, quieter boundary reaction. SOS/SOW requires a completed range break, candle spread at least prior ATR, and RVOL at least 1.15. LPS/LPSY is a quieter retest after that break. Three subsequent completed closes outside the boundary can advance the candidate to markup/markdown. Breached extremes invalidate their evidence. A range expires after 120 candles or a large displacement.

The phase labels describe a limited algorithmic interpretation, not a complete discretionary A–E count. No inventory, institutional transaction, or point-and-figure cause count is inferred. A displayed objective is one range-height extension and is labeled accordingly. [Method reference: Wyckoff Analytics](https://www.wyckoffanalytics.com/wyckoff-method/).

## Elliott scenarios

Confirmed pivots are reduced to alternating extremes separately at major and intermediate quality thresholds. Candidate impulses enforce partial wave-2 retracement, wave 3 beyond wave 1, non-overlapping wave 4, and wave 3 not shortest in a complete five-wave impulse. Ambiguous same-candle order, diagonals and truncated fifth waves are not modeled. Lower-degree subdivisions remain unverified.

Wave 3, wave 4, wave 5 and post-impulse corrective projections use explicitly displayed Fibonacci constructions and candle anchors. The primary and alternative counts use different swing degrees; no count is forced when the rules fail. Every bar after the anchor is checked for invalidation and prior target touches. A new anchor sequence creates a new hypothesis. These research objectives never replace issued trade-plan TPs. Optional native chart overlays stay attached to candle coordinates. [Impulse rules](https://www.elliottwave.com/waveopedia/impulse/) and [Fibonacci relationships](https://www.elliottwave.com/waveopedia/fibonacci-relationships/).

## Technical forecasting

The browser fits a regularized linear model independently for 1, 5, 21 and 63 trading sessions. Ten features describe EMA distance/alignment, RSI, MACD, momentum, candle body/close location and ATR. All features come from completed candles. Training uses at most 756 matured labels and at least 60, after a 50-bar warm-up. Standardization uses training rows only. Fixed ridge penalty is 12; test results do not tune it. The last training label ends before the forecast origin. Output is bounded to the training-return range.

Up to 40 chronological test windows per horizon do not overlap. Each refit only sees outcomes already matured at that origin. The page shows mean absolute return error versus no-change and historical-drift baselines, directional accuracy and actual sample counts. Twenty past test residuals are required for a 10th–90th percentile empirical scenario range. Sequential range coverage uses only earlier residuals to form each band. Historical baseline improvement requires at least 30 windows and lower error than both baselines; this is not a significance test or prospective edge claim.

Forecasts refit when new completed daily data is retrieved. Quotes between closes are separate context. Insufficient history suppresses the affected horizon. Reviewed OHLCV suppresses forecasts. Stale price dates remain visible and trading actions remain governed by the existing health gate. There is no calibrated direction probability. Overlapping training labels, adjusted-history revisions, regime changes and the small number of long-horizon test windows limit inference. Forecast returns exclude dividends, costs and execution constraints.

## Verification

Deterministic tests check causal features and label embargoes, non-overlapping evaluation windows, invalid Elliott counts and retired hypotheses, Wyckoff event timing and invalidation, missing/zero financial fields, future filing rejection, ticker identity and component failure isolation. The existing setup, calendar, source reconciliation and standalone-Quant gates also run. Live acceptance verifies the release identifier, actual financial panels, forecasts, native overlays and an uncached ticker without source edits.
