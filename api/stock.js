const UA = 'Mozilla/5.0 StockTruthV2/2.0 research-dashboard';

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=300, stale-while-revalidate=900' : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

function cleanSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9.^=-]{1,20}$/.test(s) ? s : null;
}

function nyDate(epochSeconds) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(epochSeconds * 1000));
  const m = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`provider returned HTTP ${r.status}`);
  return r.json();
}

async function yahooChart(symbol) {
  const u = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set('range', 'max');
  u.searchParams.set('interval', '1d');
  u.searchParams.set('includeAdjustedClose', 'true');
  u.searchParams.set('events', 'div,splits,capitalGains');
  const j = await fetchJson(u);
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description || 'ticker was not found');
  return result;
}

async function yahooContext(symbol) {
  const modules = [
    'calendarEvents','financialData','defaultKeyStatistics','summaryDetail',
    'earningsTrend','recommendationTrend','price','assetProfile'
  ].join(',');
  const urls = [
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`
  ];
  let last = null;
  for (const u of urls) {
    try {
      const j = await fetchJson(u);
      const r = j?.quoteSummary?.result?.[0];
      if (r) return { ok: true, data: r };
      last = j?.quoteSummary?.error?.description || 'empty quoteSummary response';
    } catch (e) {
      last = String(e?.message || e);
    }
  }
  return { ok: false, error: last || 'context provider unavailable', data: null };
}

function raw(x) {
  if (x == null) return null;
  if (typeof x === 'number' || typeof x === 'string') return x;
  if (typeof x === 'object' && x.raw != null) return x.raw;
  return null;
}

function makeBars(result) {
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
  const regular = result.meta?.currentTradingPeriod?.regular || {};
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const rawClose = Number(q.close?.[i]);
    const adjustedClose = Number(adj?.[i]);
    const o = Number(q.open?.[i]), h = Number(q.high?.[i]), l = Number(q.low?.[i]);
    if (![o, h, l, rawClose].every(Number.isFinite) || rawClose <= 0) continue;
    let factor = Number.isFinite(adjustedClose) && adjustedClose > 0 ? adjustedClose / rawClose : 1;
    if (!Number.isFinite(factor) || factor <= 0) factor = 1;
    out.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: o * factor,
      high: h * factor,
      low: l * factor,
      close: rawClose * factor,
      volume: Number.isFinite(Number(q.volume?.[i])) ? Number(q.volume[i]) : null
    });
  }
  // Never let an unfinished regular-session daily candle contaminate closed-bar signals.
  if (out.length && regular.start && regular.end && now < Number(regular.end) + 900) {
    const last = out[out.length - 1];
    if (last.date === nyDate(now)) out.pop();
  }
  return out;
}

function buildContext(ctx) {
  if (!ctx?.ok || !ctx.data) {
    return {
      status: 'UNAVAILABLE', reason: ctx?.error || 'provider unavailable',
      earnings: null, fundamentals: null, revisions: null, profile: null,
      backtest_policy: 'Not used in historical win-rate calculations without historical point-in-time snapshots.'
    };
  }
  const d = ctx.data;
  const ce = d.calendarEvents || {};
  const fd = d.financialData || {};
  const ks = d.defaultKeyStatistics || {};
  const sd = d.summaryDetail || {};
  const pr = d.price || {};
  const ap = d.assetProfile || {};
  const et = Array.isArray(d.earningsTrend?.trend) ? d.earningsTrend.trend : [];
  const dates = Array.isArray(ce.earnings?.earningsDate) ? ce.earnings.earningsDate.map(raw).filter(Number.isFinite) : [];
  const revisionRows = et.map(t => ({
    period: t.period || null,
    endDate: t.endDate || null,
    growth: raw(t.growth),
    epsEstimateAvg: raw(t.earningsEstimate?.avg),
    epsEstimateLow: raw(t.earningsEstimate?.low),
    epsEstimateHigh: raw(t.earningsEstimate?.high),
    epsTrendCurrent: raw(t.epsTrend?.current),
    epsTrend7dAgo: raw(t.epsTrend?.['7daysAgo']),
    epsTrend30dAgo: raw(t.epsTrend?.['30daysAgo']),
    epsTrend60dAgo: raw(t.epsTrend?.['60daysAgo']),
    epsTrend90dAgo: raw(t.epsTrend?.['90daysAgo']),
    upLast7d: raw(t.epsRevisions?.upLast7days),
    upLast30d: raw(t.epsRevisions?.upLast30days),
    downLast7d: raw(t.epsRevisions?.downLast7days),
    downLast30d: raw(t.epsRevisions?.downLast30days)
  }));
  return {
    status: 'CURRENT_SNAPSHOT_ONLY',
    profile: {
      name: pr.longName || pr.shortName || null,
      sector: ap.sector || null,
      industry: ap.industry || null,
      country: ap.country || null,
      exchange: pr.exchangeName || pr.fullExchangeName || null,
      quoteType: pr.quoteType || null,
      currency: pr.currency || null
    },
    earnings: {
      nextDates: dates.map(x => new Date(x * 1000).toISOString()),
      epsEstimateAverage: raw(ce.earnings?.earningsAverage),
      epsEstimateLow: raw(ce.earnings?.earningsLow),
      epsEstimateHigh: raw(ce.earnings?.earningsHigh),
      revenueEstimateAverage: raw(ce.earnings?.revenueAverage),
      revenueEstimateLow: raw(ce.earnings?.revenueLow),
      revenueEstimateHigh: raw(ce.earnings?.revenueHigh)
    },
    fundamentals: {
      marketCap: raw(pr.marketCap), enterpriseValue: raw(ks.enterpriseValue),
      trailingPE: raw(sd.trailingPE), forwardPE: raw(sd.forwardPE), priceToBook: raw(ks.priceToBook),
      pegRatio: raw(ks.pegRatio), profitMargins: raw(fd.profitMargins), operatingMargins: raw(fd.operatingMargins),
      grossMargins: raw(fd.grossMargins), returnOnEquity: raw(fd.returnOnEquity), returnOnAssets: raw(fd.returnOnAssets),
      revenueGrowth: raw(fd.revenueGrowth), earningsGrowth: raw(fd.earningsGrowth), earningsQuarterlyGrowth: raw(ks.earningsQuarterlyGrowth),
      freeCashflow: raw(fd.freeCashflow), operatingCashflow: raw(fd.operatingCashflow), totalCash: raw(fd.totalCash),
      totalDebt: raw(fd.totalDebt), debtToEquity: raw(fd.debtToEquity), currentRatio: raw(fd.currentRatio), quickRatio: raw(fd.quickRatio),
      sharesOutstanding: raw(ks.sharesOutstanding), floatShares: raw(ks.floatShares), heldPercentInstitutions: raw(ks.heldPercentInstitutions),
      beta: raw(ks.beta), dividendYield: raw(sd.dividendYield), payoutRatio: raw(sd.payoutRatio)
    },
    revisions: revisionRows,
    backtest_policy: 'Current Yahoo context is displayed as context only. It is excluded from historical win-rate and calibrated-probability metrics because using today’s snapshot in past dates would be look-ahead leakage.'
  };
}

function snapshot(result, bars, context) {
  const meta = result.meta || {};
  const symbol = String(meta.symbol || '').toUpperCase();
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const current = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? prev?.close);
  const px = Number.isFinite(current) && current > 0 ? current : last.close;
  const ch = Number.isFinite(previousClose) && previousClose > 0 ? px - previousClose : null;
  const firstDate = bars[0]?.date || null;
  const lastDate = last?.date || null;
  return {
    schema_version: 2,
    symbol,
    generated_at: new Date().toISOString(),
    quote: {
      source: 'yahoo-chart-server', current: px, change: ch,
      change_pct: ch != null && previousClose ? ch / previousClose * 100 : null,
      prev_close: previousClose, currency: meta.currency || null,
      exchange: meta.fullExchangeName || meta.exchangeName || meta.exchange || null,
      market_state: meta.marketState || null
    },
    candles: {
      source: 'yahoo-chart-server', adjustment_type: 'OHLC scaled by Adj Close/raw Close when adjusted close is available',
      closed_bars_only: true, bars
    },
    context: buildContext(context),
    data_quality: {
      range_requested: 'max', first_bar_date: firstDate, last_closed_bar_date: lastDate,
      bars_returned: bars.length, adjusted_prices: true, forming_daily_bar_excluded: true,
      weekly_monthly_policy: 'Derived from adjusted daily bars; historical signals may use only completed period bars whose period-end date is not after the signal date.'
    },
    warnings: [
      'Probabilities and win rates are historical research statistics, not guarantees of future direction.',
      'Current earnings/fundamental/revision snapshots are not included in historical accuracy metrics until filing-date/point-in-time history is available.'
    ]
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  const symbol = cleanSymbol(req.query?.symbol);
  if (!symbol) return send(res, 400, { error: 'Enter a valid ticker symbol.' });
  try {
    const [chart, context] = await Promise.all([yahooChart(symbol), yahooContext(symbol)]);
    const bars = makeBars(chart);
    if (bars.length < 120) return send(res, 422, { error: `Only ${bars.length} usable closed daily bars were found for ${symbol}; at least 120 are required.` });
    return send(res, 200, snapshot(chart, bars, context));
  } catch (err) {
    return send(res, 404, { symbol, error: String(err?.message || err) });
  }
};
