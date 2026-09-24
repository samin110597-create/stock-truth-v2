const PRODUCTS={GOLD:'GC',XAU:'GC',XAUUSD:'GC',GC:'GC',SILVER:'SI',XAG:'SI',XAGUSD:'SI',SI:'SI',OIL:'CL',WTI:'CL',CRUDE:'CL',CL:'CL',NATGAS:'NG',NATURALGAS:'NG',NG:'NG',COPPER:'HG',HG:'HG',PLATINUM:'PL',PL:'PL',PALLADIUM:'PA',PA:'PA',CORN:'ZC',ZC:'ZC',WHEAT:'ZW',ZW:'ZW',SOY:'ZS',SOYBEANS:'ZS',ZS:'ZS'};
const METAL_PROXY={GC:'GLD',SI:'SLV'};
const CONTRACT=/^[A-Z]{1,3}[FGHJKMNQUVXZ]\d{1,2}$/;
const clean=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
export function detectAsset(symbol,choice='AUTO'){if(choice&&choice!=='AUTO')return choice;const s=clean(symbol);return PRODUCTS[s]||CONTRACT.test(s)?'FUTURE':'STOCK';}
async function json(url,signal){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
const usable=b=>Array.isArray(b?.bars)&&b.bars.length>=80&&!['STALE','UNAVAILABLE'].includes(String(b?.status||'').toUpperCase());
const frameUsable=(b,min=60)=>Array.isArray(b?.bars)&&b.bars.length>=min&&!['STALE','UNAVAILABLE'].includes(String(b?.status||'').toUpperCase());
const mtfFrom=timeframes=>Object.fromEntries(['15M','1H','4H','1D'].filter(tf=>frameUsable(timeframes?.[tf],60)).map(tf=>[tf,timeframes[tf].bars]));
function resampleStored(bars,count,label){
  const groups=new Map(),out=[];
  for(const b of bars||[]){const k=b.session||b.date;(groups.get(k)||groups.set(k,[]).get(k)).push(b);}
  for(const g of groups.values()){g.sort((a,b)=>a.ts-b.ts);for(let i=0;i+count-1<g.length;i+=count){const z=g.slice(i,i+count);if(z.length<count)continue;out.push({ts:z[0].ts,end_ts:z.at(-1).end_ts,date:z.at(-1).date,session:z.at(-1).session||z.at(-1).date,open:z[0].open,high:Math.max(...z.map(x=>x.high)),low:Math.min(...z.map(x=>x.low)),close:z.at(-1).close,volume:z.every(x=>Number.isFinite(x.volume))?z.reduce((s,x)=>s+x.volume,0):null,complete:true,resampled_from:label});}}
  return out;
}
function recoveredFrame(raw,tf){
  const t=raw?.timeframes||{},direct=t[tf];if(usable(direct))return direct;
  if(tf==='1H'){
    if(frameUsable(t['15M'])){const bars=resampleStored(t['15M'].bars,4,'15M');if(bars.length>=80)return {status:'COMPLETED BAR',provider:(t['15M'].provider||'snapshot')+' · reconstructed 1H',fetched_at:t['15M'].fetched_at,bars};}
    if(frameUsable(t['5M'])){const bars=resampleStored(t['5M'].bars,12,'5M');if(bars.length>=80)return {status:'COMPLETED BAR',provider:(t['5M'].provider||'snapshot')+' · reconstructed 1H',fetched_at:t['5M'].fetched_at,bars};}
  }
  if(tf==='4H'){
    const h1=recoveredFrame(raw,'1H');if(usable(h1)){const bars=resampleStored(h1.bars,4,'1H');if(bars.length>=80)return {status:'COMPLETED BAR',provider:(h1.provider||'snapshot')+' · reconstructed 4H',fetched_at:h1.fetched_at,bars};}
  }
  return direct;
}
function normalizeYahoo(result,tf){const q=result?.indicators?.quote?.[0]||{},ts=result?.timestamp||[],seconds=tf==='15M'?900:tf==='1H'?3600:tf==='4H'?3600:86400,now=Date.now()/1000,out=[];for(let i=0;i<ts.length;i++){const o=+q.open?.[i],h=+q.high?.[i],l=+q.low?.[i],c=+q.close?.[i],v=+q.volume?.[i];if(![o,h,l,c].every(Number.isFinite)||Math.min(o,h,l,c)<=0||h<Math.max(o,l,c)||l>Math.min(o,h,c))continue;if(tf!=='1D'&&ts[i]+seconds>now-60)continue;const date=new Date(ts[i]*1000).toISOString().slice(0,10);out.push({ts:ts[i],end_ts:ts[i]+seconds,date,session:date,open:o,high:h,low:l,close:c,volume:Number.isFinite(v)?v:null,complete:true});}return out;}
function resample4h(bars){const groups=new Map();for(const b of bars){const key=b.session;const g=groups.get(key)||[];g.push(b);groups.set(key,g);}const out=[];for(const g of groups.values()){for(let i=0;i+3<g.length;i+=4){const z=g.slice(i,i+4);out.push({ts:z[0].ts,end_ts:z[3].end_ts,date:z[3].date,session:z[3].session,open:z[0].open,high:Math.max(...z.map(x=>x.high)),low:Math.min(...z.map(x=>x.low)),close:z[3].close,volume:z.every(x=>Number.isFinite(x.volume))?z.reduce((s,x)=>s+x.volume,0):null,complete:true});}}return out;}
async function storedStock(symbol,tf,signal){
  const raw=await json('../data/raw/'+encodeURIComponent(symbol)+'.json',signal),b=recoveredFrame(raw,tf);
  if(!usable(b))throw new Error('stored '+tf+' snapshot is missing, stale, or too shallow');
  const mtf={...mtfFrom(raw.timeframes)};if(!mtf[tf])mtf[tf]=b.bars;
  return {symbol,sourceSymbol:symbol,asset:raw.security_type||'STOCK',timeframe:tf,bars:b.bars,mtf,provider:b.provider||'GitHub sanitized stock snapshot',fetchedAt:b.fetched_at||raw.fetched_at,dataStatus:b.status||'UNKNOWN',lastCompletedBar:b.bars.at(-1)?.end_ts||null,credentialPolicy:'No browser credential. Snapshot was generated outside the quant UI.'};
}
async function publicStock(symbol,tf,signal){const map={'15M':['15m','60d'],'1H':['60m','2y'],'4H':['60m','2y'],'1D':['1d','10y']},[interval,range]=map[tf]||map['1D'];const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?'+new URLSearchParams({interval,range,includePrePost:'false',includeAdjustedClose:'false',events:'splits'});const j=await json(url,signal),r=j?.chart?.result?.[0];if(!r)throw new Error('Public fallback returned no data for '+symbol);let bars=normalizeYahoo(r,tf);if(tf==='4H')bars=resample4h(bars);if(bars.length<80)throw new Error('Not enough completed '+tf+' bars for '+symbol);return {symbol,sourceSymbol:symbol,asset:'STOCK',timeframe:tf,bars,mtf:{[tf]:bars},provider:'Independent public chart fallback',fetchedAt:new Date().toISOString(),credentialPolicy:'No API secret used in browser fallback.'};}
async function future(symbol,tf,signal){
  const requested=clean(symbol),product=PRODUCTS[requested]||requested.replace(/[FGHJKMNQUVXZ]\d{1,2}$/,'');
  try{
    const snap=await json('../data/quant/'+encodeURIComponent(product)+'.json',signal),b=snap?.timeframes?.[tf];
    if(!usable(b))throw new Error('snapshot too shallow');
    return {symbol:requested,sourceSymbol:b.source_symbol||snap.source_symbol||product,asset:'FUTURE',timeframe:tf,bars:b.bars,mtf:mtfFrom(snap.timeframes),provider:b.provider||snap.provider||'Secure futures snapshot',fetchedAt:b.fetched_at||snap.fetched_at,credentialPolicy:'GitHub Actions secret -> sanitized OHLCV snapshot. No secret is sent to this page.'};
  }catch(e){
    const proxy=METAL_PROXY[product];
    if(!proxy)throw new Error(product+' '+tf+' secure futures snapshot is unavailable. The futures collector did not produce usable data.');
    const p=await storedStock(proxy,tf,signal);
    return {...p,symbol:requested,sourceSymbol:proxy,asset:'METAL_PROXY',provider:proxy+' ETF proxy fallback · futures snapshot unavailable',credentialPolicy:'Fallback uses the sanitized '+proxy+' ETF snapshot. It is a proxy for '+product+', not the futures contract.'};
  }
}
let runtimeConfigPromise=null;
async function runtimeConfig(signal){
  if(!runtimeConfigPromise)runtimeConfigPromise=json(new URL('../runtime-config.json',import.meta.url),signal).catch(()=>({apiBase:''}));
  return runtimeConfigPromise;
}
async function backendStock(symbol,tf,signal){
  const cfg=await runtimeConfig(signal),base=String(cfg?.apiBase||'').replace(/\/$/,'');if(!base)throw new Error('ON-DEMAND BACKEND OFF: arbitrary-ticker mode is not configured');
  const u=new URL(base+'/v1/market');u.searchParams.set('symbol',symbol);u.searchParams.set('timeframe',tf);
  const j=await json(u.toString(),signal),b=j?.timeframes?.[tf]||j?.primary;
  if(!b||!Array.isArray(b.bars)||b.bars.length<80)throw new Error('on-demand API returned insufficient '+tf+' data');
  const mtf=Object.fromEntries(['15M','1H','4H','1D'].filter(x=>Array.isArray(j?.timeframes?.[x]?.bars)&&j.timeframes[x].bars.length>=60).map(x=>[x,j.timeframes[x].bars]));
  return {symbol,sourceSymbol:symbol,asset:j.asset||'STOCK_OR_ETF',timeframe:tf,bars:b.bars,mtf,provider:'On-demand secure API · '+(b.provider||'market data'),fetchedAt:j.fetched_at||new Date().toISOString(),dataStatus:(b.status||'COMPLETED BAR')+' · ON-DEMAND',lastCompletedBar:b.bars.at(-1)?.end_ts||null,credentialPolicy:j.credential_policy||'Provider credentials remain on the secure API server.',providerTrace:j.provider_trace||[],crossValidation:b.validation||null,onDemand:true};
}
async function apiContext(signal){try{return await json('../data/quant/context.json',signal);}catch{return null;}}
async function trainedModel(signal){try{return await json('../data/quant/model.json',signal);}catch{return null;}}
export async function loadMarketData({symbol,asset='AUTO',timeframe='1D',signal}){
  const s=clean(symbol),kind=detectAsset(s,asset),contextPromise=apiContext(signal),modelPromise=trainedModel(signal);let core;
  if(kind==='FUTURE')core=await future(s,timeframe,signal);
  else{
    let backendError=null,storedError=null;
    try{core=await backendStock(s,timeframe,signal);}
    catch(e){backendError=e;try{core=await storedStock(s,timeframe,signal);}catch(se){storedError=se;try{core=await publicStock(s,timeframe,signal);}catch(pub){throw new Error(s+' data unavailable. On-demand API: '+(backendError?.message||'failed')+' · stored snapshot: '+(storedError?.message||'failed')+' · public fallback: '+(pub?.message||'failed'));}}}
  }
  const cfg=await runtimeConfig(signal);
  return {...core,apiContext:await contextPromise,trainedModel:await modelPromise,runtimeApiConfigured:!!String(cfg?.apiBase||'').trim()};
}
