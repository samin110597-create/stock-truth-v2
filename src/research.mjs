import {finite,sign,mean,quantile,wilson} from './numeric.mjs';
import {evidenceFamilies} from './setups.mjs';
export function researchRead(b,tech,st,rev){
  if(!b.length)return {label:'UNAVAILABLE',families:[],bull:[],bear:[],neutral:[],coverage:0};
  const i=b.length-1,f=evidenceFamilies(b,tech,st,rev,i,1),t=tech.snapshot,s=st.current,r=rev.current;
  const descriptions={trend:`Price / EMA20 / EMA50: ${t.intermediate_trend.toLowerCase()}.`,momentum:`RSI ${finite(t.rsi)?t.rsi.toFixed(1):'unavailable'}; MACD histogram ${finite(t.macd_hist)?t.macd_hist.toFixed(3):'unavailable'}.`,participation:`RVOL ${finite(t.rvol)?t.rvol.toFixed(2)+'×':'unavailable'}; CMF ${finite(t.cmf)?t.cmf.toFixed(3):'unavailable'}.`,structure:`${s.pattern}; last confirmed break ${s.direction>0?'up':s.direction<0?'down':'not established'}.`,higher_timeframe:'Direction of the latest fully observed prior week versus its 20-week average.'};
  const families=Object.entries(f.scores).map(([name,v])=>({name:name.replaceAll('_',' '),value:v,weight:f.weights[name],detail:descriptions[name],classification:finite(v)?'CALCULATION':'UNAVAILABLE'}));
  const signed=families.reduce((sum,x)=>sum+(finite(x.value)?x.value*x.weight:0),0);
  const label=f.available_weight<70?'INSUFFICIENT DATA':signed>=65?'STRONG BUY':signed>=25?'BUY':signed<=-65?'STRONG SELL':signed<=-25?'SELL':'HOLD / MIXED';
  let phase=r.dir&&r.stage!=='NO REVERSAL'?(r.dir>0?'BULLISH ':'BEARISH ')+r.stage:st.current.newEvents.some(e=>e.type==='BOS')?(s.direction>0?'BREAKOUT':'BREAKDOWN'):t.volatility_regime==='CONTRACTION'?'RANGE COMPRESSION':t.intermediate_trend==='BULLISH'&&b[i].close<t.ema[20]?'PULLBACK':t.intermediate_trend+' TREND';
  if(r.proxies.distribution)phase='DISTRIBUTION PROXY';else if(r.proxies.absorption)phase='ABSORPTION PROXY';else if(r.proxies.capitulation)phase='CAPITULATION PROXY';
  return {classification:'MODEL ESTIMATE',label,phase,signed_score:signed,coverage:f.available_weight,families,bull:families.filter(x=>x.value>0),bear:families.filter(x=>x.value<0),neutral:families.filter(x=>x.value===0||x.value===null),note:'Weighted technical stance. BUY/SELL describes the evidence balance; entry permission comes from the separate confirmed trade plan. This is not a win probability.'};
}
export function horizonResearch(b,tech){
  const t=tech.series,n=b.length;
  const bucket=i=>i>=59&&finite(t.ema[50][i])&&finite(t.rsi[i])?[sign(b[i].close-t.ema[20][i]),sign(t.ema[20][i]-t.ema[50][i]),t.rsi[i]>=55?1:t.rsi[i]<=45?-1:0].join(':'):null;
  const key=n?bucket(n-1):null;
  return [1,5,21,252].map(h=>{
    const returns=[];let next=60;
    for(let i=60;i+h<n;i++){if(i<next||!key||bucket(i)!==key)continue;returns.push(b[i+h].close/b[i].close-1);next=i+h+1;}
    const sample=returns.length,wins=returns.filter(r=>r>0).length;
    return {horizon:h,label:{1:'1 day',5:'1 week',21:'1 month',252:'1 year'}[h],n:sample,status:sample<30?'INSUFFICIENT DATA':'UNVERIFIED',positive_frequency:sample?wins/sample:null,ci95:wilson(wins,sample),median:sample?quantile(returns,.5):null,p20:sample?quantile(returns,.2):null,p80:sample?quantile(returns,.8):null,classification:sample?'CALCULATION':'UNAVAILABLE',method:'Non-overlapping historical returns following the same fixed EMA/RSI state; retrospective descriptive comparison, not calibrated forecast or verified edge.'};
  });
}
export function chartContext(b,tech,st){
  const gaps=[],patterns=[];
  for(let i=Math.max(2,b.length-100);i<b.length;i++){
    const x=b[i],p=b[i-1],a=tech.series.atr[i];
    for(const dir of [1,-1]){
      const low=dir>0?b[i-2].high:x.high,high=dir>0?x.low:b[i-2].low;
      if(finite(a)&&high-low>.1*a){const after=b.slice(i+1);if(!after.some(z=>dir>0?z.low<=low:z.high>=high))gaps.push({dir,low,high,ts:x.ts,known_at:x.end_ts,partially_tested:after.some(z=>dir>0?z.low<high:z.high>low),classification:'PROXY'});}
    }
    if(i<b.length-6)continue;
    if(x.close>x.open&&p.close<p.open&&x.open<=p.close&&x.close>=p.open)patterns.push({name:'Bullish body engulfing',dir:1,ts:x.ts,rule:'Bullish candle body engulfs the previous bearish body.',classification:'CALCULATION'});
    if(x.close<x.open&&p.close>p.open&&x.open>=p.close&&x.close<=p.open)patterns.push({name:'Bearish body engulfing',dir:-1,ts:x.ts,rule:'Bearish candle body engulfs the previous bullish body.',classification:'CALCULATION'});
    if(finite(tech.series.rvol[i])&&tech.series.rvol[i]>=1.5)patterns.push({name:'Volume expansion',dir:sign(x.close-x.open),ts:x.ts,rule:`Volume ${tech.series.rvol[i].toFixed(2)}× the prior 20-bar mean.`,classification:'CALCULATION'});
  }
  const s=st.current,lo=s?.lastLow?.price,hi=s?.lastHigh?.price;
  const range=finite(lo)&&finite(hi)&&hi>lo?{low:lo,high:hi,mid:(hi+lo)/2,location:(b.at(-1).close-lo)/(hi-lo),classification:'CALCULATION'}:null;
  return {gaps:gaps.slice(-12),patterns,range};
}
