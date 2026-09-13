# Release 5.1 acceptance record

## Local verification — September 13, 2026

- 22 integrity tests pass. New coverage includes multi-source OHLC agreement, legitimate trailing-row repair, rejection of interior gaps/split anomalies, calendar freshness, weekly causality, completed reaction candles, fixed-band entry gaps, post-signal stop/target checks, risk sizing, historical plan immutability and an uncached symbol whose quote source fails.
- Optional daily datasets for 31 real securities were reconciled using independently sourced recent candles. The model does not need these files to analyze another ticker.
- Real-history analysis is run for all 31 securities with finite-number and stop/target orientation gates. Sample sizes and conservative retrospective results are retained; this does not establish a verified edge.
- Production syntax, forbidden host/runtime-loader checks and the built Pages artifact are checked.
- The restored UI includes Verdict, Technicals, Fundamentals, Rank, Model lab and Sources; evidence panels, fixed trade matrix, local sizing and native indicator panes.

## Deployment and browser acceptance

The previously deployed 5.0 page was inspected live, and GitHub Pages is enabled. Release 5.1 still requires PR checks, merge, deployment, matching build identity, visual inspection and an unseen-ticker test before it can be called live and verified. These observations will be appended after the real page is tested.

The browser cannot access the local loopback preview. No browser access restriction is bypassed; visual acceptance uses the actual Pages deployment.
