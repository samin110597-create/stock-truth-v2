# Providers, references and licenses

## Active routes

| Route | Role | Constraints |
|---|---|---|
| Stock Analysis public quote/history JSON | Direct browser arbitrary stock/ETF quote and OHLCV history | Unofficial; wildcard CORS and successful direct NVDA retrieval were observed on the live GitHub Pages page on September 13, 2026. Release-specific unseen-ticker acceptance is recorded separately. No key, authentication cookie, proxy, or paywall bypass. Provider latency and split methodology are not declared by the endpoint. |
| Yahoo Finance chart | Optional Actions daily, hourly, 5-minute history and quote metadata | Unofficial, rate-limited, no uptime guarantee. Public browser CORS was absent in the HTTP probe, so it is not falsely claimed as a browser API. |
| SEC EDGAR companyfacts | Official reported fundamentals from Actions | Depends on SEC availability and access. Filing dates preserved. Browser CORS availability is not assumed. |
| Polygon aggregates | Optional daily-history fallback | Requires repository secret POLYGON_KEY and entitlement. Not assumed configured. No key reaches public artifacts. |
| exchange_calendars XNYS | Session schedule calculation | Scheduled sessions/holidays/early closes; unscheduled exchange halts are not known. |

Stock Analysis's supported product is its website, not an official developer API. The browser adapter is a best-effort personal research integration. The application references its source and does not copy premium financial statements, news content, or the provider website. Availability or reuse of data for a commercial/public data service must not be inferred from a successful HTTP request.

Provider references:
- https://stockanalysis.com/data-sources/
- https://stockanalysis.com/terms-of-use/
- https://stockanalysis.com/help/
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://github.com/ranaroussi/yfinance (Yahoo public-endpoint background; library not incorporated)

## Components evaluated

| Project | Decision |
|---|---|
| tradingview/lightweight-charts | Incorporated version 5.2.1, pinned in package-lock; Apache-2.0 LICENSE and upstream NOTICE distributed; chart attribution/link included. |
| gerrymanoim/exchange_calendars | Incorporated version 4.13.2 in Actions/collection for exchange sessions. |
| OpenBB-finance/OpenBB | Evaluated as a provider-abstraction reference. Not imported: its backend platform/dependency set does not satisfy a static arbitrary-ticker browser architecture by itself. |
| polakowo/vectorbt | Evaluated as a backtesting reference. Not incorporated: Apache 2.0 with Commons Clause is not an unrestricted permissive dependency; a small inspectable barrier replay better matches this release. |
| bukosabino/ta | Evaluated as a technical indicator reference. Not imported into browser; the production calculations use inspectable JavaScript with explicit null/warmup rules. |

No proprietary TradingView indicators, charting-library bundle, or Pine Script was copied.

## GitHub hosting references

- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

GitHub Pages serves static assets. Schedules may be delayed; a committed build is not evidence of a successful live deployment. The workflow checks the deployed build SHA before reporting its HTTP verification stage.

## September 13 source reconciliation

The scheduled Yahoo history contained an invalid trailing September 11 daily row. The browser source returned valid OHLCV for that session. The revised adapter retains the older history only after checking all four OHLC prices on at least ten overlapping dates (up to twenty), with maximum 0.5% deviation. Up to five recent completed sessions can be appended, with the exact provider retained on every row. No ratio is applied to prices or volume. Missing interior sessions, unmatched rejected rows and unresolved split audits reject the supplement.

`refresh-daily.mjs` uses the same adapter in scheduled jobs, so scans receive the same checks as interactive analysis. Cache reads, quote failures and unsupported fundamentals never prevent an independently available daily history from being analyzed.
