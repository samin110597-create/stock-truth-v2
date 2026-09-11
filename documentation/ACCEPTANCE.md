# Release acceptance record

## Passed locally

- Twelve targeted integrity tests: null handling, EMA warmup, flat/rising/falling RSI, invalid/forming/duplicate OHLCV rejection, zero volume/range, causal pivot extension, conservative stop/target collisions, entry-bar ordering, opening gaps, short-side barriers, incomplete provider candles, unrestricted ticker validation and Wilson intervals.
- Fresh Yahoo datasets collected for NVDA, MU, VRT, CRWV, CIFR, SNDK, GOOG, META, AVGO, MRVL, SPY and additional benchmarks.
- Complete analysis processed for 16 securities, with finite-number and stop/target orientation gates.
- Static production checks ensure no Vercel endpoint or executable remote-code loader in the deployed source; pinned local chart bundle and visible model/build identity.

## Unseen-ticker acceptance — pending browser verification

TXRH is not in the scan watchlist or collected snapshot universe. Public HTTP probes retrieved TXRH quote identity and 128 daily-history rows, including the current forming row. Those are real returned values, not a stored demonstration dataset. A successful HTTP probe is not yet proof of browser behavior.

Required final browser sequence:
1. Open the actual Pages terminal and analyze NVDA.
2. Enter TXRH without changing repository/config/data.
3. Verify TXRH source identity, chart candles, newly computed indicators, structure and ticker-specific thesis.
4. Verify unavailable fundamentals/intraday degrade independently.
5. Switch rapidly between different tickers and verify late responses cannot replace the active ticker.
6. Enter an invalid/nonexistent ticker and ensure prior quote/chart/setup are cleared.

The cloud browser could not open the local loopback preview (`ERR_BLOCKED_BY_CLIENT`). It must inspect the real GitHub Pages URL after deployment. No browser safety restriction was disabled to work around this.

## Pending gates

- GitHub PR checks and integration.
- GitHub Pages enablement if still disabled.
- Deployed build SHA and real-page inspection.
- Unseen-ticker browser acceptance above.

Until those pass, status is **CODED / LOCALLY VALIDATED**, not **LIVE + VERIFIED**.
