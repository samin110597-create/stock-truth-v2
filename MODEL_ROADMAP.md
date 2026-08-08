# Stock Truth v2 — Accuracy Roadmap

## Baseline to beat

The original four-ticker per-symbol model produced about 57.27% raw directional accuracy across the available 5-session and 21-session out-of-sample predictions, but the naive historical class-frequency baseline was about 57.29% and combined balanced accuracy was about 50.06%. That means the original model did not demonstrate a reliable directional edge.

V2 treats that result as the baseline. No future model should be promoted merely because its raw accuracy is higher.

## Promotion metrics

Every candidate model must be evaluated chronologically and compared with simple baselines. At minimum report:

- out-of-sample sample count
- coverage: percentage of eligible observations on which the model actually makes a directional call
- directional hit rate
- balanced accuracy
- ROC AUC
- Brier score and Brier skill against historical prevalence
- log loss
- 95% confidence interval / Wilson lower bound for directional calls
- return MAE for any return forecast
- results by market regime and by ticker, not only one aggregate number

## Precision-first policy

The objective is not to predict every day. A model may abstain and show `NO VERIFIED EDGE` when confidence is weak.

A higher conditional win rate is useful only when it comes with enough coverage and survives unseen-data testing. V2 therefore tracks both precision and coverage.

## Candidate improvements

### 1. More and cleaner history

- use split/dividend-adjusted prices consistently
- keep the forming daily candle out of training and testing
- request up to 10 years of history when available
- add exchange-calendar freshness checks
- require minimum history before long-window features are trusted

### 2. Cross-ticker pooled learning

Train a generic model on a broad liquid-stock universe instead of fitting a separate small model to each ticker. Generic normalized features can then be applied to a newly entered ticker.

Candidate inputs:

- 1/5/21/63/126-session returns
- distance from 20/50/100/200-day moving averages
- RSI / ATR / realized volatility
- volume ratio and volume z-score
- 63/126/252-session drawdown and range position
- SPY-relative returns, beta and correlation
- broad-market regime variables

The model must split by time so rows from a future date never influence earlier tests.

### 3. Regime-aware models

Evaluate separate behaviour in:

- broad-market uptrend vs downtrend
- low vs high volatility
- strong-trend vs sideways environments
- risk-on vs defensive conditions

A regime feature should only stay if ablation testing improves unseen-data metrics.

### 4. Sector-relative context

When reliable sector classification is available, compare the ticker with its sector ETF as well as SPY. Examples of useful normalized features are 21/63-session sector-relative strength and rolling beta/correlation.

### 5. Point-in-time fundamentals and revisions

Fundamental data must be point-in-time. Backtests may only use a value after its filing/acceptance date.

Potential features:

- revenue and EPS growth changes
- gross/operating margin trend
- free-cash-flow trend
- debt and dilution trend
- analyst estimate revisions over 30/60/90 days when a reliable source is available

No current-period value may be backfilled into an earlier historical observation.

### 6. Event proximity

Test whether forecast reliability changes around earnings and major scheduled events. If event periods are unstable, the model should lower confidence or abstain rather than force a prediction.

### 7. Model ensemble

Compare simple models under exactly the same folds before adding complexity:

- regularized logistic regression
- histogram gradient boosting
- random forest / extra trees
- carefully regularized boosted trees if dependencies permit

Keep an ensemble only if it improves out-of-sample probability quality and stability, not just in-sample accuracy.

### 8. Probability calibration

Calibration data must be independent of the data used to fit the underlying classifier. Compare sigmoid and isotonic calibration where sample size supports it. Report reliability by probability bin.

### 9. Purged / embargoed walk-forward testing

Forecast labels overlap for multi-session horizons. Use a gap/embargo at least as large as the forecast horizon between train and test windows, and keep all preprocessing inside each training fold.

### 10. Stability and ablation tests

For every new feature group:

1. run the baseline model
2. add only the candidate feature group
3. rerun the exact same chronological folds
4. compare accuracy, balanced accuracy, Brier skill, calibration and coverage
5. reject the feature group if improvement is small, unstable, concentrated in one ticker, or disappears in later folds

## Recommended promotion gate for a future ML model

A candidate should not be labeled `VERIFIED EDGE` unless it has adequate out-of-sample observations and shows persistent improvement over a naive baseline. A reasonable initial research gate is:

- at least 200 out-of-sample directional observations for the evaluated scope
- balanced accuracy >= 53%
- Brier skill >= 2%
- raw hit rate not worse than the naive baseline
- positive performance in more than one chronological test fold
- no single ticker or short period responsible for most of the improvement

These thresholds are research gates, not guarantees. They should be reviewed after a larger universe backtest without tuning them to the final holdout set.
