import {finite,clamp,sign,mean} from './numeric.mjs';
export const MODEL_VERSION='5.0.0-causal-swing';
export function weeklyDirection(bars,i){
  // Only completed weeks known before this signal; no current partial week.
  const day=new Date(bars[i].date+'T12:00:00Z'),weekStart=new Date(day);
  weekStart.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);
  const cutoff=weekStart.toISOString().slice(0,10),groups=new Map();
  for(const b of bars.slice(0,i+1)){
    if(b.date>=cutoff)break;
    const d=new Date(b.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
    groups.set(d.toISOString().slice(0,10),b.close);
  }
  const c=[...groups.values()].slice(1);if(c.length<20)return null;
  const avg=mean(c.slice(-20));return sign(c.at(-1)-avg);
}
export function evidenceFamilies(b,tech,st,rev,i,dir,context={}){
  const t=tech.series,a=t.atr[i],c=b[i].close,s=st.states[i],r=rev.states[i];
  const trend=finite(t.ema[50][i])?mean([sign(c-t.ema[20][i],.1*a),sign(t.ema[20][i]-t.ema[50][i],.1*a)]):null;
  const momentum=finite(t.rsi[i])&&finite(t.hist[i])?mean([sign(t.rsi[i]-50,3),sign(t.hist[i],.05*a)]):null;
  const volume=finite(t.rvol[i])&&finite(t.cmf[i])?mean([t.rvol[i]>=1.15?sign(b[i].close-b[i].open):0,sign(t.cmf[i],.05)]):null;
  const structure=s?.direction||0,weekly=context.weekly??weeklyDirection(b,i);
  const scores={trend,momentum,participation:volume,structure,higher_timeframe:weekly};
  const weights={trend:25,momentum:20,participation:15,structure:25,higher_timeframe:15};
  let points=0,available=0;
  for(const [key,value] of Object.entries(scores))if(finite(value)){available+=weights[key];points+=weights[key]*clamp((dir*value+1)/2,0,1);}
  const reversalSupport=r?.dir===dir&&['REVERSAL DEVELOPING','REVERSAL CONFIRMED'].includes(r.stage);
  const score=Math.round(points); // missing families earn no points; denominator remains 100.
  return {scores,score,available_weight:available,reversalSupport,weekly_conflict:finite(weekly)&&dir*weekly<0,classification:'CALCULATION'};
}
export function setupAt(b,tech,st,rev,i,mode='Adaptive',horizon='SWING',context={}){
  if(i<59)return {status:'INSUFFICIENT DATA',setup:null,reason:'At least 60 completed bars are required.'};
  const x=b[i],s=st.states[i],r=rev.states[i],a=tech.series.atr[i];
  if(!finite(a)||a<=0)return {status:'NO EDGE',setup:null,reason:'Valid ATR is unavailable.'};
  const candidates=[];
  for(const dir of [1,-1]){
    const families=evidenceFamilies(b,tech,st,rev,i,dir,context),support=(dir>0?s.support:s.resistance)[0];
    const br=s.recentEvents.filter(e=>['BOS','CHoCH'].includes(e.type)&&e.dir===dir).at(-1);
    const sw=r?.sides?.find(z=>z.dir===dir)?.sweep;
    let kind=null,anchor=null,invalid=null,trigger=null;
    const e20=tech.series.ema[20][i],e50=tech.series.ema[50][i];
    const trend=finite(e50)&&dir*(e20-e50)>0&&dir*(x.close-e50)>0;
    const reversal=r?.dir===dir&&['REVERSAL DEVELOPING','REVERSAL CONFIRMED'].includes(r.stage)&&sw;
    if(reversal){kind='REVERSAL ENTRY';anchor=sw.level;invalid=sw.extreme-dir*.3*a;trigger='Hold the reclaimed swing level; enter only inside the zone after a completed confirmation candle.';}
    else if(br&&i-br.i<=5&&dir*(x.close-br.level)>=0){kind=i===br.i?'BREAKOUT RETEST':'RETEST ENTRY';anchor=br.level;invalid=br.level-dir*.8*a;trigger='The breakout close is complete. Wait for a retest inside the zone; do not chase.';}
    else if(trend&&support&&Math.abs(x.close-support.price)<=1.2*a){kind='PULLBACK BUY ZONE';anchor=support.price;invalid=(dir>0?Math.min(s.lastLow?.price??anchor,anchor):Math.max(s.lastHigh?.price??anchor,anchor))-dir*.3*a;trigger='Require a completed rejection/reclaim candle inside the support zone.';}
    if(!kind||!finite(anchor)||!finite(invalid))continue;
    const low=anchor-.2*a,high=anchor+.2*a,worst=dir>0?high:low;
    if(low<=0||invalid<=0||dir*(worst-invalid)<=.3*a||dir*(dir>0?low-invalid:high-invalid)<=0)continue;
    const opposing=dir>0?s.resistance:s.support;
    const targetLevels=opposing.filter(z=>dir*(z.price-worst)>.05*a).map(z=>({...z}));
    // A measured range objective is allowed only after a confirmed range break.
    if(br&&s.lastHigh&&s.lastLow){
      const height=s.lastHigh.price-s.lastLow.price;
      if(height>=2*a&&height<=12*a){const p=br.level+dir*height;if(dir*(p-worst)>.5*a&&p>0)targetLevels.push({price:p,basis:'Measured move of confirmed structural range',classification:'MODEL ESTIMATE',quality:40});}
    }
    targetLevels.sort((z,y)=>dir*(z.price-y.price));
    const distinct=[];for(const z of targetLevels)if(!distinct.some(q=>Math.abs(q.price-z.price)<.35*a))distinct.push(z);
    const targets=distinct.slice(0,3),risk=dir*(worst-invalid),rr=targets.map(z=>dir*(z.price-worst)/risk);
    // Never skip the nearest obstacle merely to manufacture attractive reward/risk.
    const threshold=mode==='Strict'?1.5:1.2;
    const scoreThreshold=mode==='Strict'?75:62;
    const adequate=targets.length>0&&rr[0]>=threshold&&families.score>=scoreThreshold&&families.available_weight>=70;
    const conflict=families.weekly_conflict&&(mode==='Strict'||!reversal);
    if(!adequate||conflict)continue;
    if(mode==='Strict'&&reversal&&!r.strict_reversal)continue;
    if(horizon==='POSITION'&&(families.scores.higher_timeframe!==dir||!finite(tech.series.ema[200][i])||dir*(x.close-tech.series.ema[200][i])<=0))continue;
    const inZone=x.close>=low&&x.close<=high,overextended=dir*(x.close-worst)>.8*a;
    const grade=families.score>=90&&rr[0]>=2?'A+':families.score>=80?'A':families.score>=70?'B+':'B';
    candidates.push({symbol:context.symbol||null,model_version:MODEL_VERSION,mode,horizon,direction:dir>0?'LONG':'SHORT',dir,
      signal_i:i,signal_ts:x.end_ts,data_timestamp:x.end_ts,kind:dir<0?kind.replace('BUY','SELL'):kind,entry_zone:{low,high},entry_method:'LIMIT RETEST AFTER CONFIRMATION',
      entry_reference:worst,stop:invalid,targets:targets.map((t,k)=>({...t,name:'TP'+(k+1),risk_reward:rr[k]})),
      score:families.score,score_label:'Evidence score / 100',grade,confidence:'UNVERIFIED LEAN',evidence:families,
      classification:'MODEL ESTIMATE',entry_expiry_sessions:5,time_exit_sessions:horizon==='POSITION'?63:21,
      current_action:overextended?'DO NOT CHASE':inZone?'CONDITIONAL ENTRY ZONE':'WAIT FOR RETEST',
      confirmation:trigger,invalidation:`A ${dir>0?'decline below':'rise above'} the fixed stop invalidates this structural thesis.`,
      wait_reason:overextended?'Price is extended beyond the planned entry band.':families.weekly_conflict?'Countertrend: weekly context conflicts; treat as an early reversal.':'Historical edge is not yet established for this exact setup.',
      target_policy:'Targets and stop are frozen at issuance. Changes require a new setup ID.'});
  }
  candidates.sort((a,z)=>z.score-a.score);
  return {status:candidates.length?'UNVERIFIED LEAN':'NO EDGE',setup:candidates[0]||null,reason:candidates.length?null:'No qualifying structural entry with adequate confluence and nearest-target reward/risk. Wait.'};
}
export function setupIdentity(s){
  return [s.symbol,s.model_version,s.mode,s.horizon,s.signal_ts,s.direction,s.entry_zone.low.toFixed(6),s.entry_zone.high.toFixed(6),s.stop.toFixed(6),...s.targets.map(t=>t.price.toFixed(6))].join('|');
}
