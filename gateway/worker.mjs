// Thin, cached data gateway. All model calculations run in the browser.
// No scheduled scans, model training, general proxying or automatic provider retries.
const pending=new Map(),cooldown=new Map(),budgets=new Map();
const valid=s=>/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(s);
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','X-Content-Type-Options':'nosniff'};
function response(data,status=200,ttl=0){return new Response(JSON.stringify(data),{status,headers:{...headers,'Cache-Control':ttl?'public, max-age='+ttl:'no-store'}});}
function budget(key,max,period){const now=Date.now(),old=budgets.get(key),b=old&&old.end>now?old:{n:0,end:now+period};b.n++;budgets.set(key,b);if(budgets.size>2000)for(const [k,v]of budgets)if(v.end<now)budgets.delete(k);return b.n<=max;}
async function upstream(provider,url,init={}){
  if((cooldown.get(provider)||0)>Date.now())throw Error('Provider cooling down');
  // These are best-effort per-isolate safeguards, not global provider quotas.
  if(!budget('provider:'+provider,provider==='fmp'?3:20,60000))throw Error('Provider request budget reached');
  try{const r=await fetch(url,{...init,signal:AbortSignal.timeout(4500)});if(!r.ok)throw Error('Provider HTTP '+r.status);const j=await r.json();if(j.error||j['Error Message']||j.Note)throw Error('Provider unavailable');return j;}
  catch(e){cooldown.set(provider,Date.now()+60000);throw Error('Provider temporarily unavailable');}
}
function quote(symbol,price,as_of,provider,extra={}){if(!Number.isFinite(price)||price<=0||!Number.isFinite(as_of)||as_of<=0||as_of>Date.now()/1000+60)throw Error('Invalid source quote');return {symbol,price,as_of,currency:'USD',provider,fetched_at:new Date().toISOString(),delay:'Provider entitlement/delay applies; source market timestamp preserved',...extra};}
async function getQuote(symbol,env){
  const candidates=[];
  if(env.FINNHUB_KEY)try{const j=await upstream('finnhub','https://finnhub.io/api/v1/quote?symbol='+encodeURIComponent(symbol),{headers:{'X-Finnhub-Token':env.FINNHUB_KEY}});const q=quote(symbol,j.c,j.t,'Finnhub',{api_secret_used:true});if(Date.now()/1000-q.as_of<=120)return q;candidates.push(q);}catch{}
  if(env.FMP_KEY)try{const j=await upstream('fmp','https://financialmodelingprep.com/stable/quote?'+new URLSearchParams({symbol,apikey:env.FMP_KEY})),q=j?.[0];if(q?.symbol===symbol)candidates.push(quote(symbol,q.price,q.timestamp,'FMP',{api_secret_used:true}));}catch{}
  if(!candidates.some(q=>Date.now()/1000-q.as_of<=900))try{const j=await upstream('yahoo','https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=5d'),m=j?.chart?.result?.[0]?.meta;if(m?.symbol?.toUpperCase()===symbol&&m.currency==='USD')candidates.push(quote(symbol,m.regularMarketPrice,m.regularMarketTime,'Yahoo server quote',{api_secret_used:false}));}catch{}
  if(!candidates.length)throw Error('Quote unavailable');return candidates.sort((a,b)=>b.as_of-a.as_of)[0];
}
async function history(symbol,tf,env){
  const fetched_at=new Date().toISOString();
  if(env.MASSIVE_KEY)try{
    const daily=tf==='1D',mult=tf==='15M'?15:1,span=daily?'day':tf==='15M'?'minute':'hour';
    const end=fetched_at.slice(0,10),start=new Date(Date.now()-(daily?1000:60)*86400000).toISOString().slice(0,10);
    const url='https://api.massive.com/v2/aggs/ticker/'+encodeURIComponent(symbol)+'/range/'+mult+'/'+span+'/'+start+'/'+end+'?'+new URLSearchParams({adjusted:'true',sort:'desc',limit:daily?'600':'3000'});
    const payload=await upstream('massive',url,{headers:{Authorization:'Bearer '+env.MASSIVE_KEY}});
    if(payload.ticker!==symbol||!payload.results?.length)throw Error('No history');
    return {symbol,timeframe:tf,provider:'Massive adjusted OHLCV',format:'massive',payload,fetched_at};
  }catch{}
  const interval=tf==='1D'?'1d':tf==='15M'?'15m':'60m',range=tf==='1D'?'2y':'60d';
  const payload=await upstream('yahoo','https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?'+new URLSearchParams({interval,range,includePrePost:'false'}));
  const meta=payload?.chart?.result?.[0]?.meta;
  if(meta?.symbol?.toUpperCase()!==symbol||meta.currency!=='USD')throw Error('No matching USD history');
  return {symbol,timeframe:tf,provider:'Yahoo server OHLCV',format:'yahoo',payload,fetched_at};
}
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{headers});
  if(request.method!=='GET')return response({error:'Method not allowed'},405);
  if(url.pathname==='/health')return response({status:'OK',service:'stock-truth-data',version:1,providers:{finnhub:!!env.FINNHUB_KEY,fmp:!!env.FMP_KEY,massive:!!env.MASSIVE_KEY},limits:'Cached, bounded requests; no training or scans'},200,60);
  if(!['/v1/quote','/v1/history'].includes(url.pathname))return response({error:'Not found'},404);
  const symbol=(url.searchParams.get('symbol')||'').trim().toUpperCase(),tf=url.searchParams.get('timeframe')||'1D';
  if(!valid(symbol)||!['15M','1H','4H','1D'].includes(tf))return response({error:'Invalid symbol or timeframe'},400);
  const isQuote=url.pathname==='/v1/quote',key=new Request(url.origin+url.pathname+'?'+new URLSearchParams({symbol,...(isQuote?{}:{timeframe:tf})}));
  const cache=globalThis.caches?.default,cached=cache&&await cache.match(key);if(cached){if(!isQuote)return cached;const q=await cached.clone().json();if(Number.isFinite(q.as_of)&&Date.now()/1000-q.as_of<=900)return cached;}
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';if(!budget('ip:'+ip,30,60000))return response({symbol,error:'Please wait before refreshing again'},429);
  if(env.REQUEST_LIMITER){const {success}=await env.REQUEST_LIMITER.limit({key:ip});if(!success)return response({symbol,error:'Please wait before refreshing again'},429);}
  const token=key.url;if(pending.has(token))return (await pending.get(token)).clone();
  const task=(async()=>{try{const data=isQuote?await getQuote(symbol,env):await history(symbol,tf,env),r=response(data,200,isQuote?Math.max(1,Math.min(data.provider==='FMP'?900:60,Math.floor(data.as_of+900-Date.now()/1000))):tf==='1D'?900:300);if(cache)ctx.waitUntil(cache.put(key,r.clone()));return r;}catch{const r=response({symbol,error:'Source unavailable; use independent browser fallback'},503,30);if(cache)ctx.waitUntil(cache.put(key,r.clone()));return r;}})();
  pending.set(token,task);try{return (await task).clone();}finally{pending.delete(token);}
}};
