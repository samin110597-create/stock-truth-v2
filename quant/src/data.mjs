import {freshestQuote} from './freshness.mjs';
import {fetchJSON as json,publicQuote,publicHistory,publicResearch,normalizeHistory,refreshBlock} from './public-data.mjs';
const PRODUCTS={GOLD:'GC',XAU:'GC',XAUUSD:'GC',GC:'GC',SILVER:'SI',XAG:'SI',XAGUSD:'SI',SI:'SI',OIL:'CL',WTI:'CL',CRUDE:'CL',CL:'CL',NATGAS:'NG',NATURALGAS:'NG',NG:'NG',COPPER:'HG',HG:'HG',PLATINUM:'PL',PL:'PL',PALLADIUM:'PA',PA:'PA',CORN:'ZC',ZC:'ZC',WHEAT:'ZW',ZW:'ZW',SOY:'ZS',SOYBEANS:'ZS',ZS:'ZS'};
const METAL_PROXY={GC:'GLD',SI:'SLV'};
const CONTRACT=/^[A-Z]{1,3}[FGHJKMNQUVXZ]\d{1,2}$/;
const clean=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
export function detectAsset(symbol,choice='AUTO'){if(choice&&choice!=='AUTO')return choice;const s=clean(symbol);return PRODUCTS[s]||CONTRACT.test(s)?'FUTURE':'STOCK';}
let configPromise,calendarPromise;
const circuits=new Map();
async function config(){return configPromise??=json(new URL('../runtime-config.json',import.meta.url),null,4000).catch(()=>{configPromise=null;return {apiBase:''};});}
async function calendar(){return calendarPromise??=json(new URL('../../data/calendar.json',import.meta.url),null,5000).catch(e=>{calendarPromise=null;throw e;});}
async function gateway(route,symbol,tf,signal){
  const cfg=await config(),base=String(cfg.apiBase||'').replace(/\/$/,'');
  if(!base||/\.deno\.net/.test(base))throw Error('Secure gateway not configured');
  if((circuits.get(route)||0)>Date.now())throw Error('Gateway cooling down after an outage');
  try{const j=await json(base+route+'?'+new URLSearchParams({symbol,...(tf?{timeframe:tf}:{})}),signal,6500);
    if(j.symbol!==symbol||j.error)throw Error('Gateway response does not match requested ticker');return j;
  }catch(e){if(!signal?.aborted)circuits.set(route,Date.now()+90000);throw e;}
}
const frames=['15M','1H','4H','1D'];
const sufficientlyDeep=b=>Array.isArray(b?.bars)&&b.bars.length>=80;
function bundle(symbol,tf,block,timeframes,extra={}){
  return {symbol,sourceSymbol:symbol,asset:'STOCK',timeframe:tf,bars:block.bars,mtf:Object.fromEntries(frames.filter(t=>timeframes[t]?.bars?.length>=60&&timeframes[t].status!=='STALE').map(t=>[t,timeframes[t].bars])),provider:block.provider||'Saved data',fetchedAt:block.fetched_at,dataStatus:block.status||'UNKNOWN',lastCompletedBar:block.bars.at(-1)?.end_ts,credentialPolicy:'Provider secrets stay on the server. Browser fallbacks require no credentials.',...extra};
}
async function saved(symbol,signal){try{const j=await json('../data/raw/'+encodeURIComponent(symbol)+'.json',signal,4000);return j.symbol===symbol?j:null;}catch{return null;}}
export async function currentQuote(symbol,signal){
  const s=clean(symbol);if(!/^[A-Z0-9][A-Z0-9.\-^:=]{0,19}$/.test(s))return null;
  const results=await Promise.allSettled([gateway('/v1/quote',s,null,signal),publicQuote(s,signal),saved(s,signal)]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  return freshestQuote(s,results.flatMap((r,i)=>r.status==='fulfilled'?(i===2?[r.value?.quote,...(r.value?.secured_quote_candidates||[])]:[r.value]):[]));
}
export async function loadMarketData({symbol,asset='AUTO',timeframe='1D',signal,quotePromise=null}){
  const s=clean(symbol),kind=detectAsset(s,asset);
  if(!/^[A-Z0-9][A-Z0-9.\-^:=]{0,19}$/.test(s)||!frames.includes(timeframe))throw Error('Enter a valid ticker and timeframe.');
  const cal=await calendar();
  const contextPromise=json('../data/quant/context.json',signal,4000).catch(()=>null),modelPromise=json('../data/quant/model.json',signal,4000).catch(()=>null);
  const researchPromise=publicResearch(s,signal).catch(()=>({fundamentals:{status:'UNAVAILABLE',reason:'Fundamentals source unavailable'}}));
  const quoteTask=quotePromise|| (kind==='STOCK'?currentQuote(s,signal).catch(()=>null):Promise.resolve(null));
  let core;
  if(kind==='FUTURE'){
    const product=PRODUCTS[s]||s.replace(/[FGHJKMNQUVXZ]\d{1,2}$/,'');
    try{const snap=await json('../data/quant/'+encodeURIComponent(product)+'.json',signal,4000),block=snap.timeframes?.[timeframe];
      if(!sufficientlyDeep(block))throw Error('Insufficient futures data');
      // Futures sessions differ from XNYS. Never certify old snapshots as current.
      const age=Date.now()-Date.parse(block.fetched_at||snap.fetched_at||'');
      core=bundle(s,timeframe,{...block,status:Number.isFinite(age)&&age<3600000?block.status:'STALE'},snap.timeframes,{sourceSymbol:block.source_symbol||snap.source_symbol||product,asset:'FUTURE'});
    }catch{
      const proxy=METAL_PROXY[product];if(!proxy)throw Error('Futures data unavailable for '+s);
      const data=await loadMarketData({symbol:proxy,asset:'STOCK',timeframe,signal});
      return {...data,symbol:s,sourceSymbol:proxy,asset:'METAL_PROXY',quote:null,provider:proxy+' ETF PROXY · '+data.provider,notice:proxy+' is an ETF proxy, not the '+s+' futures or spot price.'};
    }
  }else{
    // Request-time retrieval is independent of repository membership and scheduled jobs.
    const results=await Promise.allSettled([
      gateway('/v1/history',s,timeframe,signal).then(j=>normalizeHistory(j,timeframe,cal)),
      publicHistory(s,cal,signal),saved(s,signal)
    ]);
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const secure=results[0].status==='fulfilled'?results[0].value:null,daily=results[1].status==='fulfilled'?results[1].value:null,raw=results[2].status==='fulfilled'?results[2].value:null;
    const timeframes={};for(const tf of frames){if(raw?.timeframes?.[tf])timeframes[tf]=refreshBlock(raw.timeframes[tf],tf,cal);}
    // Choose newest completed history; prefer clean source when equally current.
    const choose=(a,b)=>[a,b].filter(sufficientlyDeep).sort((x,y)=>(y.bars.at(-1).end_ts-x.bars.at(-1).end_ts)||Number(x.status==='REVIEW')-Number(y.status==='REVIEW'))[0];
    if(daily)timeframes['1D']=choose(daily,timeframes['1D']);
    if(secure)timeframes[timeframe]=choose(secure,timeframes[timeframe]);
    let actual=timeframe,block=timeframes[actual],notice='';
    if((!sufficientlyDeep(block)||block.status==='STALE')&&timeframe!=='1D'&&sufficientlyDeep(timeframes['1D'])){actual='1D';block=timeframes['1D'];notice=timeframe+' UNAVAILABLE / STALE · Showing daily analysis instead. No intraday signal is implied.';}
    if(!sufficientlyDeep(block))throw Error('History unavailable or fewer than 80 completed bars for '+s+'. The quote can still be refreshed independently.');
    core=bundle(s,actual,block,timeframes,{requestedTimeframe:timeframe,notice,onDemand:block===secure,quote:raw?.quote});
  }
  const [quote,apiContext,trainedModel,research,cfg]=await Promise.all([quoteTask,contextPromise,modelPromise,researchPromise,config()]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  return {...core,quote:freshestQuote(s,[core.quote,quote]),apiContext,trainedModel,research,runtimeApiConfigured:!!cfg.apiBase};
}
