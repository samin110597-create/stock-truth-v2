import {finite} from './numeric.mjs';
import {TIMEFRAMES,canonical} from './bars.mjs';
const SA='https://api.stockanalysis.com/api';
export const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9][A-Z0-9.\-^:=]{0,19}$/.test(s);
const unavailable=reason=>({classification:'UNAVAILABLE',status:'UNAVAILABLE',reason,bars:[],quality:'UNAVAILABLE'});
export function marketSchedule(calendar,now=Date.now()/1000){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now*1000));
  const bounds=calendar.sessions[date],expected=Object.keys(calendar.sessions).filter(d=>calendar.sessions[d][1]+900<=now).at(-1);
  return {classification:'CALCULATION',state:bounds&&now>=bounds[0]&&now<bounds[1]?'OPEN':'CLOSED',date,session_open:bounds?.[0]??null,session_close:bounds?.[1]??null,expected_completed_daily:expected,as_of:now,provider:'XNYS exchange calendar; regular session only'};
}
export function refreshBlock(block,tf,calendar,now=Date.now()/1000){
  if(!block?.bars?.length)return block||unavailable('No source data.');
  const clean=canonical(block,now),bars=clean.bars,market=marketSchedule(calendar,now);
  let stale=!bars.length;
  if(tf==='1D')stale||=bars.at(-1)?.date<market.expected_completed_daily;
  else if(['5M','15M','30M','1H','4H'].includes(tf)){
    const seconds={'5M':300,'15M':900,'30M':1800,'1H':3600,'4H':14400}[tf];
    const recent=Object.entries(calendar.sessions).filter(([,s])=>s[0]<now).slice(-2);
    let expected=0;for(const [,s]of recent)for(let t=s[0];t<s[1];t+=seconds){const end=Math.min(t+seconds,s[1]);if(end+60<=now)expected=end;}
    stale||=(bars.at(-1)?.end_ts||0)<expected;
  }
  const dates=new Set(bars.map(b=>b.date));
  const missing=tf==='1D'&&bars.length?Object.keys(calendar.sessions).filter(d=>d>=bars[0].date&&d<=bars.at(-1).date&&!dates.has(d)):[];
  const review=clean.errors.length||block.quality==='REVIEW'||missing.length;
  return {...block,bars,status:stale?'STALE':review?'REVIEW':'COMPLETED BAR',quality:review?'REVIEW':'PASS',canonical_errors:clean.errors,missing_sessions:missing,last_completed_bar:bars.at(-1)?.end_ts??null};
}
// Explicit, bounded reconciliation. Every appended row preserves its actual source.
// No guessed split adjustment; all four prices must agree on at least 10 dates.
export function reconcileDaily(deep,current,calendar,now=Date.now()/1000){
  if(!deep?.bars?.length||deep.bars.length<=current.bars.length)return {block:current,check:null};
  const last=deep.bars.at(-1),replacementTimes=new Set(current.bars.filter(b=>b.ts>last.ts).map(b=>b.ts));
  // A rejected trailing source row can be resolved by a real, independently sourced
  // replacement. Interior omissions, split anomalies, or unexplained reviews cannot.
  const resolvedTrailing=deep.quality==='REVIEW'&&deep.rejected?.length>0&&
    deep.rejected.every(r=>r.reason==='Missing/invalid OHLC; not imputed'&&r.ts>last.ts&&replacementTimes.has(r.ts))&&
    !(deep.large_gaps?.length||deep.large_gap_dates?.length)&&!(deep.split_audit||[]).some(a=>a.status==='REVIEW')&&
    canonical(deep,now).errors.length===0;
  const checked=refreshBlock(resolvedTrailing?{...deep,quality:'PASS',resolved_rejections:deep.rejected,rejected:[]}:deep,'1D',calendar,now);
  if(checked.quality!=='PASS')return {block:current,check:{status:'REJECTED',reason:'Historical supplement failed integrity checks'}};
  const map=new Map(current.bars.map(b=>[b.date,b]));
  const pairs=checked.bars.filter(b=>map.has(b.date)).slice(-20);
  const error=pairs.length?Math.max(...pairs.flatMap(b=>['open','high','low','close'].map(k=>Math.abs(b[k]/map.get(b.date)[k]-1)))):null;
  const appended=current.bars.filter(b=>b.date>checked.bars.at(-1).date);
  const check={classification:'CALCULATION',overlap:pairs.length,max_ohlc_difference:error,source_a:current.provider,source_b:deep.provider,appended:appended.length,status:'REJECTED'};
  if(pairs.length<10||error>.005||appended.length>5||checked.bars.at(-1).date>current.bars.at(-1).date)return {block:current,check};
  const bars=[...checked.bars.map(b=>({...b,source_provider:b.source_provider||deep.provider})),...appended.map(b=>({...b,source_provider:current.provider}))];
  const merged=refreshBlock({...checked,bars,fetched_at:current.fetched_at,forming_bars:current.forming_bars,quality:current.quality,provider:appended.length?'Cross-checked Yahoo history + Stock Analysis recent bars':deep.provider,source_url:current.source_url,
    source_history:[{provider:deep.provider,fetched_at:deep.fetched_at,through:checked.bars.at(-1).date},{provider:current.provider,fetched_at:current.fetched_at,from:appended[0]?.date??null}],
    adjustment:'Original prices retained. Recent OHLC overlap checked within 0.5%; no price rescaling or guessed corporate-action correction.',cross_check:{...check,status:'PASS'},supplement:'Explicit source reconciliation; up to five newer completed bars'},'1D',calendar,now);
  return merged.quality==='PASS'?{block:merged,check:{...check,status:'PASS'}}:{block:current,check};
}
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
      const responses=await Promise.allSettled([json(`${SA}/quotes/${type}/${encodeURIComponent(symbol)}`,signal),json(`${SA}/symbol/${type}/${encodeURIComponent(symbol)}/history`,signal)]);
      const quote=responses[0].status==='fulfilled'?(responses[0].value.data||{}):{};
      if(quote?.symbol&&quote.symbol.toUpperCase()!==symbol)throw new Error('Quote ticker identity mismatch');
      if(responses[1].status!=='fulfilled')throw responses[1].reason;
      const history=responses[1].value;
      const daily=parsePublicHistory(history,symbol,calendar);
      if(type==='e')daily.source_url=`https://stockanalysis.com/etf/${symbol.toLowerCase()}/history/`;
      const frames=Object.fromEntries(TIMEFRAMES.map(tf=>[tf,unavailable('No browser-safe intraday OHLCV source returned this component. Scheduled snapshots are optional supplements.')]));
      frames['1D']=daily;
      for(const tf of ['1W','1M']){
        const bars=periodBars(daily.bars,tf,calendar);
        frames[tf]={...daily,classification:'CALCULATION',native:false,interval:tf,resampled_from:'1D',bars,forming_bars:[],last_completed_bar:bars.at(-1)?.end_ts??null,status:bars.length?daily.status:'UNAVAILABLE'};
      }
      return {schema_version:5,symbol,name:symbol,fetched_at:daily.fetched_at,timeframes:frames,
        quote:{classification:finite(quote.p)?'SOURCE FACT':'UNAVAILABLE',price:finite(quote.p)?quote.p:null,change:finite(quote.c)?quote.c:null,change_pct:finite(quote.cp)?quote.cp:null,session_date:quote.td||null,open:finite(quote.o)?quote.o:null,high:finite(quote.h)?quote.h:null,low:finite(quote.l)?quote.l:null,volume:finite(quote.v)?quote.v:null,exchange:quote.ex||null,
          as_of:finite(quote.ts)?quote.ts/1000:null,fetched_at:daily.fetched_at,currency:'USD',provider:'Stock Analysis public quote endpoint',delay:'UNSPECIFIED BY ENDPOINT',status:finite(quote.p)?'SNAPSHOT':'UNAVAILABLE',source_url:daily.source_url},
        market:{...marketSchedule(calendar),provider_state:quote.ms||null},
        fundamentals:unavailable('FUNDAMENTALS UNAVAILABLE: no browser-safe filing facts returned for this ticker.'),provider_errors:[],retrieval:'DIRECT BROWSER',security_type:type==='e'?'ETF':'STOCK'};
    }catch(e){if(signal?.aborted)throw e;lastError=e;}
  }
  throw new Error(`Direct public provider unavailable for ${symbol}: ${lastError?.message||'unknown error'}`);
}
export async function retrieveTicker(symbol,calendar,signal,{snapshotBase='../data/raw/',snapshot=null}={}){
  if(!validSymbol(symbol))throw new Error('Enter a valid stock or ETF ticker.');
  // No membership check: direct retrieval always runs, including never-seen symbols.
  const results=await Promise.allSettled([stockAnalysis(symbol,calendar,signal),snapshot?Promise.resolve(snapshot):json(`${snapshotBase}${encodeURIComponent(symbol)}.json`,signal,8000)]);
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const direct=results[0].status==='fulfilled'?results[0].value:null;
  const candidate=results[1].status==='fulfilled'?results[1].value:null;
  const cached=candidate?.symbol===symbol?candidate:null;
  if(!direct&&!cached)throw new Error(results[0].reason?.message||'Price/history unavailable. No previous ticker data has been retained.');
  if(!direct){return {...cached,market:marketSchedule(calendar),timeframes:Object.fromEntries(TIMEFRAMES.map(tf=>[tf,refreshBlock(cached.timeframes?.[tf],tf,calendar)])),retrieval:'SCHEDULED SNAPSHOT FALLBACK',provider_errors:[...(cached.provider_errors||[]),{provider:'Direct browser provider',error:results[0].reason?.message}],fallback_used:true};}
  if(cached){
    direct.name=cached.name||symbol;
    if(cached.fundamentals?.metrics)direct.fundamentals=cached.fundamentals;
    for(const tf of ['5M','15M','30M','1H','4H'])if(cached.timeframes?.[tf]?.bars?.length)direct.timeframes[tf]={...refreshBlock(cached.timeframes[tf],tf,calendar),supplement:'Scheduled GitHub snapshot'};
    const merged=reconcileDaily(cached.timeframes?.['1D'],direct.timeframes['1D'],calendar);direct.cross_check=merged.check;direct.timeframes['1D']=merged.block;
  }
  direct.timeframes['1D']=refreshBlock(direct.timeframes['1D'],'1D',calendar);
  for(const tf of ['1W','1M']){const d=direct.timeframes['1D'],bars=periodBars(d.bars,tf,calendar);direct.timeframes[tf]={...d,classification:'CALCULATION',native:false,interval:tf,resampled_from:'1D',bars,forming_bars:[],last_completed_bar:bars.at(-1)?.end_ts??null,status:bars.length?d.status:'UNAVAILABLE'};}
  return direct;
}
