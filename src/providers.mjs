import {finite} from './numeric.mjs';
import {TIMEFRAMES} from './bars.mjs';
const SA='https://api.stockanalysis.com/api';
export const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9][A-Z0-9.\-^:=]{0,19}$/.test(s);
const unavailable=reason=>({classification:'UNAVAILABLE',status:'UNAVAILABLE',reason,bars:[],quality:'UNAVAILABLE'});
async function json(url,signal,timeout=12000){
  const r=await fetch(url,{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
  if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();
}
export function periodBars(bars,tf,calendar,now=Date.now()/1000){
  const groups=new Map(),schedule=calendar.sessions;
  for(const b of bars){
    const d=new Date(b.date+'T12:00:00Z');let k;
    if(tf==='1M')k=b.date.slice(0,7);else{d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);k=d.toISOString().slice(0,10);}
    if(!groups.has(k))groups.set(k,[]);groups.get(k).push(b);
  }
  const out=[];
  for(const [key,b] of groups){
    let keys;
    if(tf==='1M')keys=Object.keys(schedule).filter(d=>d.startsWith(key));
    else {const end=new Date(key+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);const endKey=end.toISOString().slice(0,10);keys=Object.keys(schedule).filter(d=>d>=key&&d<endKey);}
    if(!keys.length||keys.length!==b.length||keys.some((d,i)=>d!==b[i].date)||schedule[keys.at(-1)][1]+900>now)continue;
    out.push({ts:b[0].ts,end_ts:b.at(-1).end_ts,date:b[0].date,session:b[0].date,complete:true,open:b[0].open,high:Math.max(...b.map(x=>x.high)),low:Math.min(...b.map(x=>x.low)),close:b.at(-1).close,volume:b.every(x=>finite(x.volume))?b.reduce((s,x)=>s+x.volume,0):null});
  }
  return out;
}
export function parsePublicHistory(payload,symbol,calendar,now=Date.now()/1000){
  const rows=Array.isArray(payload.data)?payload.data:payload.data?.data;
  if(!Array.isArray(rows))throw new Error('No OHLCV history returned');
  const bars=[],forming=[],rejected=[];
  for(const r of rows){
    if(!r||Array.isArray(r)||!/^\d{4}-\d{2}-\d{2}$/.test(r.t))continue;
    const bounds=calendar.sessions[r.t];if(!bounds)continue;
    const b={ts:bounds[0],end_ts:bounds[1],date:r.t,session:r.t,open:r.o,high:r.h,low:r.l,close:r.c,volume:finite(r.v)?r.v:null,complete:bounds[1]+900<=now};
    // An asynchronous quote can be inconsistent with a forming OHLCV row.
    // It is kept in separate live context, never in technical calculations.
    if(!b.complete){forming.push(b);continue;}
    if(![b.open,b.high,b.low,b.close].every(finite)||Math.min(b.open,b.high,b.low,b.close)<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)){
      rejected.push({date:b.date,reason:'Invalid sourced OHLCV row'});continue;
    }
    bars.push(b);
  }
  bars.sort((a,b)=>a.ts-b.ts);
  if(!bars.length)throw new Error('No completed OHLCV history returned');
  if(bars.some((b,i)=>i&&b.ts===bars[i-1].ts))throw new Error('Duplicate daily bars from source');
  const gaps=bars.filter((b,i)=>i&&Math.abs(Math.log(b.open/bars[i-1].close))>.5).map(b=>b.date);
  const expected=Object.keys(calendar.sessions).filter(d=>calendar.sessions[d][1]+900<=now).at(-1);
  return {classification:'SOURCE FACT',provider:'Stock Analysis public price-history endpoint (unofficial)',source_url:`https://stockanalysis.com/stocks/${encodeURIComponent(symbol.toLowerCase())}/history/`,
    fetched_at:new Date(now*1000).toISOString(),interval:'1d',native:true,bars,forming_bars:forming,last_completed_bar:bars.at(-1).end_ts,
    status:bars.at(-1).date<expected?'STALE':rejected.length||gaps.length?'REVIEW':'COMPLETED BAR',quality:rejected.length||gaps.length?'REVIEW':'PASS',rejected,large_gap_dates:gaps,
    delay:'UNSPECIFIED BY ENDPOINT',adjustment:'Provider OHLCV as returned. Split methodology is not declared by this endpoint; no guessed adjustment. Large discontinuities block setup actions.',
    limitations:'Public endpoint is not a supported API contract. History depth and coverage can vary; no credentials or proxy used.'};
}
async function stockAnalysis(symbol,calendar,signal){
  let lastError;
  for(const type of ['s','e']){
    try{
      const q=await json(`${SA}/quotes/${type}/${encodeURIComponent(symbol)}`,signal);
      const quote=q.data;if(quote?.symbol?.toUpperCase()!==symbol)throw new Error('Quote ticker identity mismatch or unsupported ticker');
      const history=await json(`${SA}/symbol/${type}/${encodeURIComponent(symbol)}/history`,signal);
      const daily=parsePublicHistory(history,symbol,calendar);
      if(type==='e')daily.source_url=`https://stockanalysis.com/etf/${symbol.toLowerCase()}/history/`;
      const frames=Object.fromEntries(TIMEFRAMES.map(tf=>[tf,unavailable('No browser-safe intraday OHLCV source returned this component. Scheduled snapshots are optional supplements.')]));
      frames['1D']=daily;
      for(const tf of ['1W','1M']){
        const bars=periodBars(daily.bars,tf,calendar);
        frames[tf]={...daily,classification:'CALCULATION',native:false,interval:tf,resampled_from:'1D',bars,forming_bars:[],last_completed_bar:bars.at(-1)?.end_ts??null,status:bars.length?daily.status:'UNAVAILABLE'};
      }
      return {schema_version:5,symbol,name:symbol,fetched_at:daily.fetched_at,timeframes:frames,
        quote:{classification:finite(quote.p)?'SOURCE FACT':'UNAVAILABLE',price:finite(quote.p)?quote.p:null,change:finite(quote.c)?quote.c:null,change_pct:finite(quote.cp)?quote.cp:null,
          as_of:finite(quote.ts)?quote.ts/1000:null,fetched_at:daily.fetched_at,currency:'USD',provider:'Stock Analysis public quote endpoint',delay:'UNSPECIFIED BY ENDPOINT',status:'SNAPSHOT',source_url:daily.source_url},
        market:{classification:'SOURCE FACT',state:String(quote.ms||'UNAVAILABLE').toUpperCase(),as_of:finite(quote.ts)?quote.ts/1000:null,provider:'Stock Analysis quote market-status field'},
        fundamentals:unavailable('FUNDAMENTALS UNAVAILABLE: no browser-safe filing facts returned for this ticker.'),provider_errors:[],retrieval:'DIRECT BROWSER',security_type:type==='e'?'ETF':'STOCK'};
    }catch(e){if(signal?.aborted)throw e;lastError=e;}
  }
  throw new Error(`Direct public provider unavailable for ${symbol}: ${lastError?.message||'unknown error'}`);
}
export async function retrieveTicker(symbol,calendar,signal,{snapshotBase='../data/raw/'}={}){
  if(!validSymbol(symbol))throw new Error('Enter a valid stock or ETF ticker.');
  // No membership check: direct retrieval always runs, including never-seen symbols.
  const results=await Promise.allSettled([stockAnalysis(symbol,calendar,signal),json(`${snapshotBase}${encodeURIComponent(symbol)}.json`,signal,8000)]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const direct=results[0].status==='fulfilled'?results[0].value:null;
  const candidate=results[1].status==='fulfilled'?results[1].value:null;
  const cached=candidate?.symbol===symbol?candidate:null;
  if(!direct&&!cached)throw new Error(results[0].reason?.message||'Price/history unavailable. No previous ticker data has been retained.');
  if(!direct){return {...cached,retrieval:'SCHEDULED SNAPSHOT FALLBACK',provider_errors:[...(cached.provider_errors||[]),{provider:'Direct browser provider',error:results[0].reason?.message}],fallback_used:true};}
  if(cached){
    direct.name=cached.name||symbol;
    if(cached.fundamentals?.metrics)direct.fundamentals=cached.fundamentals;
    for(const tf of ['5M','15M','30M','1H','4H'])if(cached.timeframes?.[tf]?.bars?.length)direct.timeframes[tf]={...cached.timeframes[tf],supplement:'Scheduled GitHub snapshot'};
    // Prefer a whole deeper source series only after a same-date close cross-check.
    // Never splice heterogeneous OHLCV or silently change price basis.
    const cb=cached.timeframes?.['1D'],db=direct.timeframes['1D'];
    if(cb?.bars?.length>db.bars.length&&cb.bars.at(-1).date===db.bars.at(-1).date){
      const map=new Map(db.bars.slice(-20).map(b=>[b.date,b.close]));
      const pairs=cb.bars.slice(-20).filter(b=>map.has(b.date));
      const error=pairs.length?Math.max(...pairs.map(b=>Math.abs(b.close/map.get(b.date)-1))):Infinity;
      direct.cross_check={classification:'CALCULATION',overlap:pairs.length,max_close_difference:error,source_a:db.provider,source_b:cb.provider};
      if(pairs.length>=10&&error<=.005){
        for(const tf of ['1D','1W','1M'])direct.timeframes[tf]={...cached.timeframes[tf],supplement:'Whole deeper snapshot history; direct source cross-check passed'};
      }
    }
  }
  return direct;
}
