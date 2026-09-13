import {finite,clamp,mean} from './numeric.mjs';
export function structure(b,tech,right=3){
  const pivots=[],events=[],states=[],broken=new Set();let direction=0;
  for(let i=0;i<b.length;i++){
    const j=i-right,a=tech.series.atr[j];
    if(j>=right&&finite(a)&&a>0){
      for(const type of ['H','L']){
        const price=b[j][type==='H'?'high':'low'];
        const isPivot=Array.from({length:right},(_,k)=>k+1).every(k=>type==='H'?
          price>b[j-k].high&&price>=b[j+k].high:price<b[j-k].low&&price<=b[j+k].low);
        if(!isPivot)continue;
        const previous=pivots.filter(p=>p.type===type).at(-1),opposite=pivots.filter(p=>p.type!==type).at(-1);
        const impulse=opposite?Math.abs(price-opposite.price)/a:(Math.max(...b.slice(j-right,j+right+1).map(x=>x.high))-Math.min(...b.slice(j-right,j+right+1).map(x=>x.low)))/a;
        const rv=tech.series.rvol[j],separation=previous?j-previous.i:right*2;
        const displacement=Math.abs(b[i].close-price)/a;
        const quality=Math.round(clamp(impulse/3,0,1)*40+clamp(separation/12,0,1)*20+(finite(rv)?clamp((rv-.5)/1.5,0,1)*15:0)+clamp(displacement/1.5,0,1)*25);
        const threshold=quality>=65?65:quality>=40?40:0,comparable=pivots.filter(p=>p.type===type&&p.quality>=threshold).at(-1);
        pivots.push({i:j,confirmed_at:i,ts:b[j].ts,confirmed_ts:b[i].end_ts,price,type,
          label:!comparable?type:type==='H'?(price>comparable.price?'HH':price<comparable.price?'LH':'EQH'):(price>comparable.price?'HL':price<comparable.price?'LL':'EQL'),
          quality,degree:quality>=65?'MAJOR':quality>=40?'MEANINGFUL':'MINOR',impulse_atr:impulse});
      }
    }
    const known=pivots.filter(p=>p.quality>=40),highs=known.filter(p=>p.type==='H'),lows=known.filter(p=>p.type==='L');
    const H=highs.at(-1),L=lows.at(-1),x=b[i],atr=tech.series.atr[i],newEvents=[];
    if(finite(atr)&&atr>0&&i){
      for(const [pivot,dir] of [[H,1],[L,-1]]){
        if(!pivot)continue;
        const id=pivot.type+':'+pivot.i,through=dir*(x.close-pivot.price)>.1*atr;
        if(through&&!broken.has(id)){
          const type=direction&&direction!==dir?'CHoCH':'BOS';
          newEvents.push({type,dir,i,ts:x.ts,confirmed_ts:x.end_ts,level:pivot.price,pivot_i:pivot.i,classification:'CALCULATION'});
          broken.add(id);direction=dir;
        }
      }
      // A sweep requires a level already known before this candle.
      const prior=states[i-1];
      for(const [p,dir] of [[prior?.lastLow,1],[prior?.lastHigh,-1]]){
        if(!p)continue;
        const wick=dir>0?x.low<p.price-.05*atr&&x.close>p.price:x.high>p.price+.05*atr&&x.close<p.price;
        if(wick)newEvents.push({type:'LIQUIDITY SWEEP',dir,i,ts:x.ts,confirmed_ts:x.end_ts,level:p.price,extreme:dir>0?x.low:x.high,classification:'PROXY'});
        if(dir*(b[i-1].close-p.price)<0&&dir*(x.close-p.price)>0)newEvents.push({type:dir>0?'FAILED BREAKDOWN / RECLAIM':'FAILED BREAKOUT / REJECTION',dir,i,ts:x.ts,confirmed_ts:x.end_ts,level:p.price,classification:'PROXY'});
      }
    }
    events.push(...newEvents);
    const clusters=[];
    if(finite(atr)&&atr>0)for(const p of known.filter(p=>p.i>=i-252)){
      const cluster=clusters.find(c=>Math.abs(c.price-p.price)<=.3*atr);
      if(cluster){cluster.members.push(p);cluster.price=mean(cluster.members.map(z=>z.price));cluster.quality=Math.max(cluster.quality,p.quality);}
      else clusters.push({price:p.price,quality:p.quality,members:[p]});
    }
    const levels=clusters.map(c=>({price:c.price,quality:c.quality,touches:c.members.length,known_at:Math.max(...c.members.map(p=>p.confirmed_at)),basis:'Confirmed pivot cluster',classification:'CALCULATION'}));
    const support=levels.filter(p=>p.price<x.close).sort((a,z)=>z.price-a.price),resistance=levels.filter(p=>p.price>x.close).sort((a,z)=>a.price-z.price);
    const pattern=highs.length>=2&&lows.length>=2?(H.price>highs.at(-2).price&&L.price>lows.at(-2).price?'HH / HL':H.price<highs.at(-2).price&&L.price<lows.at(-2).price?'LH / LL':'MIXED STRUCTURE'):'INSUFFICIENT SWINGS';
    states.push({i,direction,pattern,lastHigh:H||null,lastLow:L||null,support:support.slice(0,8),resistance:resistance.slice(0,8),newEvents,
      recentEvents:events.filter(e=>e.i>=i-10),knownPivots:known.slice(-16)});
  }
  return {classification:'CALCULATION',pivots,events,states,current:states.at(-1)||null,confirmation_bars:right};
}
