# Q-State on-demand market API

This Worker is the secure data bridge for the standalone `/quant/` terminal.

It exists because GitHub Pages is static: a browser page cannot safely read GitHub Actions secrets for an arbitrary ticker request.

## Endpoint

`GET /v1/market?symbol=AAPL&timeframe=1H`

Supported stock/ETF timeframes: `15M`, `1H`, `4H`, `1D`.

The Worker:
- validates the ticker
- queries secured market-data providers on demand
- cross-checks against a server-side public fallback
- rejects stale sources
- constructs regular-session 1H/4H bars from intraday data
- returns all available timeframes for multi-timeframe Q-State analysis
- never sends provider API keys to the browser

## Secrets

Set as Worker secrets, never plaintext vars:
- `MASSIVE_KEY`
- `FMP_API_KEY` (optional fallback)

GitHub Actions can deploy the Worker and sync these secrets from the existing repository secrets once `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured.

The deployed Worker URL is automatically injected into the GitHub Pages Quant runtime during the same build.
