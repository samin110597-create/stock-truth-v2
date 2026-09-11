# Audit and migration record — 2026-09-11

Audited primary head: `samin110597-create/stock-truth-v2@97cffb64256521e8283ec3763836461db4eeabde`.
Related legacy head: `samin110597-create/stock-truth@426cade2fcc50be4520217a4f1b6591e2e11a157`.

The recursive inventory covers 64 primary and 36 legacy files, including every tracked API, model generation, workflow, root/docs duplicate, data artifact and static page. The inventory records hashes, line counts, URLs, function names and risk-pattern findings. The rollback branches and the divergent institutional-live-upgrade branch were also inspected. Static inventory is not a claim that every legacy heuristic is statistically validated.

| Finding | Impact | Implemented disposition |
|---|---|---|
| Pages run 34612497411 built and committed docs, then configure-pages failed with Not Found / Resource not accessible by integration | No working Pages deployment; the public page returned 404 | One tested artifact workflow; Pages enablement remains a setting owned by the account |
| github-pages workflow fetched legacy original-stock-truth and patched giant HTML with string replacements | Fragile source identity; newer root files did not prove production behavior | Versioned explicit modules and build manifest, no live cross-repository build dependency |
| Built Pages page called stock-truth-v2.vercel.app/api/stock-v5 | Violated GitHub-only requirement | Browser provider adapters plus optional GitHub Actions snapshots |
| v4-bootstrap used fetch + eval; v3 precision nested loaders still fetched raw main JavaScript | Runtime model could change outside the deployed artifact | No eval or dynamic executable downloads; legacy chain archived |
| Many patch layers rewrote compute/render and model labels | Multiple competing active versions | One model successor with explicit named imports and visible commit/version |
| V4 analogue samples overlapped, trade parameters used small analogue holdouts, ambiguous outcomes were excluded | Displayed target statistics could overstate evidence | Conservative fixed-rule non-overlap replay; calibrated probabilities withheld |
| V3 structure/pattern layers embedded numerical heuristic confidences and fallback ATR targets | Confidence percentages and targets could look more evidenced than they were | Evidence-family scores; structure-based targets; missing targets remain unavailable |
| Original SEC helper converted null with Number, defaulted missing capex to zero, assumed a 21% tax rate, called annual EPS eps_ttm and mixed fiscal periods by calendar year | False FCF, ROIC and TTM labels | New exact-period filed-fact extractor; no missing-input imputation; annual EPS labeled correctly |
| Provider adjustment paths mixed total-return adjustments and split heuristics | Different price bases could affect support and targets | Use entire provider OHLCV series; no guessed second split adjustment; discontinuities trigger review |
| Legacy collector has configured provider names and useful optional snapshots | Existing secure collection architecture can be retained conceptually | Reused the GitHub Actions secret/snapshot pattern; did not copy secret values or old computed metrics |
| Fixed watchlist would block an unseen ticker | Violates the corrected core product requirement | Every input attempts direct public retrieval; no membership gate; independent failure handling |

## What was retained and consolidated

V3's completed-bar indicators, Wilder smoothing, confirmed structure, same-slot RVOL, proxy terminology and source transparency informed the explicit technical/structure/proxy modules. V4's multi-horizon organization and separation of direction versus barrier statistics informed the swing/position plans and validation panel. Reusable concepts were rewritten as pure modules with testable inputs; the old dynamic DOM patch stack is not executed.

SEC integration remains filing-first. Market context keeps SPY/QQQ comparisons. The new chart retains structure, overlays, entry, stop and targets with candle-time coordinates. The old hedge/pattern/Elliott/probability layers remain archived: their unsupported precision and dependency chain were not silently relabeled as verified production features.

## Explicit remaining limitations

The browser public history provider is unofficial, may limit history depth, and does not declare its adjustment methodology. That uncertainty is visible. New tickers can therefore have short history, missing intraday/fundamentals and insufficient validation. A ticker is not added to the scan universe merely by searching for it.

This release does not include order-book data, institutional transaction proof, dark pools, options flows, sentiment/breadth feeds, a calibrated direction model, prospective statistically verified edge, or simulated replacements for any of those fields.
