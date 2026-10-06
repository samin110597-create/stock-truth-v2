# Data reliability and gateway activation

Production HTML stays on GitHub Pages. Deno is no longer a runtime dependency.
Any ticker can request public daily history, a quote, and fundamentals immediately,
without adding it to a repository or waiting for a scheduled workflow. Public
endpoints are unofficial and may change or rate-limit; they are fallbacks, not an
uptime promise. Insufficient or unavailable components are labelled explicitly.

## Optional secure gateway (one-time account setup)

1. In a free Cloudflare account, enable Workers and its workers.dev subdomain.
2. Create a token restricted to that account with **Workers Scripts: Edit**.
3. In this repository's Settings → Secrets and variables → Actions, add
   `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as repository secrets.
4. Run **Stock Truth — validate, collect, and deploy GitHub Pages** from Actions.

The workflow deploys `gateway/worker.mjs`, securely supplies the existing Finnhub,
FMP and Massive/Polygon keys, verifies `/health`, and writes the public endpoint
into the Pages runtime configuration. No private key is bundled into HTML. Without
Cloudflare credentials, Pages still deploys with independent public data retrieval.
The workflow summary says explicitly whether the gateway was activated.
No paid plan or billable resource is created by the deployment script.

## Resource controls

- Price refresh defaults to 15 minutes; manual and hourly refresh are available.
- Background tabs do not auto-fetch; quote refresh never reruns model training or history.
- Gateway quotes cache 60 seconds, intraday history 5 minutes, daily history 15 minutes.
- Requests for the same ticker are coalesced within a Worker isolate.
- Providers have bounded timeouts and a 60-second failure cooldown; browser routes
  have a 90-second cooldown after an outage.
- Per-IP and provider request budgets are best-effort within each Worker isolate.
  They are **not global quotas or authentication**. CORS is not access control.
  A configured `REQUEST_LIMITER` binding additionally enables Cloudflare rate limiting.
- Cloudflare's free daily cap and provider quotas can still be reached. The browser
  then uses independent sources and clearly labels saved/older observations.

## Integrity

Market-event time, retrieval time and analysis time are separate, in Eastern Time.
Recent timestamps are not a claim of consolidated exchange real-time entitlement.
Completed bars exclude the current unfinished candle. Stale/review history blocks
trade-ready recommendations and new forecast issuance. Intraday unavailability can
fall back to daily analysis, explicitly labelled as daily. Each ticker change clears
prior state and aborts old requests. Fundamentals failures do not block technicals.

## Remaining limitations

Direct public US stock/ETF coverage and history depth vary. Exchange intraday access
depends on provider entitlements. Futures snapshots and ETF proxies are labelled;
no ETF price is represented as a gold/silver futures quote. There is no promise of
uninterrupted free market data or of forecast accuracy.
