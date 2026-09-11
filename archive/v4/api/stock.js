const UA = 'Mozilla/5.0 StockTruthV2/3.0 research-dashboard';

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=180, stale-while-revalidate=600' : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}
function cleanSymbol(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9.^=-]{1,20}$/.test(s) ? s : null;
}
function nowISO(){ return new Date().toISOString(); }
function nyDate(epochSeconds) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(epochSeconds*1000));
  const m = Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
async function fetchJson(url) {
  const r = await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json'}});
  if(!r.ok) throw new Error(`provider returned HTTP ${r.status}`);
  return r.json();
}
function raw(x){
  if(x==null)return null;
  if(typeof x==='number'||typeof x==='string')return x;
  if(typeof x==='object'&&x.raw!=null)return x.raw;
  return null;
}
function num(x){const n=Number(raw(x));return Number.isFinite(n)?n:null;}
function div(a,b){const x=num(a),y=num(b);return x!=null&&y?x/y:null;}
function cagr(end,start,years){return end>0&&start>0&&years>0?Math.pow(end/start,1/years)-1:null;}

async function yahooChart(symbol){
  const u=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set('range','max');u.searchParams.set('interval','1d');u.searchParams.set('includeAdjustedClose','true');u.searchParams.set('events','div,splits,capitalGains');
  const j=await fetchJson(u);const r=j?.chart?.result?.[0];
  if(!r)throw new Error(j?.chart?.error?.description||'ticker was not found');
  return r;
}
async function yahooContext(symbol){
  const modules=[
    'calendarEvents','financialData','defaultKeyStatistics','summaryDetail','earningsTrend','recommendationTrend','price','assetProfile',
    'incomeStatementHistory','balanceSheetHistory','cashflowStatementHistory','earningsHistory','insiderTransactions'
  ].join(',');
  const urls=[
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`
  ];
  let last=null;
  for(const u of urls){
    try{const j=await fetchJson(u),r=j?.quoteSummary?.result?.[0];if(r)return{ok:true,data:r};last=j?.quoteSummary?.error?.description||'empty quoteSummary response';}
    catch(e){last=String(e?.message||e);}
  }
  return{ok:false,error:last||'context provider unavailable',data:null};
}
async function yahooNews(symbol){
  try{
    const u=new URL('https://query2.finance.yahoo.com/v1/finance/search');u.searchParams.set('q',symbol);u.searchParams.set('quotesCount','1');u.searchParams.set('newsCount','8');
    const j=await fetchJson(u);const rows=(j?.news||[]).filter(x=>x?.title).map(x=>({ts:num(x.providerPublishTime),headline:String(x.title).slice(0,220),source:x.publisher||'Yahoo',url:x.link||null}));
    return rows.length?{source:'yahoo-search-server',fetched_at:nowISO(),days:14,rows}:{source:'yahoo-search-server',fetched_at:nowISO(),error:'no recent news returned'};
  }catch(e){return{source:'yahoo-search-server',fetched_at:nowISO(),error:String(e?.message||e)};}
}
function makeBars(result){
  const ts=result.timestamp||[],q=result.indicators?.quote?.[0]||{},adj=result.indicators?.adjclose?.[0]?.adjclose||[],regular=result.meta?.currentTradingPeriod?.regular||{},now=Math.floor(Date.now()/1000),out=[];
  for(let i=0;i<ts.length;i++){
    const rc=Number(q.close?.[i]),ac=Number(adj?.[i]),o=Number(q.open?.[i]),h=Number(q.high?.[i]),l=Number(q.low?.[i]);
    if(![o,h,l,rc].every(Number.isFinite)||rc<=0)continue;
    let factor=Number.isFinite(ac)&&ac>0?ac/rc:1;if(!Number.isFinite(factor)||factor<=0)factor=1;
    out.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),open:o*factor,high:h*factor,low:l*factor,close:rc*factor,volume:Number.isFinite(Number(q.volume?.[i]))?Number(q.volume[i]):null});
  }
  if(out.length&&regular.start&&regular.end&&now<Number(regular.end)+900){const last=out[out.length-1];if(last.date===nyDate(now))out.pop();}
  return out;
}
function yearlyStatements(d){
  const inc=d?.incomeStatementHistory?.incomeStatementHistory||[],bal=d?.balanceSheetHistory?.balanceSheetStatements||[],cf=d?.cashflowStatementHistory?.cashflowStatements||[];
  const byYear=(arr)=>new Map(arr.map(r=>[new Date(num(r.endDate)*1000).getUTCFullYear(),r]));
  const bm=byYear(bal),cm=byYear(cf),rows=[];
  for(const r of inc){
    const year=new Date(num(r.endDate)*1000).getUTCFullYear();if(!Number.isFinite(year))continue;
    const b=bm.get(year)||{},c=cm.get(year)||{};
    const revenue=num(r.totalRevenue),net=num(r.netIncome),gross=num(r.grossProfit),op=num(r.operatingIncome),ocf=num(c.totalCashFromOperatingActivities)??num(c.operatingCashFlow),capex=Math.abs(num(c.capitalExpenditures)??num(c.capitalExpenditure)??0),fcf=ocf!=null?ocf-capex:null;
    rows.push({year,revenue,net_income:net,fcf,gross:div(gross,revenue),op:div(op,revenue),net:div(net,revenue),equity:num(b.totalStockholderEquity),assets:num(b.totalAssets),debt:num(b.totalDebt)});
  }
  return rows.sort((a,b)=>a.year-b.year);
}
function richContext(ctx,symbol,meta){
  const at=nowISO();
  if(!ctx?.ok||!ctx.data){
    const err=ctx?.error||'Yahoo context unavailable';
    return{
      profile:{source:'yahoo-quoteSummary-server',fetched_at:at,error:err},
      fundamentals:{source:'yahoo-quoteSummary-server',fetched_at:at,error:err,attempts:[{source:'yahoo',error:err}]},
      analysts:{source:'yahoo-quoteSummary-server',fetched_at:at,error:err},earnings:{source:'yahoo-quoteSummary-server',fetched_at:at,error:err},
      extras:{source:'yahoo-quoteSummary-server',fetched_at:at,error:err},insiders:{source:'yahoo-quoteSummary-server',fetched_at:at,error:err},
      peers:{source:'none',fetched_at:at,error:'peer fundamentals not available from the current secure source'},context:{status:'UNAVAILABLE',reason:err}
    };
  }
  const d=ctx.data,pr=d.price||{},ap=d.assetProfile||{},fd=d.financialData||{},ks=d.defaultKeyStatistics||{},sd=d.summaryDetail||{},ce=d.calendarEvents||{};
  const annual=yearlyStatements(d),latest=annual.at(-1)||{},base=annual.length>1?annual.at(-2):null;
  const shares=num(ks.sharesOutstanding),eq=latest.equity,totalDebt=num(fd.totalDebt)??latest.debt,cash=num(fd.totalCash),revenue=num(fd.totalRevenue)??latest.revenue,fcf=num(fd.freeCashflow)??latest.fcf,netIncome=latest.net_income;
  const opMargin=num(fd.operatingMargins),grossMargin=num(fd.grossMargins),netMargin=num(fd.profitMargins),roe=num(fd.returnOnEquity),roa=num(fd.returnOnAssets);
  const profile={source:'yahoo-quoteSummary-server',fetched_at:at,name:pr.longName||pr.shortName||meta.longName||meta.shortName||symbol,industry:ap.industry||null,sector:ap.sector||null,exchange:pr.exchangeName||meta.fullExchangeName||meta.exchangeName||null,country:ap.country||null,mcap:num(pr.marketCap),web:ap.website||null};
  const fundamentals={
    source:'yahoo-quoteSummary-server',fetched_at:at,partial:annual.length<2,is_etf:String(pr.quoteType||meta.instrumentType||'').toUpperCase()==='ETF',name:profile.name,sector:ap.sector||null,industry:ap.industry||null,period:latest.year||null,years:annual.length||null,currency:pr.currency||meta.currency||null,mcap:num(pr.marketCap),shares,annual,
    revenue,net_income:netIncome,eps_ttm:num(ks.trailingEps),bvps:shares&&eq?eq/shares:null,fcf_latest:fcf,fcf_base:base?.fcf??fcf,dividend_ps:num(sd.dividendRate),
    rev_cagr_3y:annual.length>=4?cagr(latest.revenue,annual.at(-4)?.revenue,3):num(fd.revenueGrowth),rev_cagr_5y:annual.length>=6?cagr(latest.revenue,annual.at(-6)?.revenue,5):null,
    eps_cagr:annual.length>=4?cagr(Math.max(latest.net_income||0,0.0001),Math.max(annual.at(-4)?.net_income||0,0.0001),3):num(fd.earningsGrowth),fcf_cagr:annual.length>=4?cagr(Math.max(latest.fcf||0,0.0001),Math.max(annual.at(-4)?.fcf||0,0.0001),3):null,
    gross_margin:grossMargin,op_margin:opMargin,net_margin:netMargin,fcf_margin:revenue?fcf/revenue:null,roe,roa,roic:null,debt_to_equity:num(fd.debtToEquity)!=null?num(fd.debtToEquity)/100:div(totalDebt,eq),net_cash:cash!=null&&totalDebt!=null?cash-totalDebt:null,total_debt:totalDebt,cash,
    current_ratio:num(fd.currentRatio),quick_ratio:num(fd.quickRatio),interest_coverage:null,capex:annual.at(-1)&&num(annual.at(-1).fcf)!=null&&num(fd.operatingCashflow)!=null?Math.max(0,num(fd.operatingCashflow)-annual.at(-1).fcf):null,ocf:num(fd.operatingCashflow),buyback:null,
    pe:num(sd.trailingPE),forward_pe:num(fd.forwardPE),pb:num(ks.priceToBook),ps:num(sd.priceToSalesTrailing12Months),peg:num(ks.pegRatio),ev_ebitda:num(ks.enterpriseToEbitda),
    attempts:[],note:'Yahoo current fundamentals plus available annual statement history. Missing fields remain unavailable rather than estimated.'
  };
  const trends=Array.isArray(d.recommendationTrend?.trend)?d.recommendationTrend.trend.map(t=>({period:t.period,strongBuy:num(t.strongBuy),buy:num(t.buy),hold:num(t.hold),sell:num(t.sell),strongSell:num(t.strongSell)})):[];
  const analysts=trends.length?{source:'yahoo-quoteSummary-server',fetched_at:at,trends}:{source:'yahoo-quoteSummary-server',fetched_at:at,error:'no analyst recommendation trend returned'};
  const hist=Array.isArray(d.earningsHistory?.history)?d.earningsHistory.history:[];
  const erows=hist.slice(0,8).map(r=>{const act=num(r.epsActual),est=num(r.epsEstimate),sur=num(r.surprisePercent);return{period:num(r.quarter)?new Date(num(r.quarter)*1000).toISOString().slice(0,10):null,reported:num(r.quarter)?new Date(num(r.quarter)*1000).toISOString().slice(0,10):null,est,act,surprise:sur!=null?sur*100:(act!=null&&est?((act-est)/Math.abs(est))*100:null)};});
  const scored=erows.filter(r=>r.surprise!=null),dates=Array.isArray(ce.earnings?.earningsDate)?ce.earnings.earningsDate.map(num).filter(Number.isFinite):[];
  const earnings=erows.length?{source:'yahoo-quoteSummary-server',fetched_at:at,rows:erows,beats:scored.filter(r=>r.surprise>0).length,scored:scored.length,avg_surprise:scored.length?scored.reduce((s,r)=>s+r.surprise,0)/scored.length:null,next_dates:dates.map(x=>new Date(x*1000).toISOString())}:{source:'yahoo-quoteSummary-server',fetched_at:at,error:'historical earnings-vs-estimates not returned'};
  const extras={source:'yahoo-quoteSummary-server',fetched_at:at,analyst_target_mean:num(fd.targetMeanPrice),analyst_target_low:num(fd.targetLowPrice),analyst_target_high:num(fd.targetHighPrice),analyst_count:num(fd.numberOfAnalystOpinions),recommendation:fd.recommendationKey||null,short_pct_float:num(ks.shortPercentOfFloat),institutions_pct:num(ks.heldPercentInstitutions),insiders_pct:num(ks.heldPercentInsiders),next_earnings:dates[0]||null,beta:num(ks.beta)};
  const tx=Array.isArray(d.insiderTransactions?.transactions)?d.insiderTransactions.transactions:[];let buys=0,sells=0,net=0;const recent=[];
  for(const r of tx.slice(0,30)){const sh=num(r.shares);if(sh==null)continue;const txt=String(r.transactionText||'').toLowerCase(),dir=txt.includes('sale')||txt.includes('sell')?-1:1;dir>0?buys++:sells++;net+=dir*Math.abs(sh);if(recent.length<5)recent.push({name:r.filerName||null,date:num(r.startDate)?new Date(num(r.startDate)*1000).toISOString().slice(0,10):null,change:dir*Math.abs(sh),price:num(r.value)&&sh?num(r.value)/Math.abs(sh):null});}
  const insiders=tx.length?{source:'yahoo-quoteSummary-server',fetched_at:at,buys,sells,net_shares:net,months:6,recent}:{source:'yahoo-quoteSummary-server',fetched_at:at,error:'no insider transaction detail returned'};
  const et=Array.isArray(d.earningsTrend?.trend)?d.earningsTrend.trend:[];
  const revisions=et.map(t=>({period:t.period||null,endDate:t.endDate||null,growth:num(t.growth),epsEstimateAvg:num(t.earningsEstimate?.avg),epsTrendCurrent:num(t.epsTrend?.current),epsTrend7dAgo:num(t.epsTrend?.['7daysAgo']),epsTrend30dAgo:num(t.epsTrend?.['30daysAgo']),epsTrend60dAgo:num(t.epsTrend?.['60daysAgo']),epsTrend90dAgo:num(t.epsTrend?.['90daysAgo']),upLast7d:num(t.epsRevisions?.upLast7days),upLast30d:num(t.epsRevisions?.upLast30days),downLast7d:num(t.epsRevisions?.downLast7days),downLast30d:num(t.epsRevisions?.downLast30days)}));
  return{profile,fundamentals,analysts,earnings,extras,insiders,peers:{source:'none',fetched_at:at,error:'peer fundamentals are not yet available from the secure any-ticker backend'},context:{status:'CURRENT_SNAPSHOT_ONLY',profile,earnings:{nextDates:dates.map(x=>new Date(x*1000).toISOString())},fundamentals,revisions,backtest_policy:'Current fundamentals/revisions are displayed but excluded from historical win-rate metrics unless a filing-date/point-in-time series exists.'}};
}
function snapshot(result,bars,ctx,news){
  const meta=result.meta||{},symbol=String(meta.symbol||'').toUpperCase(),last=bars.at(-1),prev=bars.at(-2),current=Number(meta.regularMarketPrice),previousClose=Number(meta.chartPreviousClose??meta.previousClose??prev?.close),px=Number.isFinite(current)&&current>0?current:last.close,ch=Number.isFinite(previousClose)&&previousClose>0?px-previousClose:null,at=nowISO();
  const rich=richContext(ctx,symbol,meta);
  return{
    schema_version:3,symbol,generated_at:at,timeframe:'1day',direct:false,
    quote:{source:'yahoo-chart-server',fetched_at:at,current:px,change:ch,change_pct:ch!=null&&previousClose?ch/previousClose*100:null,high:num(meta.regularMarketDayHigh),low:num(meta.regularMarketDayLow),open:num(meta.regularMarketOpen),prev_close:previousClose,ts:Math.floor(Date.now()/1000),currency:meta.currency||null},
    profile:rich.profile,
    candles:{source:'yahoo-chart-server',fetched_at:at,bars,n:bars.length,interval:'1day',latest:last?.date||null,adjustment_type:'OHLC scaled by Adj Close/raw Close',closed_bars_only:true,cross_check:null,confidence:'MEDIUM'},
    daily:{source:'yahoo-chart-server',fetched_at:at,bars},fundamentals:rich.fundamentals,analysts:rich.analysts,earnings:rich.earnings,peers:rich.peers,news,insiders:rich.insiders,extras:rich.extras,context:rich.context,
    data_quality:{range_requested:'max',first_bar_date:bars[0]?.date||null,last_closed_bar_date:last?.date||null,bars_returned:bars.length,adjusted_prices:true,forming_daily_bar_excluded:true},
    warnings:['Current fundamentals and revision snapshots are not treated as historical evidence unless they have point-in-time dates.','A missing source remains unavailable; the backend does not fabricate substitute values.']
  };
}
module.exports=async function handler(req,res){
  if(req.method==='OPTIONS')return send(res,200,{ok:true});if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const symbol=cleanSymbol(req.query?.symbol);if(!symbol)return send(res,400,{error:'Enter a valid ticker symbol.'});
  try{
    const [chart,ctx,news]=await Promise.all([yahooChart(symbol),yahooContext(symbol),yahooNews(symbol)]),bars=makeBars(chart);
    if(bars.length<120)return send(res,422,{error:`Only ${bars.length} usable closed daily bars were found for ${symbol}; at least 120 are required for the full technical terminal.`});
    return send(res,200,snapshot(chart,bars,ctx,news));
  }catch(err){return send(res,404,{symbol,error:String(err?.message||err)});}
};