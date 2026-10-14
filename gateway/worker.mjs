// Thin, cached data gateway. All model calculations run in the browser.
// No scheduled scans, model training, general proxying or automatic provider retries.
const pending=new Map(),cooldown=new Map(),budgets=new Map();
const valid=s=>/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(s);
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','X-Content-Type-Options':'nosniff'};
function response(data,status=200,ttl=0){return new Response(JSON.stringify(data),{status,headers:{...headers,'Cache-Control':ttl?'public, max-age='+ttl:'no-store'}});}
function budget(key,max,period){const now=Date.now(),old=budgets.get(key),b=old&&old.end>now?old:{n:0,end:now+period};b.n++;budgets.set(key,b);if(budgets.size>2000)for(const [k,v]of budgets)if(v.end<now)budgets.delete(k);return b.n<=max;}
async function upstream(provider,url,init={},operation='quote'){
  const scope=provider+':'+operation;
  if((cooldown.get(scope)||0)>Date.now())throw Error('COOLDOWN');
  if(!budget('provider:'+provider,provider==='fmp'?3:20,60000))throw Error('REQUEST_BUDGET');
  try{
    const r=await fetch(url,{...init,signal:AbortSignal.timeout(4500)});
    if(!r.ok){if(r.status===429||r.status>=500)cooldown.set(scope,Date.now()+60000);throw Error('HTTP_'+r.status);}
    const j=await r.json();if(j.error||j['Error Message']||j.Note||j.chart?.error)throw Error('SOURCE_ERROR');return j;
  }catch(e){
    if(/^HTTP_\d{3}$|^SOURCE_ERROR$/.test(e.message))throw e;
    cooldown.set(scope,Date.now()+60000);throw Error('NETWORK_OR_TIMEOUT');
  }
}
const nyClock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short'});
function sessionClock(t){const p=Object.fromEntries(nyClock.formatToParts(new Date(t*1000)).map(x=>[x.type,x.value]));return {seconds:Number(p.hour)*3600+Number(p.minute)*60+Number(p.second),weekday:p.weekday};}
// Compare regular-session completed candles, never a newer pre/post-market print.
// The browser's exchange calendar remains the final authority on session validity.
export function regularHistoryEnd(payload,format,seconds,now=Date.now()/1000){
  const x=payload?.chart?.result?.[0],q=x?.indicators?.quote?.[0];
  const rows=format==='massive'?(payload.results||[]).map(b=>[b.t/1000,b.o,b.h,b.l,b.c]):(x?.timestamp||[]).map((t,i)=>[t,q?.open?.[i],q?.high?.[i],q?.low?.[i],q?.close?.[i]]);
  rows.sort((a,b)=>b[0]-a[0]);
  for(const [t,...ohlc]of rows){if(!Number.isFinite(t)||!ohlc.every(Number.isFinite))continue;
    const clock=sessionClock(t),m=clock.seconds;if(['Sat','Sun'].includes(clock.weekday)||m<34200||m>=57600)continue;
    const end=Math.min(t+seconds,t-m+57600);if(end+60<=now)return end;
  }
  return 0;
}
export function expectedRegularEnd(tf,now=Date.now()/1000){
  const {seconds,weekday}=sessionClock(now);if(['Sat','Sun'].includes(weekday)||seconds<34200)return null;
  const open=now-seconds+34200,close=open+23400,width=tf==='15M'?900:tf==='4H'?14400:3600;
  if(now>=close+60)return close;
  const end=open+Math.floor((now-open-60)/width)*width;return end>open?end:null;
}
const failureCode=e=>/^(HTTP_\d{3}|COOLDOWN|REQUEST_BUDGET|SOURCE_ERROR|NETWORK_OR_TIMEOUT)$/.test(e?.message)?e.message:'INVALID_SOURCE_DATA';

