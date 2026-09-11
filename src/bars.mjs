import {finite} from './numeric.mjs';
export const TIMEFRAMES=['5M','15M','30M','1H','4H','1D','1W','1M'];
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
export function completedDailyPeriods(bars,timeframe) {
  // Retrospective as-of mapping: a period is available only after the next period
  // begins in the input. Conservative on Friday/month-end; never leaks a future bar.
  const groups=[];
  const key=b=>{
    const d=new Date(b.date+'T12:00:00Z');
    if(timeframe==='1M')return b.date.slice(0,7);
    const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);
  };
  for(const b of bars){
    const k=key(b),g=groups.at(-1);
    if(!g||g.key!==k)groups.push({key:k,rows:[b]});else g.rows.push(b);
  }
  return groups.slice(1,-1).map(g=>{
    const b=g.rows;return {ts:b[0].ts,end_ts:b.at(-1).end_ts,date:b[0].date,complete:true,
      open:b[0].open,high:Math.max(...b.map(x=>x.high)),low:Math.min(...b.map(x=>x.low)),close:b.at(-1).close,
      volume:b.every(x=>finite(x.volume))?b.reduce((s,x)=>s+x.volume,0):null};
  });
}
export function dataHealth(raw,now=Date.now()/1000) {
  const block=raw?.timeframes?.['1D'], bars=block?.bars||[], q=raw?.quote||{};
  const age=Date.parse(block?.fetched_at||'')/1000;
  const stale=!finite(age)||(now-age>7200&&raw?.market?.state==='OPEN')||now-age>7*86400||block?.status==='STALE';
  const invalid=block?.quality==='REVIEW'||!bars.length;
  return {status:!bars.length?'UNAVAILABLE':stale?'STALE':invalid?'REVIEW':'PASS',
    tradeable:!stale&&!invalid,quote_age_seconds:finite(q.as_of)?Math.max(0,now-q.as_of):null,
    fetched_age_seconds:finite(age)?Math.max(0,now-age):null,
    note:'Snapshot freshness is separate from candle completion. Provider latency is unspecified.'};
}
