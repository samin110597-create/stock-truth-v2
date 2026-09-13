import {finite,clamp,sign,mean} from './numeric.mjs';
export const MODEL_VERSION='5.1.0-restored-terminal';
const weeklyCache=new WeakMap();
export function weeklyDirection(bars,i){
  let cached=weeklyCache.get(bars);
  if(!cached||cached.length!==bars.length){
    const completed=[],values=[];let previousKey=null,previousClose=null;
    for(const bar of bars){
      const d=new Date(bar.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
      const key=d.toISOString().slice(0,10);
      if(previousKey!==null&&key!==previousKey)completed.push(previousClose);
      // Omit the first potentially partial week; the current week is never used.
      const observed=completed.slice(1);
      values.push(observed.length<20?null:sign(observed.at(-1)-mean(observed.slice(-20))));
      previousKey=key;previousClose=bar.close;
    }
    cached={length:bars.length,values};weeklyCache.set(bars,cached);
  }
  return cached.values[i]??null;
}
export function evidenceFamilies(b,tech,st,rev,i,dir,context={}){
  const t=tech.series,a=t.atr[i],c=b[i].close,s=st.states[i],r=rev.states[i];
  const trend=finite(t.ema[50][i])?mean([sign(c-t.ema[20][i],.1*a),sign(t.ema[20][i]-t.ema[50][i],.1*a)]):null;
  const momentum=finite(t.rsi[i])&&finite(t.hist[i])?mean([sign(t.rsi[i]-50,3),sign(t.hist[i],.05*a)]):null;
  const participation=finite(t.rvol[i])&&finite(t.cmf[i])?mean([t.rvol[i]>=1.15?sign(b[i].close-b[i].open):0,sign(t.cmf[i],.05)]):null;
  const structure=s?.direction||0,weekly=context.weekly??weeklyDirection(b,i);
  const scores={trend,momentum,participation,structure,higher_timeframe:weekly};
  const weights={trend:25,momentum:20,participation:15,structure:25,higher_timeframe:15};
  let points=0,available=0;for(const [key,value]of Object.entries(scores))if(finite(value)){available+=weights[key];points+=weights[key]*clamp((dir*value+1)/2,0,1);}
  return {scores,weights,score:Math.round(points),available_weight:available,reversalSupport:r?.dir===dir&&['REVERSAL DEVELOPING','REVERSAL CONFIRMED'].includes(r.stage),weekly_conflict:finite(weekly)&&dir*weekly<0,classification:'CALCULATION'};
}
export function confirmsReaction(b,i,anchor,dir,atr,strict=false){
  if(!i||!finite(anchor)||!finite(atr))return false;
  const x=b[i],span=x.high-x.low;
  const touches=x.low<=anchor+.25*atr&&x.high>=anchor-.25*atr;
  const rejects=dir*(x.close-anchor)>=0&&dir*(x.close-x.open)>0&&span>0&&dir*(x.close-(x.high+x.low)/2)>0;
  return touches&&rejects&&(!strict||dir*(x.close-b[i-1].close)>.1*atr);
}
export function setupAt(b,tech,st,rev,i,mode='Adaptive',horizon='SWING',context={}){
  if(i<59)return {status:'INSUFFICIENT DATA',setup:null,reason:'At least 60 completed bars are required.'};
  const x=b[i],s=st.states[i],r=rev.states[i],a=tech.series.atr[i],strict=mode==='Strict';
  if(!finite(a)||a<=0)return {status:'NO EDGE',setup:null,reason:'Valid ATR is unavailable.'};
  const candidates=[];
  for(const dir of [1,-1]){
    const families=evidenceFamilies(b,tech,st,rev,i,dir,context);
    const support=(dir>0?s.support:s.resistance)[0];
    const br=s.recentEvents.filter(e=>['BOS','CHoCH'].includes(e.type)&&e.dir===dir).at(-1);
    const side=r?.sides?.find(z=>z.dir===dir),sw=side?.sweep;
    const e20=tech.series.ema[20][i],e50=tech.series.ema[50][i];
    const trend=finite(e50)&&dir*(e20-e50)>0&&dir*(x.close-e50)>0;
    const reaction=anchor=>confirmsReaction(b,i,anchor,dir,a,strict);
    let kind=null,anchor=null,invalid=null,eventId=null,trigger=null;
    const reversal=sw&&side?.stage!=='NO REVERSAL'&&side.families>=2&&i-sw.i<=5&&(!strict||side.strict_reversal);
    if(reversal&&reaction(sw.level)){
      kind='REVERSAL';anchor=sw.level;invalid=sw.extreme-dir*.3*a;eventId='REV:'+sw.ts;
      trigger='A completed sweep/reclaim rejection is present. Only a later retest inside the frozen entry zone is eligible.';
    }else if(br&&i-br.i<=5&&dir*(x.close-br.level)>=0&&
      (i===br.i&&dir*(x.close-x.open)>=.25*a||i>br.i&&reaction(br.level))){
      kind=i===br.i?'BREAKOUT':'RETEST';anchor=br.level;
      const protectedSwing=dir>0?s.lastLow:s.lastHigh;
      invalid=(dir>0?Math.min(protectedSwing?.price??b[br.i].low,b[br.i].low):Math.max(protectedSwing?.price??b[br.i].high,b[br.i].high))-dir*.2*a;
      eventId='BREAK:'+br.confirmed_ts;trigger='Confirmed structural break. Enter only on a subsequent retest; a breakout print is not a fill.';
    }else if(trend){
      const structural=support&&reaction(support.price)?support.price:null;
      const emaReclaim=finite(e20)&&reaction(e20)&&dir*(b[i-1].close-tech.series.ema[20][i-1])<=0;
      anchor=structural??(emaReclaim?e20:null);
      if(anchor!==null){kind='PULLBACK RECLAIM';const pivot=dir>0?s.lastLow:s.lastHigh;invalid=(dir>0?Math.min(x.low,pivot?.price??x.low):Math.max(x.high,pivot?.price??x.high))-dir*.25*a;
        eventId='RECLAIM:'+x.end_ts;trigger='Completed rejection/reclaim in the prevailing trend. A later visit to the zone is required.';}
    }
    if(!kind||!finite(anchor)||!finite(invalid))continue;
    const low=anchor-.2*a,high=anchor+.2*a,worst=dir>0?high:low;
    if(low<=0||invalid<=0||dir*(worst-invalid)<=.3*a||(dir>0?invalid>=low:invalid<=high))continue;
    const opposing=dir>0?s.resistance:s.support;
    const levels=opposing.filter(z=>dir*(z.price-worst)>.05*a).map(z=>({...z}));
    if(br&&s.lastHigh&&s.lastLow){const height=s.lastHigh.price-s.lastLow.price,p=br.level+dir*height;
      if(height>=2*a&&height<=12*a&&dir*(p-worst)>.5*a&&p>0)levels.push({price:p,basis:'Measured move of confirmed structural range',classification:'MODEL ESTIMATE',quality:40});}
    levels.sort((z,y)=>dir*(z.price-y.price));const distinct=[];
    for(const z of levels)if(!distinct.some(q=>Math.abs(q.price-z.price)<.35*a))distinct.push(z);
    const targets=distinct.slice(0,3),risk=dir*(worst-invalid),rr=targets.map(z=>dir*(z.price-worst)/risk);
    if(!targets.length||rr[0]<(strict?1.5:1.2)||families.score<(strict?75:62)||families.available_weight<70)continue;
    if(families.weekly_conflict&&(strict||!reversal))continue;
    if(horizon==='POSITION'&&(families.scores.higher_timeframe!==dir||!finite(tech.series.ema[200][i])||dir*(x.close-tech.series.ema[200][i])<=0))continue;
    // A target already reached before entry cannot be sold again as a new opportunity.
    if(dir*(x.close-targets[0].price)>=0)continue;
    const grade=families.score>=90&&rr[0]>=2?'A+':families.score>=80?'A':families.score>=70?'B+':'B';
    const overextended=dir*(x.close-worst)>.8*a;
    const plan={symbol:context.symbol||null,model_version:MODEL_VERSION,mode,horizon,direction:dir>0?'LONG':'SHORT',dir,signal_i:i,signal_ts:x.end_ts,data_timestamp:x.end_ts,anchor_id:[eventId,dir].join('|'),kind,
      entry_zone:{low,high},entry_method:'CONFIRMED SIGNAL → NEXT-BAR LIMIT RETEST',entry_reference:worst,stop:invalid,
      targets:targets.map((t,k)=>({...t,name:'TP'+(k+1),risk_reward:rr[k]})),score:families.score,score_label:'Evidence score / 100',grade,confidence:'UNVERIFIED LEAN',evidence:families,
      classification:'MODEL ESTIMATE',entry_expiry_sessions:5,time_exit_sessions:horizon==='POSITION'?63:21,current_action:overextended?'DO NOT CHASE':'WAIT FOR RETEST',confirmation:trigger,
      invalidation:`A ${dir>0?'touch below':'touch above'} the fixed stop invalidates this plan.`,wait_reason:families.weekly_conflict?'Countertrend reversal: weekly conflict remains visible.':'A confirmed signal is not proof of a profitable entry.',target_policy:'Frozen at issuance; a new structural event is required for another plan.'};
    plan.id=setupIdentity(plan);candidates.push(plan);
  }
  candidates.sort((x,z)=>z.score-x.score);
  return {status:candidates.length?'UNVERIFIED LEAN':'NO EDGE',setup:candidates[0]||null,reason:candidates.length?null:'Wait for a completed pullback reclaim, structural breakout/retest, or supported reversal with adequate nearest-target reward/risk.'};
}
export function setupIdentity(s){return [s.symbol,s.model_version,s.mode,s.horizon,s.signal_ts,s.direction,s.entry_zone.low.toFixed(6),s.entry_zone.high.toFixed(6),s.stop.toFixed(6),...s.targets.map(t=>t.price.toFixed(6))].join('|');}
