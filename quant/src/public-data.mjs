// Browser-safe adapters. No credentials; source outages degrade independently.
const finite=Number.isFinite;
export function canonical(block,asOf=Date.now()/1000) {
  const bars=[],errors=[];let prev=-Infinity;
  for(const b of block?.bars||[]){
    const valid=[b.open,b.high,b.low,b.close,b.ts,b.end_ts].every(finite)&&
      Math.min(b.open,b.high,b.low,b.close)>0&&b.high>=Math.max(b.open,b.close,b.low)&&
      b.low<=Math.min(b.open,b.close,b.high)&&b.end_ts>b.ts&&b.ts>prev&&b.complete===true&&b.end_ts<=asOf;
    if(!valid){errors.push({ts:b.ts,reason:'Invalid, unordered, duplicate, forming, or future bar'});continue;}
    bars.push({...b,volume:finite(b.volume)&&b.volume>=0?b.volume:null});prev=b.ts;
  }
  return {bars,errors,quality:errors.length?'REVIEW':block?.quality||'UNAVAILABLE'};
}
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
export async function fetchJSON(url,signal,timeout=6500){
  const response=await fetch(url,{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error('Source HTTP '+response.status);
  return response.json();
}
const BASE='https://api.stockanalysis.com/api';
export async function publicQuote(symbol,signal){
  for(const type of ['s','e']){
    try{const j=await fetchJSON(`${BASE}/quotes/${type}/${encodeURIComponent(symbol)}`,signal),q=j.data;
      if(!q||q.symbol&&q.symbol.toUpperCase()!==symbol||!finite(q.p)||q.p<=0||!finite(q.ts))throw Error('No valid quote');
      return {symbol,price:q.p,as_of:q.ts/1000,change:q.c,change_pct:q.cp,currency:'USD',provider:'Stock Analysis public quote',fetched_at:new Date().toISOString(),delay:'Provider delay unspecified; market timestamp shown',api_secret_used:false};
    }catch(e){if(signal?.aborted)throw e;}
  }
  throw Error('Public quote unavailable');
}
export async function publicHistory(symbol,calendar,signal){
  for(const type of ['s','e']){
    try{return parsePublicHistory(await fetchJSON(`${BASE}/symbol/${type}/${encodeURIComponent(symbol)}/history`,signal),symbol,calendar);}
    catch(e){if(signal?.aborted)throw e;}
  }
  throw Error('Public daily history unavailable for '+symbol);
}
export function normalizeHistory(j,tf,calendar,now=Date.now()/1000){
  const out=[],seconds={'15M':900,'1H':3600,'4H':3600,'1D':86400}[tf];
  let rows=[];
  if(j.format==='massive')rows=(j.payload?.results||[]).map(b=>({t:b.t/1000,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v}));
  else {const r=j.payload?.chart?.result?.[0],q=r?.indicators?.quote?.[0];
    if(!r||!q)throw Error('No source OHLCV');
    rows=r.timestamp.map((t,i)=>({t,o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i],v:q.volume[i]}));
  }
  for(const b of rows){
    if(![b.t,b.o,b.h,b.l,b.c].every(finite)||Math.min(b.o,b.h,b.l,b.c)<=0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h))continue;
    const date=new Date(b.t*1000).toISOString().slice(0,10),bounds=calendar.sessions[date];if(!bounds)continue;
    const ts=tf==='1D'?bounds[0]:b.t,end=tf==='1D'?bounds[1]:Math.min(b.t+seconds,bounds[1]);
    if(ts<bounds[0]||ts>=bounds[1]||end+(tf==='1D'?900:60)>now)continue;
    out.push({ts,end_ts:end,date,session:date,open:b.o,high:b.h,low:b.l,close:b.c,volume:finite(b.v)?b.v:null,complete:true});
  }
  out.sort((a,b)=>a.ts-b.ts);
  let bars=out;
  if(tf==='4H'){
    bars=[];const groups=new Map();for(const b of out){const k=b.date; if(!groups.has(k))groups.set(k,[]);groups.get(k).push(b);}
    for(const g of groups.values())for(let i=0;i<g.length;i+=4){const z=g.slice(i,i+4),bounds=calendar.sessions[z[0].date],start=bounds[0]+Math.floor((z[0].ts-bounds[0])/14400)*14400,end=Math.min(start+14400,bounds[1]);
      if(z[0].ts!==start||z.at(-1).end_ts!==end||z.some((b,k)=>k&&b.ts!==z[k-1].end_ts))continue;
      bars.push({...z[0],end_ts:end,high:Math.max(...z.map(b=>b.high)),low:Math.min(...z.map(b=>b.low)),close:z.at(-1).close,volume:z.every(b=>finite(b.volume))?z.reduce((s,b)=>s+b.volume,0):null});
    }
  }
  return refreshBlock({bars,quality:'PASS',provider:j.provider,fetched_at:j.fetched_at},tf,calendar,now);
}
export async function publicResearch(symbol,signal){
  const base='https://tgmcharts.com/api/v1';
  const paths={summary:`summary/${symbol}`,income:`statements/${symbol}/income-statement?years=4`,balance:`statements/${symbol}/balance-sheet?period=quarterly&years=1`,cashflow:`statements/${symbol}/cash-flow?years=4`};
  const results=await Promise.allSettled(Object.values(paths).map(p=>fetchJSON(base+'/'+p,signal,8000))),data={},errors=[];
  results.forEach((r,i)=>{const name=Object.keys(paths)[i];if(r.status==='fulfilled'&&r.value?.symbol===symbol)data[name]=r.value;else errors.push(name+' unavailable');});
  return {symbol,fetched_at:new Date().toISOString(),fundamentals:{status:Object.keys(data).length?(errors.length?'PARTIAL':'AVAILABLE'):'UNAVAILABLE',provider:'TGMCharts · sourced financial statements',data,errors},macro:{status:'UNAVAILABLE',reason:'Use scheduled FRED context where available'}};
}
