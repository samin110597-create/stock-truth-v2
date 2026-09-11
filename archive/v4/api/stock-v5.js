const {secFundamentals,withMarketPrice}=require('../lib/sec-fundamentals');
const UA='Mozilla/5.0 StockTruthV2/5.2 research-dashboard';
let YSESSION=null;
function send(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control',status===200?'s-maxage=180, stale-while-revalidate=600':'no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(obj));}
function clean(raw){const s=String(raw||'').trim().toUpperCase();return /^[A-Z0-9.^=-]{1,20}$/.test(s)?s:null;}
function n(v){if(v==null)return null;if(typeof v==='object'&&v.raw!=null)v=v.raw;const x=Number(v);return Number.isFinite(x)?x:null;}
function now(){return new Date().toISOString();}
function cookieFrom(r){try{const a=r.headers.getSetCookie?.();if(Array.isArray(a)&&a.length)return a.map(x=>x.split(';')[0]).join('; ');}catch{}const s=r.headers.get('set-cookie');if(!s)return'';return s.split(/,(?=[^;,]+=)/).map(x=>x.split(';')[0]).join('; ');}
async function getJson(url,headers={}){const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json',...headers},cache:'no-store'});if(!r.ok){const e=new Error(`provider returned HTTP ${r.status}`);e.status=r.status;throw e;}return r.json();}
async function yahooSession(){
  if(YSESSION&&Date.now()-YSESSION.at<20*60e3)return YSESSION;
  let cookie='';
  for(const u of ['https://fc.yahoo.com/','https://finance.yahoo.com/']){
    try{const r=await fetch(u,{headers:{'User-Agent':UA,'Accept':'text/html,*/*'},redirect:'manual',cache:'no-store'});cookie=cookieFrom(r)||cookie;if(cookie)break;}catch{}
  }
  let crumb='';
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{const r=await fetch(`https://${host}/v1/test/getcrumb`,{headers:{'User-Agent':UA,'Accept':'text/plain,*/*',...(cookie?{'Cookie':cookie}:{})},cache:'no-store'});cookie=cookieFrom(r)||cookie;if(r.ok){const t=(await r.text()).trim();if(t&&!t.startsWith('<')&&t.length<200){crumb=t;break;}}}catch{}
  }
  YSESSION={cookie,crumb,at:Date.now()};return YSESSION;
}
async function yahooJson(url){
  try{return await getJson(url);}catch(e){if(![401,403,429].includes(e.status))throw e;}
  const s=await yahooSession(),u=new URL(url);if(s.crumb)u.searchParams.set('crumb',s.crumb);
  return getJson(u.toString(),s.cookie?{'Cookie':s.cookie}:{});
}
async function yahooChart(symbol){const u=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);u.searchParams.set('range','max');u.searchParams.set('interval','1d');u.searchParams.set('includeAdjustedClose','true');u.searchParams.set('events','div,splits,capitalGains');const j=await yahooJson(u.toString());const r=j?.chart?.result?.[0];if(!r)throw new Error(j?.chart?.error?.description||'ticker not found');return r;}
async function yahooContext(symbol){
  const modules='calendarEvents,financialData,defaultKeyStatistics,summaryDetail,earningsTrend,recommendationTrend,price,assetProfile,earningsHistory,insiderTransactions,secFilings';
  let last=null;
  for(const host of ['query2.finance.yahoo.com','query1.finance.yahoo.com']){
    try{const j=await yahooJson(`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`);const r=j?.quoteSummary?.result?.[0];if(r)return r;last=j?.quoteSummary?.error?.description||'empty quoteSummary response';}catch(e){last=String(e?.message||e);}
  }
  return null;
}
async function yahooNews(symbol){try{const u=new URL('https://query2.finance.yahoo.com/v1/finance/search');u.searchParams.set('q',symbol);u.searchParams.set('quotesCount','1');u.searchParams.set('newsCount','8');const j=await yahooJson(u.toString());const rows=(j?.news||[]).filter(x=>x?.title).map(x=>({ts:n(x.providerPublishTime),headline:String(x.title).slice(0,220),source:x.publisher||'Yahoo',url:x.link||null}));return rows.length?{source:'yahoo-search-server',fetched_at:now(),days:14,rows}:{source:'yahoo-search-server',fetched_at:now(),partial:true,note:'no recent news returned',rows:[]};}catch(e){return{source:'yahoo-search-server',fetched_at:now(),partial:true,note:String(e?.message||e),rows:[]};}}
function nyDate(epochSeconds){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(epochSeconds*1000));const m=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;}
function makeBars(result){const ts=result.timestamp||[],q=result.indicators?.quote?.[0]||{},adj=result.indicators?.adjclose?.[0]?.adjclose||[],regular=result.meta?.currentTradingPeriod?.regular||{},t=Math.floor(Date.now()/1000),out=[];for(let i=0;i<ts.length;i++){const rc=Number(q.close?.[i]),ac=Number(adj?.[i]),o=Number(q.open?.[i]),h=Number(q.high?.[i]),l=Number(q.low?.[i]);if(![o,h,l,rc].every(Number.isFinite)||rc<=0)continue;let f=Number.isFinite(ac)&&ac>0?ac/rc:1;if(!Number.isFinite(f)||f<=0)f=1;out.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),open:o*f,high:h*f,low:l*f,close:rc*f,volume:Number.isFinite(Number(q.volume?.[i]))?Number(q.volume[i]):null});}if(out.length&&regular.end&&t<Number(regular.end)+900&&out.at(-1).date===nyDate(t))out.pop();return out;}
function extractCik(ctx){for(const r of (ctx?.secFilings?.filings||[])){for(const k of ['edgarUrl','url']){const m=String(r?.[k]||'').match(/\/data\/(\d+)\//);if(m)return m[1];}if(/^\d{1,10}$/.test(String(r?.cik||'')))return String(r.cik);}return null;}
function currentYahoo(ctx,meta,symbol){
  const at=now();
  if(!ctx){const profile={source:'yahoo-chart-server',fetched_at:at,name:meta.longName||meta.shortName||symbol,exchange:meta.fullExchangeName||meta.exchangeName||null,partial:true};return{profile,analysts:{source:'yahoo-context-server',fetched_at:at,partial:true,note:'current analyst context unavailable',trends:[]},earnings:{source:'yahoo-context-server',fetched_at:at,partial:true,note:'earnings history unavailable',rows:[],next_dates:[]},extras:{source:'yahoo-context-server',fetched_at:at,partial:true,note:'positioning context unavailable'},insiders:{source:'yahoo-context-server',fetched_at:at,partial:true,note:'insider context unavailable',recent:[]},revisions:[],fundamentals:{source:'yahoo-context-server',fetched_at:at,partial:true,error:'current fundamental context unavailable'}};}
  const pr=ctx.price||{},ap=ctx.assetProfile||{},fd=ctx.financialData||{},ks=ctx.defaultKeyStatistics||{},sd=ctx.summaryDetail||{},ce=ctx.calendarEvents||{};
  const profile={source:'yahoo-quoteSummary-server',fetched_at:at,name:pr.longName||pr.shortName||meta.longName||meta.shortName||symbol,industry:ap.industry||null,sector:ap.sector||null,exchange:pr.exchangeName||meta.fullExchangeName||meta.exchangeName||null,country:ap.country||null,mcap:n(pr.marketCap)};
  const tr=Array.isArray(ctx.recommendationTrend?.trend)?ctx.recommendationTrend.trend.map(t=>({period:t.period,strongBuy:n(t.strongBuy),buy:n(t.buy),hold:n(t.hold),sell:n(t.sell),strongSell:n(t.strongSell)})):[];
  let analysts;
  if(tr.length)analysts={source:'yahoo-recommendationTrend-server',fetched_at:at,trends:tr};
  else if(fd.recommendationKey||n(fd.recommendationMean)!=null||n(fd.numberOfAnalystOpinions)!=null)analysts={source:'yahoo-current-consensus-server',fetched_at:at,partial:true,trends:[],current:{recommendation:fd.recommendationKey||null,mean:n(fd.recommendationMean),analyst_count:n(fd.numberOfAnalystOpinions)},note:'current consensus available; monthly trend history not returned'};
  else analysts={source:'yahoo-context-server',fetched_at:at,partial:true,trends:[],note:'current analyst context unavailable'};
  const hist=Array.isArray(ctx.earningsHistory?.history)?ctx.earningsHistory.history:[];
  const rows=hist.slice(0,8).map(r=>({period:n(r.quarter)?new Date(n(r.quarter)*1000).toISOString().slice(0,10):null,reported:n(r.quarter)?new Date(n(r.quarter)*1000).toISOString().slice(0,10):null,est:n(r.epsEstimate),act:n(r.epsActual),surprise:n(r.surprisePercent)!=null?n(r.surprisePercent)*100:null}));
  const dates=Array.isArray(ce.earnings?.earningsDate)?ce.earnings.earningsDate.map(n).filter(Number.isFinite):[];
  const earnings=rows.length?{source:'yahoo-earningsHistory-server',fetched_at:at,rows,next_dates:dates.map(x=>new Date(x*1000).toISOString())}:{source:'yahoo-calendar-server',fetched_at:at,partial:true,rows:[],next_dates:dates.map(x=>new Date(x*1000).toISOString()),note:dates.length?'next earnings date available; historical EPS surprises not returned':'earnings history unavailable'};
  const extras={source:'yahoo-positioning-server',fetched_at:at,analyst_target_mean:n(fd.targetMeanPrice),analyst_target_low:n(fd.targetLowPrice),analyst_target_high:n(fd.targetHighPrice),analyst_count:n(fd.numberOfAnalystOpinions),recommendation:fd.recommendationKey||null,short_pct_float:n(ks.shortPercentOfFloat),institutions_pct:n(ks.heldPercentInstitutions),insiders_pct:n(ks.heldPercentInsiders),next_earnings:dates[0]||null,beta:n(ks.beta)};
  const extraVals=['analyst_target_mean','short_pct_float','institutions_pct','insiders_pct','beta'].filter(k=>extras[k]!=null);if(!extraVals.length){extras.partial=true;extras.note='positioning fields not returned for this security';}else if(extraVals.length<5){extras.partial=true;extras.note='some positioning fields are unavailable';}
  const tx=Array.isArray(ctx.insiderTransactions?.transactions)?ctx.insiderTransactions.transactions:[];
  const insiders=tx.length?{source:'yahoo-insiderTransactions-server',fetched_at:at,recent:tx.slice(0,8)}:{source:'yahoo-context-server',fetched_at:at,partial:true,recent:[],note:'no insider transaction detail returned'};
  const et=Array.isArray(ctx.earningsTrend?.trend)?ctx.earningsTrend.trend:[];
  const revisions=et.map(t=>({period:t.period||null,endDate:t.endDate||null,growth:n(t.growth),epsEstimateAvg:n(t.earningsEstimate?.avg),epsTrendCurrent:n(t.epsTrend?.current),epsTrend7dAgo:n(t.epsTrend?.['7daysAgo']),epsTrend30dAgo:n(t.epsTrend?.['30daysAgo']),epsTrend60dAgo:n(t.epsTrend?.['60daysAgo']),epsTrend90dAgo:n(t.epsTrend?.['90daysAgo'])}));
  const shares=n(ks.sharesOutstanding),cash=n(fd.totalCash),debt=n(fd.totalDebt),revenue=n(fd.totalRevenue),fcf=n(fd.freeCashflow),mcap=n(pr.marketCap),pe=n(sd.trailingPE),forwardPe=n(fd.forwardPE),pb=n(ks.priceToBook),ps=n(sd.priceToSalesTrailing12Months),peg=n(ks.pegRatio),eps=n(ks.trailingEps);
  const fundamentals={source:'yahoo-quoteSummary-server',fetched_at:at,partial:true,is_etf:String(pr.quoteType||meta.instrumentType||'').toUpperCase()==='ETF',name:profile.name,sector:profile.sector,industry:profile.industry,currency:pr.currency||meta.currency||null,mcap,shares,revenue,net_income:null,eps_ttm:eps,bvps:shares&&n(ks.bookValue)?n(ks.bookValue):null,fcf_latest:fcf,fcf_base:fcf,dividend_ps:n(sd.dividendRate),rev_cagr_3y:n(fd.revenueGrowth),eps_cagr:n(fd.earningsGrowth),gross_margin:n(fd.grossMargins),op_margin:n(fd.operatingMargins),net_margin:n(fd.profitMargins),fcf_margin:revenue&&fcf!=null?fcf/revenue:null,roe:n(fd.returnOnEquity),roa:n(fd.returnOnAssets),debt_to_equity:n(fd.debtToEquity)!=null?n(fd.debtToEquity)/100:null,net_cash:cash!=null&&debt!=null?cash-debt:null,total_debt:debt,cash,current_ratio:n(fd.currentRatio),quick_ratio:n(fd.quickRatio),ocf:n(fd.operatingCashflow),pe,forward_pe:forwardPe,pb,ps,peg,ev_ebitda:n(ks.enterpriseToEbitda),attempts:[],note:'Current Yahoo fundamental snapshot used only as a fallback when SEC filing facts are unavailable. It is not treated as point-in-time historical evidence.'};
  return{profile,analysts,earnings,extras,insiders,revisions,fundamentals};
}
module.exports=async function handler(req,res){
  if(req.method==='OPTIONS')return send(res,200,{ok:true});if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const symbol=clean(req.query?.symbol);if(!symbol)return send(res,400,{error:'Enter a valid ticker symbol.'});
  try{
    const [chart,ctx,news]=await Promise.all([yahooChart(symbol),yahooContext(symbol),yahooNews(symbol)]);
    const bars=makeBars(chart);if(bars.length<120)return send(res,422,{error:`Only ${bars.length} usable closed daily bars were found for ${symbol}; at least 120 are required.`});
    const meta=chart.meta||{},last=bars.at(-1),prev=bars.at(-2),market=Number(meta.regularMarketPrice),previous=Number(meta.chartPreviousClose??meta.previousClose??prev?.close),px=Number.isFinite(market)&&market>0?market:last.close,ch=Number.isFinite(previous)&&previous>0?px-previous:null;
    const yc=currentYahoo(ctx,meta,symbol),cikHint=extractCik(ctx);
    const sec=await secFundamentals(symbol,cikHint).catch(e=>({source:'SEC EDGAR companyfacts',error:String(e?.message||e)}));
    let fundamentals=withMarketPrice(sec,px);
    if(!fundamentals||fundamentals.error){
      if(yc.fundamentals&&!yc.fundamentals.error){fundamentals={...yc.fundamentals,attempts:[{source:'SEC EDGAR',error:fundamentals?.error||'unavailable'},{source:yc.fundamentals.source,result:'fallback snapshot loaded'}]};}
      else fundamentals={source:'fundamentals',fetched_at:now(),error:fundamentals?.error||yc.fundamentals?.error||'fundamentals unavailable',attempts:[{source:'SEC EDGAR',error:fundamentals?.error||'unavailable'},{source:'Yahoo current fundamentals',error:yc.fundamentals?.error||'unavailable'}]};
    }else{fundamentals.source='SEC EDGAR companyfacts + market price';fundamentals.fetched_at=now();fundamentals.sector=yc.profile?.sector||null;fundamentals.industry=yc.profile?.industry||null;fundamentals.mcap=yc.profile?.mcap||fundamentals.mcap;fundamentals.attempts=[{source:'SEC EDGAR',result:'success'}];}
    const profile=yc.profile?.error?{source:'yahoo-chart-server',fetched_at:now(),name:meta.longName||meta.shortName||symbol,exchange:meta.fullExchangeName||meta.exchangeName||null,partial:true}:yc.profile;
    const out={schema_version:5,symbol,generated_at:now(),timeframe:'1day',direct:false,quote:{source:'yahoo-chart-server',fetched_at:now(),current:px,change:ch,change_pct:ch!=null&&previous?ch/previous*100:null,high:n(meta.regularMarketDayHigh),low:n(meta.regularMarketDayLow),open:n(meta.regularMarketOpen),prev_close:previous,currency:meta.currency||null},profile,candles:{source:'yahoo-chart-server',fetched_at:now(),bars,n:bars.length,interval:'1day',latest:last?.date||null,adjustment_type:'OHLC scaled by Adj Close/raw Close',closed_bars_only:true,confidence:'MEDIUM'},daily:{source:'yahoo-chart-server',fetched_at:now(),bars},fundamentals,analysts:yc.analysts,earnings:yc.earnings,peers:{source:'none',fetched_at:now(),partial:true,note:'peer fundamentals not yet available from secure backend'},news,insiders:yc.insiders,extras:yc.extras,context:{status:'SEC_FUNDAMENTALS_WITH_SERVER_FALLBACKS',profile,earnings:{nextDates:yc.earnings?.next_dates||[]},fundamentals,revisions:yc.revisions,fundamentals_source:fundamentals.source,filing_date:fundamentals.filing_date||null,backtest_policy:'SEC filing facts may be used historically only on or after their filing date. Current analyst/earnings/positioning snapshots are excluded from historical prediction metrics unless point-in-time history exists.'},data_quality:{range_requested:'max',first_bar_date:bars[0]?.date||null,last_closed_bar_date:last?.date||null,bars_returned:bars.length,adjusted_prices:true,forming_daily_bar_excluded:true},warnings:['Fundamentals prefer SEC EDGAR filing facts; Yahoo current fundamentals are a labeled fallback only when SEC is unavailable.','Optional analyst, positioning and earnings fields may be partial for newly listed or thinly covered securities.']};
    return send(res,200,out);
  }catch(e){return send(res,502,{symbol,error:String(e?.message||e)});}
};