function quote(symbol,price,as_of,provider,extra={}){if(!Number.isFinite(price)||price<=0||!Number.isFinite(as_of)||as_of<=0||as_of>Date.now()/1000+60)throw Error('Invalid source quote');return {symbol,price,as_of,currency:'USD',provider,fetched_at:new Date().toISOString(),delay:'Provider entitlement/delay applies; source market timestamp preserved',...extra};}
async function getQuote(symbol,env){
  const candidates=[];
  if(env.FINNHUB_KEY)try{const j=await upstream('finnhub','https://finnhub.io/api/v1/quote?symbol='+encodeURIComponent(symbol),{headers:{'X-Finnhub-Token':env.FINNHUB_KEY}});const q=quote(symbol,j.c,j.t,'Finnhub',{api_secret_used:true});if(Date.now()/1000-q.as_of<=120)return q;candidates.push(q);}catch{}
  if(env.FMP_KEY)try{const j=await upstream('fmp','https://financialmodelingprep.com/stable/quote?'+new URLSearchParams({symbol,apikey:env.FMP_KEY})),q=j?.[0];if(q?.symbol===symbol)candidates.push(quote(symbol,q.price,q.timestamp,'FMP',{api_secret_used:true}));}catch{}
  if(!candidates.some(q=>Date.now()/1000-q.as_of<=900))try{const j=await upstream('yahoo','https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=5d'),m=j?.chart?.result?.[0]?.meta;if(m?.symbol?.toUpperCase()===symbol&&m.currency==='USD')candidates.push(quote(symbol,m.regularMarketPrice,m.regularMarketTime,'Yahoo server quote',{api_secret_used:false}));}catch{}
  if(!candidates.length)throw Error('Quote unavailable');return candidates.sort((a,b)=>b.as_of-a.as_of)[0];
}
async function history(symbol,tf,env){
  const fetched_at=new Date().toISOString();let older=null,olderLast=0;const source_attempts=[];
  if(env.MASSIVE_KEY)try{
    const daily=tf==='1D',mult=daily?1:tf==='15M'?15:30,span=daily?'day':'minute';
    const end=fetched_at.slice(0,10),start=new Date(Date.now()-(daily?1000:60)*86400000).toISOString().slice(0,10);
    // Massive limits underlying minute aggregates, not returned 30-minute candles.
    // 3,000 minute records yielded only a few sessions and starved the 4H study.
    const url='https://api.massive.com/v2/aggs/ticker/'+encodeURIComponent(symbol)+'/range/'+mult+'/'+span+'/'+start+'/'+end+'?'+new URLSearchParams({adjusted:'true',sort:'desc',limit:daily?'600':'50000'});
    const payload=await upstream('massive',url,{headers:{Authorization:'Bearer '+env.MASSIVE_KEY}},'history');
    if(payload.ticker!==symbol||!payload.results?.length)throw Error('No history');
    const result={symbol,timeframe:tf,provider:'Massive adjusted OHLCV',format:'massive',intervalSeconds:daily?86400:mult*60,payload,fetched_at,source_attempts};
    olderLast=daily?Math.max(...payload.results.map(b=>Number(b.t)||0))/1000:regularHistoryEnd(payload,'massive',mult*60);
    source_attempts.push({provider:'Massive',status:'AVAILABLE',latest_regular_end:daily?null:olderLast});
    // A successful end-of-day entitlement must not hide newer intraday data.
    // This is a fallback trigger only; the browser certifies completed sessions.
    const expected=daily?null:expectedRegularEnd(tf);
    if(expected?olderLast>=expected:Date.now()/1000-olderLast<=(daily?129600:5400))return result;
    older=result;
  }catch(e){source_attempts.push({provider:'Massive',status:failureCode(e)});}
  try{
  // Use provider-supported range tokens. Hourly data supports three months;
  // shorter intraday intervals stay inside the provider's recent-history limit.
  const interval=tf==='1D'?'1d':tf==='15M'?'15m':'60m',range=tf==='1D'?'2y':tf==='15M'?'1mo':'3mo';
  const payload=await upstream('yahoo','https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?'+new URLSearchParams({interval,range,includePrePost:'false'}),{},'history');
  const meta=payload?.chart?.result?.[0]?.meta;
  if(meta?.symbol?.toUpperCase()!==symbol||meta.currency!=='USD')throw Error('No matching USD history');
  const timestamps=payload.chart.result[0].timestamp||[];
  if(!timestamps.length)throw Error('No history');
  const newest=tf==='1D'?Math.max(...timestamps):regularHistoryEnd(payload,'yahoo',tf==='15M'?900:3600);
  source_attempts.push({provider:'Yahoo',status:'AVAILABLE',latest_regular_end:tf==='1D'?null:newest});
  if(older&&newest<=olderLast)return older;
  return {symbol,timeframe:tf,provider:'Yahoo server OHLCV',format:'yahoo',payload,fetched_at,source_attempts};
  }catch(error){source_attempts.push({provider:'Yahoo',status:failureCode(error)});if(older)return older;throw error;}
}
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{headers});
  if(request.method!=='GET')return response({error:'Method not allowed'},405);
  if(url.pathname==='/health')return response({status:'OK',service:'stock-truth-data',version:1,providers:{finnhub:!!env.FINNHUB_KEY,fmp:!!env.FMP_KEY,massive:!!env.MASSIVE_KEY},limits:'Cached, bounded requests; no training or scans'},200,60);
  if(!['/v1/quote','/v1/history'].includes(url.pathname))return response({error:'Not found'},404);
  const symbol=(url.searchParams.get('symbol')||'').trim().toUpperCase(),tf=url.searchParams.get('timeframe')||'1D';
  if(!valid(symbol)||!['15M','1H','4H','1D'].includes(tf))return response({error:'Invalid symbol or timeframe'},400);
  const isQuote=url.pathname==='/v1/quote',key=new Request(url.origin+url.pathname+'?'+new URLSearchParams({symbol,...(isQuote?{}:{timeframe:tf,historyVersion:'4'})}));
  const cache=globalThis.caches?.default,cached=cache&&await cache.match(key);if(cached){if(!isQuote)return cached;const q=await cached.clone().json();if(Number.isFinite(q.as_of)&&Date.now()/1000-q.as_of<=900)return cached;}
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';if(!budget('ip:'+ip,30,60000))return response({symbol,error:'Please wait before refreshing again'},429);
  if(env.REQUEST_LIMITER){const {success}=await env.REQUEST_LIMITER.limit({key:ip});if(!success)return response({symbol,error:'Please wait before refreshing again'},429);}
  const token=key.url;if(pending.has(token))return (await pending.get(token)).clone();
  const task=(async()=>{try{const data=isQuote?await getQuote(symbol,env):await history(symbol,tf,env),r=response(data,200,isQuote?Math.max(1,Math.min(data.provider==='FMP'?900:60,Math.floor(data.as_of+900-Date.now()/1000))):tf==='1D'?900:300);if(cache)ctx.waitUntil(cache.put(key,r.clone()));return r;}catch{const r=response({symbol,error:'Source unavailable; use independent browser fallback'},503,30);if(cache)ctx.waitUntil(cache.put(key,r.clone()));return r;}})();
  pending.set(token,task);try{return (await task).clone();}finally{pending.delete(token);}
}};
