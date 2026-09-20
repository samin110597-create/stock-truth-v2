import {finite,mean} from './numeric.mjs';
// A deliberately limited, causal Wyckoff interpretation of OHLCV. No ownership,
// order flow, point-and-figure cause count, or full phase sequence is inferred.
export function wyckoff(b,t){
  const history=[];let range=null,phase='INDETERMINATE',dir=0,spring=null,upthrust=null,breakout=null,test=null;
  const add=(type,i,level,detail,bias=0)=>{const e={type,i,ts:b[i].ts,known_at:b[i].end_ts,level,detail,dir:bias,classification:'PROXY'};history.push(e);return e;};
  const spaced=(values,predicate)=>{let last=-10,count=0;values.forEach((x,j)=>{if(j-last>=4&&predicate(x)){last=j;count++;}});return count;};
  for(let i=40;i<b.length;i++){
    const a=t.series.atr[i-1];if(!finite(a)||a<=0)continue;
    const x=b[i],rv=t.series.rvol[i],loc=(x.close-x.low)/(x.high-x.low||1);
    if(range&&(i-range.known_i>120||x.close>range.high+range.width*1.5||x.close<range.low-range.width*1.5))range=null;
    if(!range){
      const z=b.slice(i-40,i),hi=Math.max(...z.map(v=>v.high)),lo=Math.min(...z.map(v=>v.low)),width=hi-lo;
      const travel=z.slice(1).reduce((s,v,j)=>s+Math.abs(v.close-z[j].close),0),efficiency=travel?Math.abs(z.at(-1).close-z[0].close)/travel:1;
      const band=Math.min(a,width*.15),upper=spaced(z,v=>v.high>=hi-band),lower=spaced(z,v=>v.low<=lo+band);
      if(width<2*a||width>12*a||efficiency>.4||upper<2||lower<2)continue;
      range={low:lo,high:hi,width,from:b[i-40].date,known_at:b[i-1].end_ts,known_i:i-1,upper_tests:upper,lower_tests:lower};
      phase='B · RANGE CANDIDATE';dir=0;spring=null;upthrust=null;breakout=null;test=null;
      add('RANGE ESTABLISHED',i,(hi+lo)/2,'40 prior completed candles; repeated, separated boundary tests. Phase A is not established.');
    }
    const {low,high,width}=range;
    if(x.low<low-.05*a&&x.low>low-2*a&&x.close>low&&x.close<high){
      spring={...add('SPRING CANDIDATE',i,low,'Price pierced known support and closed inside the range. Later testing or strength is still required.',1),extreme:x.low,rvol:rv};
      upthrust=null;breakout=null;test=null;dir=1;phase='C · SPRING CANDIDATE';
    }else if(x.high>high+.05*a&&x.high<high+2*a&&x.close<high&&x.close>low){
      upthrust={...add('UPTHRUST CANDIDATE',i,high,'Price pierced known resistance and closed inside. UTAD is unconfirmed without the earlier distribution sequence.',-1),extreme:x.high,rvol:rv};
      spring=null;breakout=null;test=null;dir=-1;phase='C · UPTHRUST CANDIDATE';
    }
    if(spring&&i>spring.i&&x.low<spring.extreme){add('SPRING INVALIDATED',i,spring.extreme,'The spring low was breached.');spring=null;breakout=null;dir=0;phase='B · RANGE CANDIDATE';test=null;}
    if(upthrust&&i>upthrust.i&&x.high>upthrust.extreme){add('UPTHRUST INVALIDATED',i,upthrust.extreme,'The upthrust high was breached.');upthrust=null;breakout=null;dir=0;phase='B · RANGE CANDIDATE';test=null;}
    const event=spring||upthrust;
    if(event&&!test&&i>=event.i+2&&i<=event.i+15&&finite(rv)&&finite(event.rvol)&&rv<event.rvol*.8&&
       (spring?x.low<=low+.5*a&&x.low>=spring.extreme&&x.close>low:x.high>=high-.5*a&&x.high<=upthrust.extreme&&x.close<high)){
      test=add(spring?'SPRING TEST':'UPTHRUST TEST',i,spring?x.low:x.high,'A later boundary test held on lower relative volume; a price/volume proxy.',spring?1:-1);
    }
    if(!breakout&&finite(rv)&&rv>=1.15&&(x.high-x.low)>=a&&((x.close>high+.2*a&&loc>.65)||(x.close<low-.2*a&&loc<.35))){
      dir=x.close>high?1:-1;
      breakout=add(dir>0?'SIGN OF STRENGTH':'SIGN OF WEAKNESS',i,dir>0?high:low,'Completed range breakout with spread ≥ prior ATR and relative volume ≥ 1.15×.',dir);
      phase='D · '+(dir>0?'STRENGTH':'WEAKNESS')+' CANDIDATE';
    }
    if(breakout&&i>breakout.i){
      const level=breakout.level;
      if(dir*(x.close-level)<-.4*a){add('BREAKOUT FAILED',i,level,'Price closed back inside the established range.');breakout=null;dir=0;phase='B · RANGE CANDIDATE';}
      else if(i>breakout.i+1&&finite(rv)&&rv<1&&((dir>0&&x.low<=level+.5*a&&x.close>level)||(dir<0&&x.high>=level-.5*a&&x.close<level))){
        if(!test||test.i<breakout.i)test=add(dir>0?'LPS CANDIDATE':'LPSY CANDIDATE',i,level,'A quieter post-breakout retest held the broken boundary.',dir);
      }
      if(breakout&&i>=breakout.i+3&&b.slice(i-2,i+1).every(v=>dir*(v.close-level)>.2*a))phase='E · '+(dir>0?'MARKUP':'MARKDOWN')+' CANDIDATE';
    }
    // A climax requires both an extreme and a preceding directional move.
    if(finite(rv)&&rv>=2.5&&x.high-x.low>=2*a){
      const change=x.close-b[Math.max(0,i-10)].close;
      if(x.low<=low+.3*a&&change<-2*a&&loc>.55)add('SELLING CLIMAX PROXY',i,x.low,'High spread/volume into a falling low with rejection; stopping action needs later confirmation.',1);
      if(x.high>=high-.3*a&&change>2*a&&loc<.45)add('BUYING CLIMAX PROXY',i,x.high,'High spread/volume into a rising high with rejection; distribution is not proven.',-1);
    }
  }
  const last=b.at(-1),a=t.series.atr.at(-1),active=range&&last;
  const invalidation=active?(dir>0?(spring?.extreme??range.low):dir<0?(upthrust?.extreme??range.high):null):null;
  const objective=active&&breakout?breakout.level+dir*range.width:null;
  return {classification:'PROXY',status:b.length<60?'INSUFFICIENT DATA':active?'INTERPRETATION':'NO QUALIFYING RANGE',phase:active?phase:'INDETERMINATE',bias:active?(dir>0?'ACCUMULATION / MARKUP LEAN':dir<0?'DISTRIBUTION / MARKDOWN LEAN':'BALANCED RANGE'):'UNDETERMINED',dir:active?dir:0,range:active?range:null,invalidation,
    objective:finite(objective)&&objective>0?{price:objective,status:dir*(last.close-objective)>=0?'ALREADY REACHED':'CONDITIONAL',basis:'One range-height extension from the broken boundary; not a Wyckoff point-and-figure count.'}:null,
    events:history.slice(-18),volume_available:finite(t.series.rvol.at(-1)),next:!active?'Wait for a two-sided range with repeated boundary tests.':breakout?'Monitor the broken boundary for a successful retest or a completed close back inside.':spring?'Look for a lower-volume test and then a completed break above the range.':upthrust?'Look for a lower-volume retest and then a completed break below the range.':'A sweep/reclaim or a volume-backed boundary break is needed for a directional interpretation.',
    note:'Algorithmic Wyckoff candidates, not a full discretionary phase count. Accumulation/distribution are OHLCV proxies, not observed institutional inventory. Boundaries are frozen when established; events use only information then available.'};
}
