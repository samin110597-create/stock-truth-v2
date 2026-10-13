import {ema,rsi,rollingMean,trueRange} from './math.mjs';
import {structureEngine} from './engine.mjs';
const finite=Number.isFinite;
const week=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()-((x.getUTCDay()+6)%7));return x.toISOString().slice(0,10);};
export function completedWeeks(daily,calendar,now=Date.now()/1000){
 const sessions=Object.entries(calendar?.sessions||{}).sort(([a],[b])=>a.localeCompare(b)),groups=new Map(),byDate=new Map((daily?.bars||[]).map(b=>[b.date,b]));
 for(const [d,bounds]of sessions){const key=week(d);if(!groups.has(key))groups.set(key,[]);groups.get(key).push([d,bounds]);}
 const bars=[];let latestExpected=null;
 for(const [key,days]of groups){const last=days.at(-1)[1][1];if(last+900>now)continue;latestExpected=last;
  const z=days.map(([d])=>byDate.get(d));if(z.some(b=>!b||!b.complete||b.end_ts>now))continue;
  bars.push({ts:z[0].ts,end_ts:last,date:key,session:key,open:z[0].open,high:Math.max(...z.map(b=>b.high)),low:Math.min(...z.map(b=>b.low)),close:z.at(-1).close,volume:z.every(b=>finite(b.volume))?z.reduce((a,b)=>a+b.volume,0):null,complete:true});
 }
 const missingInside=bars.length&&[...groups].some(([key,days])=>key>=bars[0].date&&days.at(-1)[1][1]<=bars.at(-1).end_ts&&!bars.some(b=>b.date===key));
 const status=!bars.length?'UNAVAILABLE':bars.at(-1).end_ts!==latestExpected?'STALE':daily?.quality==='REVIEW'||missingInside?'REVIEW':'COMPLETED BAR';
 return {bars,status,provider:(daily?.provider||'Daily source')+' · complete calendar weeks',fetched_at:daily?.fetched_at};
}
export function studyFrame(tf,block){
 const bars=block?.bars||[],minimum=tf==='1W'?25:60;
 if(block?.status!=='COMPLETED BAR'||bars.length<minimum)return {tf,status:block?.status==='COMPLETED BAR'?'INSUFFICIENT DATA':block?.status||'UNAVAILABLE',count:bars.length,provider:block?.provider,last:bars.at(-1)?.end_ts};
 const c=bars.map(b=>b.close),avg=ema(c,20),slow=ema(c,50),momentum=rsi(c,14),s=structureEngine(bars,momentum),i=c.length-1,b=bars[i];
 const trend=c[i]>avg[i]&&avg[i]>avg[i-3]?1:c[i]<avg[i]&&avg[i]<avg[i-3]?-1:0;
 const direction=s.direction&&trend===s.direction?trend:0;
 const recent=s.events.filter(e=>e.i>=bars.length-5).slice(-3).map(e=>({...e,at:bars[e.i].end_ts}));
 const priorVolume=bars.slice(-21,-1).map(b=>b.volume),vol=priorVolume.length===20&&priorVolume.every(finite)&&priorVolume.every(x=>x>=0)?priorVolume.reduce((a,b)=>a+b,0)/20:null;
 const atr=rollingMean(trueRange(bars),14).at(-1),range=b.high-b.low;
 return {tf,status:'COMPLETED BAR',count:bars.length,provider:block.provider,last:b.end_ts,close:b.close,direction,trend,pattern:s.pattern,structureDirection:s.direction,support:s.support.map(x=>x.price),resistance:s.resistance.map(x=>x.price),events:recent,rsi:momentum[i],average20:avg[i],average50:slow[i],volumeRatio:finite(vol)&&vol>0&&finite(b.volume)?b.volume/vol:null,typicalMove:atr,closeLocation:range>0?(b.close-b.low)/range:null,change5:i>=5?(b.close/c[i-5]-1)*100:null,divergence:s.divergence&&s.divergence.i>=bars.length-10?s.divergence:null};
}
export function priceStudy(blocks,calendar,now=Date.now()/1000){
 const weekly=completedWeeks(blocks?.['1D'],calendar,now);
 return ['1H','4H','1D','1W'].map(tf=>{
  let block=tf==='1W'?weekly:blocks?.[tf];
  if(['1H','4H'].includes(tf)&&block?.status==='COMPLETED BAR'&&block.bars.length){
   const width=tf==='1H'?3600:14400,first=block.bars[0].ts,last=block.bars.at(-1).end_ts,expected=new Map();
   for(const [open,close]of Object.values(calendar?.sessions||{}))for(let ts=open;ts<close&&ts<last;ts+=width)if(ts>=first)expected.set(ts,Math.min(ts+width,close));
   const actual=new Map(block.bars.map(b=>[b.ts,b.end_ts]));
   if(actual.size!==expected.size||[...expected].some(([ts,end])=>actual.get(ts)!==end))block={...block,status:'REVIEW'};
  }
  return studyFrame(tf,block);
 });
}
