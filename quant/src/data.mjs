const PRODUCTS={GOLD:'GC',XAU:'GC',XAUUSD:'GC',GC:'GC',SILVER:'SI',XAG:'SI',XAGUSD:'SI',SI:'SI',OIL:'CL',WTI:'CL',CRUDE:'CL',CL:'CL',NATGAS:'NG',NATURALGAS:'NG',NG:'NG',COPPER:'HG',HG:'HG',PLATINUM:'PL',PL:'PL',PALLADIUM:'PA',PA:'PA',CORN:'ZC',ZC:'ZC',WHEAT:'ZW',ZW:'ZW',SOY:'ZS',SOYBEANS:'ZS',ZS:'ZS'};
const YAHOO_FUTURES={GC:'GC=F',SI:'SI=F',CL:'CL=F',NG:'NG=F',HG:'HG=F',PL:'PL=F',PA:'PA=F',ZC:'ZC=F',ZW:'ZW=F',ZS:'ZS=F'};
const METAL_PROXY={GC:'GLD',SI:'SLV'};
const CONTRACT=/^[A-Z]{1,3}[FGHJKMNQUVXZ]\d{1,2}$/;
const clean=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
export function detectAsset(symbol,choice='AUTO'){if(choice&&choice!=='AUTO')return choice;const s=clean(symbol);return PRODUCTS[s]||CONTRACT.test(s)?'FUTURE':'STOCK';}
function productOf(symbol){const s=clean(symbol);return PRODUCTS[s]||s.replace(/[FGHJKMNQUVXZ]\d{1,2}$/,'');}
function yahooSymbol(symbol,asset='AUTO'){const s=clean(symbol),kind=detectAsset(s,asset);return kind==='FUTURE'?(YAHOO_FUTURES[productOf(s)]||s):s;}
async function json(url,signal){const r=await fetch(url,{cache:'no-store',credentials:'omit',headers:{'Accept':'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
const usable=b=>Array.isArray(b?.bars)&&b.bars.length>=80&&!['STALE','UNAVAILABLE'].includes(String(b?.status||'').toUpperCase());
const frameUsable=(b,min=60)=>Array.isArray(b?.bars)&&b.bars.length>=min&&!['STALE','UNAVAILABLE'].includes(String(b?.status||'').toUpperCase());
const mtfFrom=timeframes=>Object.fromEntries(['15M','1H','4H','1D'].filter(tf=>frameUsable(timeframes?.[tf],60)).map(tf=>[tf,timeframes[tf].bars]));
function resampleStored(bars,count,label){
  const groups=new Map(),out=[];
  for(const b of bars||[]){const k=b.session||b.date;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(b);}
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
function normalizeYahoo(result,tf){
  const q=result?.indicators?.quote?.[0]||{},ts=result?.timestamp||[],seconds=tf==='15M'?900:tf==='1H'?3600:tf==='4H'?3600:86400,now=Date.now()/1000,out=[];
  for(let i=0;i<ts.length;i++){const o=+q.open?.[i],h=+q.high?.[i],l=+q.low?.[i],c=+q.close?.[i],v=+q.volume?.[i];if(![o,h,l,c].every(Number.isFinite)||Math.min(o,h,l,c)<=0||h<Math.max(o,l,c)||l>Math.min(o,h,c))continue;if(tf!=='1D'&&ts[i]+seconds>now-60)continue;const date=new Date(ts[i]*1000).toISOString().slice(0,10);out.push({ts:ts[i],end_ts:ts[i]+seconds,date,session:date,open:o,high:h,low:l,close:c,volume:Number.isFinite(v)?v:null,complete:true});}
  return out;
}
function resample4h(bars){return resampleStored(bars,4,'1H');}
function chartUrl(symbol,interval,range){return 'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?'+new URLSearchParams({interval,range,includePrePost:'false',includeAdjustedClose:'false',events:'splits',_:String(Date.now())});}
async function publicFrame(sourceSymbol,tf,signal){
  const map={'15M':['15m','60d'],'1H':['60m','2y'],'1D':['1d','10y']},baseTf=tf==='4H'?'1H':tf,[interval,range]=map[baseTf]||map['1D'];
  const j=await json(chartUrl(sourceSymbol,interval,range),signal),r=j?.chart?.result?.[0];if(!r)throw new Error('Public live chart returned no data for '+sourceSymbol);
  let bars=normalizeYahoo(r,baseTf);if(tf==='4H')bars=resample4h(bars);if(bars.length<80)throw new Error('Not enough completed '+tf+' bars for '+sourceSymbol);
  return {tf,bars,meta:r.meta||{}};
}
async function publicBundle(symbol,asset,tf,signal){
  const sourceSymbol=yahooSymbol(symbol,asset),need=[...new Set([tf==='4H'?'1H':tf,'15M','1H','1D'])],tasks=await Promise.allSettled(need.map(x=>publicFrame(sourceSymbol,x,signal)));
  const frames={};let meta={};
  tasks.forEach((r,i)=>{if(r.status==='fulfilled'){frames[need[i]]=r.value.bars;meta={...meta,...r.value.meta};}});
  if(frames['1H'])frames['4H']=resample4h(frames['1H']);
  const bars=frames[tf];if(!Array.isArray(bars)||bars.length<80)throw new Error('Fresh on-demand '+tf+' bars unavailable for '+sourceSymbol);
  const last=bars.at(-1),kind=detectAsset(symbol,asset);
  return {symbol:clean(symbol),sourceSymbol,asset:kind,timeframe:tf,bars,mtf:frames,provider:'Fresh on-demand public market chart',fetchedAt:new Date().toISOString(),dataStatus:'FRESH ON-DEMAND',lastCompletedBar:last?.end_ts||null,quoteFromMeta:meta,credentialPolicy:'Fresh browser request uses a public market-data endpoint. GitHub API secrets remain server-side and are not exposed to this page.'};
}
async function storedStock(symbol,tf,signal){
  const raw=await json('../data/raw/'+encodeURIComponent(symbol)+'.json?'+Date.now(),signal),b=recoveredFrame(raw,tf);
  if(!usable(b))throw new Error('stored '+tf+' snapshot is missing, stale, or too shallow');
  const mtf={...mtfFrom(raw.timeframes)};if(!mtf[tf])mtf[tf]=b.bars;
  return {symbol,sourceSymbol:symbol,asset:raw.security_type||'STOCK',timeframe:tf,bars:b.bars,mtf,provider:b.provider||'GitHub sanitized stock snapshot',fetchedAt:b.fetched_at||raw.fetched_at,dataStatus:b.status||'UNKNOWN',lastCompletedBar:b.bars.at(-1)?.end_ts||null,snapshotQuote:raw.quote||null,credentialPolicy:'Sanitized GitHub snapshot generated by the secured server-side data pipeline.'};
}
async function futureSnapshot(symbol,tf,signal){
  const requested=clean(symbol),product=productOf(requested),snap=await json('../data/quant/'+encodeURIComponent(product)+'.json?'+Date.now(),signal),b=snap?.timeframes?.[tf];
  if(!usable(b))throw new Error('secure futures snapshot unavailable or stale');
  return {symbol:requested,sourceSymbol:b.source_symbol||snap.source_symbol||product,asset:'FUTURE',timeframe:tf,bars:b.bars,mtf:mtfFrom(snap.timeframes),provider:b.provider||snap.provider||'Secure futures snapshot',fetchedAt:b.fetched_at||snap.fetched_at,dataStatus:b.status||'COMPLETED BAR',lastCompletedBar:b.bars.at(-1)?.end_ts||null,credentialPolicy:'GitHub Actions secret -> sanitized OHLCV snapshot. No secret is sent to this page.'};
}
async function proxyFallback(symbol,tf,signal){
  const requested=clean(symbol),product=productOf(requested),proxy=METAL_PROXY[product];if(!proxy)throw new Error('no proxy fallback configured');
  const p=await storedStock(proxy,tf,signal);
  return {...p,symbol:requested,sourceSymbol:proxy,asset:'METAL_PROXY',provider:proxy+' ETF proxy fallback · futures sources unavailable',credentialPolicy:'Fallback uses the sanitized '+proxy+' ETF snapshot. It is a proxy for '+product+', not the futures contract.'};
}
async function apiContext(signal){try{return await json('../data/quant/context.json?'+Date.now(),signal);}catch{return null;}}
async function trainedModel(signal){try{return await json('../data/quant/model.json?'+Date.now(),signal);}catch{return null;}}

export async function loadFreshQuote({symbol,asset='AUTO',signal}){
  const requested=clean(symbol),sourceSymbol=yahooSymbol(requested,asset),url=chartUrl(sourceSymbol,'1m','1d');
  try{
    const j=await json(url,signal),r=j?.chart?.result?.[0];if(!r)throw new Error('no quote result');
    const m=r.meta||{},q=r.indicators?.quote?.[0]||{},ts=r.timestamp||[];let idx=ts.length-1;
    while(idx>=0&&!Number.isFinite(+q.close?.[idx]))idx--;
    const price=Number.isFinite(+m.regularMarketPrice)?+m.regularMarketPrice:(idx>=0?+q.close[idx]:null);
    const asOf=Number.isFinite(+m.regularMarketTime)?+m.regularMarketTime:(idx>=0?+ts[idx]:null);
    if(!Number.isFinite(price)||!Number.isFinite(asOf))throw new Error('quote fields unavailable');
    return {requestedSymbol:requested,sourceSymbol,price,asOf,currency:m.currency||null,marketState:m.marketState||m.market_state||'UNKNOWN',exchange:m.fullExchangeName||m.exchangeName||null,provider:'Fresh public 1-minute chart quote',fetchedAt:Date.now()/1000,isProxy:false};
  }catch(e){
    const product=productOf(requested),proxy=METAL_PROXY[product];
    if(proxy&&proxy!==requested){const p=await loadFreshQuote({symbol:proxy,asset:'STOCK',signal});return {...p,requestedSymbol:requested,isProxy:true,proxyFor:product,provider:p.provider+' · '+proxy+' proxy'};}
    try{const raw=await json('../data/raw/'+encodeURIComponent(requested)+'.json?'+Date.now(),signal),sq=raw?.quote;if(Number.isFinite(+sq?.price)&&Number.isFinite(+sq?.as_of))return {requestedSymbol:requested,sourceSymbol:requested,price:+sq.price,asOf:+sq.as_of,currency:sq.currency||null,marketState:raw?.market?.state||'UNKNOWN',exchange:null,provider:'Sanitized snapshot quote fallback',fetchedAt:Date.now()/1000,isProxy:false};}catch{}
    throw new Error(requested+' fresh quote unavailable');
  }
}

export async function loadMarketData({symbol,asset='AUTO',timeframe='1D',signal,preferFresh=true}){
  const s=clean(symbol),kind=detectAsset(s,asset),contextPromise=apiContext(signal),modelPromise=trainedModel(signal);let core,errors=[];
  if(preferFresh){
    try{core=await publicBundle(s,kind,timeframe,signal);}catch(e){errors.push('live: '+e.message);}
  }
  if(!core&&kind==='FUTURE'){try{core=await futureSnapshot(s,timeframe,signal);}catch(e){errors.push('futures snapshot: '+e.message);}}
  if(!core&&kind!=='FUTURE'){try{core=await storedStock(s,timeframe,signal);}catch(e){errors.push('snapshot: '+e.message);}}
  if(!core&&kind==='FUTURE'){try{core=await proxyFallback(s,timeframe,signal);}catch(e){errors.push('proxy: '+e.message);}}
  if(!core)throw new Error(s+' data unavailable. '+errors.join(' | '));
  return {...core,apiContext:await contextPromise,trainedModel:await modelPromise};
}
