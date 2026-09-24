const ORIGIN_DEFAULT='https://samin110597-create.github.io';
const TFS=new Set(['15M','1H','4H','1D']);
const SYMBOL=/^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
const NY_FMT=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

function parts(ts){
  const p=Object.fromEntries(NY_FMT.formatToParts(new Date(ts*1000)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,minute:+p.hour*60 + +p.minute};
}
function isoDate(d){return d.toISOString().slice(0,10);}
function daysAgo(n){const d=new Date();d.setUTCDate(d.getUTCDate()-n);return isoDate(d);}
function okNum(x){return Number.isFinite(+x);}
function canonicalBar({ts,open,high,low,close,volume=null,endTs=null}){
  ts=+ts;open=+open;high=+high;low=+low;close=+close;volume=volume==null?null:+volume;
  if(![ts,open,high,low,close].every(Number.isFinite)||Math.min(open,high,low,close)<=0||high<Math.max(open,low,close)||low>Math.min(open,high,close))return null;
  const p=parts(ts);return {ts,end_ts:endTs||ts,date:p.date,session:p.date,open,high,low,close,volume:Number.isFinite(volume)&&volume>=0?volume:null,complete:true};
}
function filterRegular(bars){
  return (bars||[]).filter(b=>{const p=parts(b.ts);return p.minute>=570&&p.minute<960;}).sort((a,b)=>a.ts-b.ts);
}
function resampleMinutes(bars,bucketMinutes){
  const by=new Map(),out=[];
  for(const b of filterRegular(bars)){const p=parts(b.ts),idx=Math.floor((p.minute-570)/bucketMinutes),key=p.date+'-'+idx;(by.get(key)||by.set(key,[]).get(key)).push(b);}
  for(const z of by.values()){z.sort((a,b)=>a.ts-b.ts);const first=z[0],last=z.at(-1);out.push({ts:first.ts,end_ts:last.end_ts||last.ts,date:first.date,session:first.session,open:first.open,high:Math.max(...z.map(x=>x.high)),low:Math.min(...z.map(x=>x.low)),close:last.close,volume:z.every(x=>Number.isFinite(x.volume))?z.reduce((s,x)=>s+x.volume,0):null,complete:true,component_bars:z.length});}
  return out.sort((a,b)=>a.ts-b.ts);
}
function freshness(tf,bars){
  const last=bars?.at(-1);if(!last)return {status:'UNAVAILABLE',ageMinutes:null};
  const end=+(last.end_ts||last.ts),age=Math.max(0,(Date.now()/1000-end)/60);
  const max=tf==='1D'?60*24*6:60*24*4;
  return {status:age<=max?'CURRENT':'STALE',ageMinutes:age,lastCompleted:end};
}
async function fetchJson(url,timeout=10000){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),timeout);
  try{const r=await fetch(url,{signal:ctl.signal,headers:{'Accept':'application/json','User-Agent':'QState/2.1'}});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}
  finally{clearTimeout(t);}
}
function massiveRows(j,seconds){
  return (j?.results||[]).map(x=>canonicalBar({ts:+x.t/1000,open:x.o,high:x.h,low:x.l,close:x.c,volume:x.v,endTs:+x.t/1000+seconds})).filter(Boolean);
}
async function massiveIntraday(symbol,key){
  if(!key)throw new Error('MASSIVE_KEY missing');
  const url=`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/15/minute/${daysAgo(180)}/${isoDate(new Date())}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(key)}`;
  const j=await fetchJson(url);const rows=filterRegular(massiveRows(j,900));if(rows.length<500)throw new Error('Massive intraday too shallow');return {provider:'Massive stocks aggregates',bars:rows};
}
async function massiveDaily(symbol,key){
  if(!key)throw new Error('MASSIVE_KEY missing');
  const url=`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${daysAgo(3655)}/${isoDate(new Date())}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(key)}`;
  const j=await fetchJson(url);const rows=massiveRows(j,86400);if(rows.length<200)throw new Error('Massive daily too shallow');return {provider:'Massive stocks aggregates',bars:rows};
}
function yahooRows(result,seconds,intraday){
  const q=result?.indicators?.quote?.[0]||{},ts=result?.timestamp||[],out=[];
  for(let i=0;i<ts.length;i++){const b=canonicalBar({ts:+ts[i],open:q.open?.[i],high:q.high?.[i],low:q.low?.[i],close:q.close?.[i],volume:q.volume?.[i],endTs:+ts[i]+seconds});if(!b)continue;if(intraday){const p=parts(b.ts);if(p.minute<570||p.minute>=960)continue;}if(b.end_ts>Date.now()/1000-45)continue;out.push(b);}
  return out.sort((a,b)=>a.ts-b.ts);
}
async function yahooIntraday(symbol){
  const ys=symbol.replaceAll('.','-'),url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?interval=15m&range=60d&includePrePost=false&includeAdjustedClose=false&events=splits`;
  const j=await fetchJson(url),r=j?.chart?.result?.[0];if(!r)throw new Error('Yahoo intraday unavailable');const rows=yahooRows(r,900,true);if(rows.length<500)throw new Error('Yahoo intraday too shallow');return {provider:'Yahoo server fallback',bars:rows};
}
async function yahooHourly(symbol){
  const ys=symbol.replaceAll('.','-'),url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?interval=60m&range=2y&includePrePost=false&includeAdjustedClose=false&events=splits`;
  const j=await fetchJson(url),r=j?.chart?.result?.[0];if(!r)throw new Error('Yahoo hourly unavailable');const rows=yahooRows(r,3600,true);if(rows.length<200)throw new Error('Yahoo hourly too shallow');return {provider:'Yahoo server fallback',bars:rows};
}
async function yahooDaily(symbol){
  const ys=symbol.replaceAll('.','-'),url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?interval=1d&range=10y&includePrePost=false&includeAdjustedClose=false&events=splits`;
  const j=await fetchJson(url),r=j?.chart?.result?.[0];if(!r)throw new Error('Yahoo daily unavailable');const rows=yahooRows(r,86400,false);if(rows.length<200)throw new Error('Yahoo daily too shallow');return {provider:'Yahoo server fallback',bars:rows};
}
async function fmpIntraday(symbol,key){
  if(!key)throw new Error('FMP key missing');
  const url=`https://financialmodelingprep.com/stable/historical-chart/15min?symbol=${encodeURIComponent(symbol)}&from=${daysAgo(180)}&to=${isoDate(new Date())}&apikey=${encodeURIComponent(key)}`;
  const rows=await fetchJson(url);if(!Array.isArray(rows))throw new Error('FMP intraday unavailable');
  const out=rows.map(x=>{const ts=Date.parse((x.date||'').replace(' ','T')+'-04:00')/1000;return canonicalBar({ts,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume,endTs:ts+900});}).filter(Boolean).sort((a,b)=>a.ts-b.ts);
  if(out.length<500)throw new Error('FMP intraday too shallow');return {provider:'FMP intraday',bars:filterRegular(out)};
}
async function fmpDaily(symbol,key){
  if(!key)throw new Error('FMP key missing');
  const url=`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${daysAgo(3655)}&to=${isoDate(new Date())}&apikey=${encodeURIComponent(key)}`;
  const rows=await fetchJson(url);if(!Array.isArray(rows))throw new Error('FMP daily unavailable');
  const out=rows.map(x=>{const ts=Date.parse((x.date||'')+'T13:30:00Z')/1000;return canonicalBar({ts,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume,endTs:ts+23400});}).filter(Boolean).sort((a,b)=>a.ts-b.ts);
  if(out.length<200)throw new Error('FMP daily too shallow');return {provider:'FMP daily',bars:out};
}
function choose(cands,tf){
  const valid=cands.filter(x=>x?.bars?.length>=80).map(x=>({...x,fresh:freshness(tf,x.bars)})).filter(x=>x.fresh.status==='CURRENT');
  if(!valid.length)return null;
  valid.sort((a,b)=>(b.fresh.lastCompleted||0)-(a.fresh.lastCompleted||0));
  const chosen=valid[0],peer=valid[1];
  let check={status:'SINGLE_SOURCE',dispersionPct:null,peer:null};
  if(peer){
    const a=chosen.bars.at(-1),b=peer.bars.at(-1),sameDate=a.date===b.date;
    const dispersion=sameDate?Math.abs(a.close-b.close)/((a.close+b.close)/2)*100:null;
    check={status:dispersion!=null&&dispersion<=1?'MATCH':'REVIEW',dispersionPct:dispersion,peer:peer.provider};
  }
  return {...chosen,validation:check};
}
async function settle(label,fn,trace){try{const x=await fn();trace.push({source:label,status:'OK',bars:x.bars.length,last:x.bars.at(-1)?.date});return x;}catch(e){trace.push({source:label,status:'FAILED',reason:String(e.message||e).slice(0,140)});return null;}}
async function marketBundle(symbol,env){
  const trace=[];
  const [mi,fi,yi,mD,fD,yD,yH]=await Promise.all([
    settle('Massive intraday',()=>massiveIntraday(symbol,env.MASSIVE_KEY),trace),
    settle('FMP intraday',()=>fmpIntraday(symbol,env.FMP_API_KEY),trace),
    settle('Yahoo intraday',()=>yahooIntraday(symbol),trace),
    settle('Massive daily',()=>massiveDaily(symbol,env.MASSIVE_KEY),trace),
    settle('FMP daily',()=>fmpDaily(symbol,env.FMP_API_KEY),trace),
    settle('Yahoo daily',()=>yahooDaily(symbol),trace),
    settle('Yahoo hourly',()=>yahooHourly(symbol),trace)
  ]);
  const intraday=choose([mi,fi,yi],'15M');
  const daily=choose([mD,fD,yD],'1D');
  if(!intraday&&!daily)throw new Error('No provider returned usable current data for '+symbol);
  let h1=null,h4=null,m15=null;
  if(intraday){
    m15={status:'COMPLETED BAR',provider:intraday.provider,bars:intraday.bars,validation:intraday.validation,fetched_at:new Date().toISOString()};
    const hourBars=resampleMinutes(intraday.bars,60);if(hourBars.length>=80)h1={status:'COMPLETED BAR',provider:intraday.provider+' · 15M→1H regular-session aggregation',bars:hourBars,fetched_at:new Date().toISOString()};
    const fourBars=resampleMinutes(intraday.bars,240);if(fourBars.length>=80)h4={status:'COMPLETED BAR',provider:intraday.provider+' · 15M→4H regular-session aggregation',bars:fourBars,fetched_at:new Date().toISOString()};
  }
  if((!h1||!h4)&&yH){
    if(!h1&&yH.bars.length>=80)h1={status:'COMPLETED BAR',provider:yH.provider,bars:yH.bars,fetched_at:new Date().toISOString()};
    if(!h4){const z=resampleMinutes(yH.bars,240);if(z.length>=80)h4={status:'COMPLETED BAR',provider:yH.provider+' · 1H→4H aggregation',bars:z,fetched_at:new Date().toISOString()};}
  }
  const d1=daily?{status:'COMPLETED BAR',provider:daily.provider,bars:daily.bars,validation:daily.validation,fetched_at:new Date().toISOString()}:null;
  return {schema_version:1,symbol,asset:'STOCK_OR_ETF',fetched_at:new Date().toISOString(),timeframes:{'15M':m15,'1H':h1,'4H':h4,'1D':d1},provider_trace:trace,credential_policy:'Provider keys remain encrypted Worker secrets and are never returned to the browser.'};
}
function cors(request,env){
  const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGIN||ORIGIN_DEFAULT).split(',').map(x=>x.trim());
  return {'Access-Control-Allow-Origin':origin&&allowed.includes(origin)?origin:allowed[0],'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
}
function responseJson(obj,status,request,env,cache='no-store'){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':cache,...cors(request,env)}});}
export default {
  async fetch(request,env,ctx){
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request,env)});
    if(request.method!=='GET')return responseJson({error:'METHOD_NOT_ALLOWED'},405,request,env);
    const u=new URL(request.url);
    if(u.pathname==='/health')return responseJson({status:'OK',service:'Q-State Market API',version:'1.0',providers:{massive:!!env.MASSIVE_KEY,fmp:!!env.FMP_API_KEY}},200,request,env,'public,max-age=60');
    if(u.pathname!=='/v1/market')return responseJson({error:'NOT_FOUND'},404,request,env);
    const symbol=String(u.searchParams.get('symbol')||'').trim().toUpperCase(),tf=String(u.searchParams.get('timeframe')||'1D').toUpperCase();
    if(!SYMBOL.test(symbol))return responseJson({error:'INVALID_SYMBOL'},400,request,env);
    if(!TFS.has(tf))return responseJson({error:'INVALID_TIMEFRAME'},400,request,env);
    const cacheUrl=new URL(request.url);cacheUrl.searchParams.set('symbol',symbol);cacheUrl.searchParams.set('timeframe',tf);
    const cacheKey=new Request(cacheUrl.toString(),{method:'GET'}),cache=globalThis.caches?.default,cached=cache?await cache.match(cacheKey):null;if(cached)return cached;
    try{
      const bundle=await marketBundle(symbol,env),frame=bundle.timeframes[tf];if(!frame?.bars?.length)return responseJson({error:'TIMEFRAME_UNAVAILABLE',symbol,timeframe:tf,provider_trace:bundle.provider_trace},404,request,env);
      const body={...bundle,requested_timeframe:tf,primary:{...frame,bars:frame.bars}};
      const res=responseJson(body,200,request,env,tf==='1D'?'public,max-age=900':'public,max-age=120');if(cache)ctx.waitUntil(cache.put(cacheKey,res.clone()));return res;
    }catch(e){return responseJson({error:'DATA_UNAVAILABLE',symbol,timeframe:tf,message:String(e.message||e),configured:{massive:!!env.MASSIVE_KEY,fmp:!!env.FMP_API_KEY}},503,request,env);}
  }
};
export {filterRegular,resampleMinutes,freshness,choose};
