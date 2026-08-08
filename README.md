# Stock Truth v2

Independent research dashboard for **on-demand ticker analysis**. It is intentionally separate from the original `stock-truth` repository.

## What v2 does

- Accepts Yahoo-style ticker symbols such as `AAPL`, `MSFT`, `BRK-B`, `SHOP.TO`, `SPY`, and `^GSPC`.
- Fetches market history through a server-side Vercel function instead of exposing an API key in the browser.
- Requests up to 10 years of daily history when available.
- Uses adjusted OHLC values when adjusted-close factors are available.
- Excludes a forming regular-session daily candle from signal calculations.
- Compares the asset with SPY for market-regime and relative-strength context.
- Replays a fixed evidence score through history and reports 5-session and 21-session hit rate, naive baseline, edge, coverage, sample size, and a 95% Wilson lower bound.
- Allows **NO VERIFIED EDGE** instead of forcing a bullish/bearish claim.

## Validation gate

A historical thesis is only marked `VERIFIED EDGE` when the tested horizon has at least 80 historical calls, hit rate >= 55%, edge over the naive direction-frequency baseline >= 3 percentage points, and the 95% Wilson lower confidence bound is above 50%.

This deliberately favors precision over constant predictions: neutral periods are skipped rather than counted as artificial wins.

## Accuracy roadmap

The next model layer should be accepted only if it improves unseen-data performance. Planned candidates include pooled cross-ticker training, market/sector regime features, earnings-event proximity, point-in-time fundamental changes, volatility/breadth features, calibrated probabilities, purged/embargoed walk-forward validation, and feature-ablation/stability tests.

The dashboard is a research tool, not a guarantee of future market direction or personalized financial advice.
