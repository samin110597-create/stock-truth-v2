const UA = 'Mozilla/5.0 StockTruthV2/1.0 research-dashboard';

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
  return /^[A-Z0-9.^=-]{1,15}$/.test(s) ? s : null;
}

function nyDate(epochSeconds) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(epochSeconds * 1000));
}

async function yahooChart(symbol) {
  const u = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set('range', '10y');
  u.searchParams.set('interval', '1d');
  u.searchParams.set('includeAdjustedClose', 'true');
  u.searchParams.set('events', 'div,splits');
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`market data provider returned HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(j?.chart?.error?.description || 'ticker was not found');
  return result;
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
  // Do not let an unfinished regular-session candle contaminate daily signals.
  if (out.length && regular.start && regular.end && now < Number(regular.end) + 900) {
    const last = out[out.length - 1];
    if (last.date === nyDate(now)) out.pop();
  }
  return out;
}

function snapshot(result, bars) {
  const meta = result.meta || {};
  const symbol = String(meta.symbol || '').toUpperCase();
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const current = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? prev?.close);
  const px = Number.isFinite(current) && current > 0 ? current : last.close;
  const ch = Number.isFinite(previousClose) && previousClose > 0 ? px - previousClose : null;
  return {
    symbol,
    generated_at: new Date().toISOString(),
    quote: {
      current: px,
      change: ch,
      change_pct: ch != null ? ch / previousClose * 100 : null,
      prev_close: Number.isFinite(previousClose) ? previousClose : null,
      currency: meta.currency || null,
      market_state: meta.marketState || null
    },
    profile: {
      name: meta.longName || meta.shortName || meta.symbol || symbol,
      exchange: meta.fullExchangeName || meta.exchangeName || meta.exchange || null,
      instrument_type: meta.instrumentType || null,
      timezone: meta.exchangeTimezoneName || null
    },
    bars
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  const symbol = cleanSymbol(req.query?.symbol);
  if (!symbol) return send(res, 400, { error: 'Enter a valid ticker symbol.' });

  try {
    const [assetResult, spyResult] = await Promise.all([
      yahooChart(symbol),
      symbol === 'SPY' ? Promise.resolve(null) : yahooChart('SPY')
    ]);
    const bars = makeBars(assetResult);
    const spyBars = symbol === 'SPY' ? bars : makeBars(spyResult);
    if (bars.length < 260) {
      return send(res, 422, { error: `Only ${bars.length} usable daily bars were found for ${symbol}; at least 260 are required.` });
    }
    const asset = snapshot(assetResult, bars);
    return send(res, 200, {
      schema_version: 2,
      generated_at: new Date().toISOString(),
      source: 'server-side Yahoo chart endpoint',
      closed_bars_only: true,
      adjusted_prices: true,
      asset,
      benchmark: { symbol: 'SPY', bars: spyBars },
      data_quality: {
        history_years_requested: 10,
        asset_bars: bars.length,
        benchmark_bars: spyBars.length,
        adjustment: 'OHLC scaled by Adj Close / raw Close when available',
        forming_daily_bar_excluded: true
      },
      warnings: [
        'On-demand v2 prioritizes price, trend, momentum, volatility, volume and benchmark-relative evidence.',
        'Historical hit rates are research diagnostics, not guarantees of future returns.'
      ]
    });
  } catch (err) {
    return send(res, 404, { symbol, error: String(err?.message || err) });
  }
};
