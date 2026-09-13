import {finite,mean,wilson} from './numeric.mjs';
import {setupAt} from './setups.mjs';
export function resolveSetup(b,setup,signalIndex=setup.signal_i){
  const s=setup,dir=s.dir,limit=dir>0?s.entry_zone.high:s.entry_zone.low,first=signalIndex+1,expiry=Math.min(b.length-1,signalIndex+s.entry_expiry_sessions);
  let entryIndex=null,fill=null;
  for(let i=first;i<=expiry;i++){
    const x=b[i];
    // An opening gap through invalidation cancels an unfilled order.
    if(dir*(x.open-s.stop)<=0)return {state:'CANCELLED GAP THROUGH STOP',entered:false,end_i:i};
    if(!s.model_version?.startsWith('5.0.')&&(dir>0?x.open<s.entry_zone.low:x.open>s.entry_zone.high))return {state:'CANCELLED GAP BEYOND ENTRY ZONE',entered:false,end_i:i};
    if(dir>0?x.low<=limit:x.high>=limit){entryIndex=i;fill=dir>0?Math.min(limit,x.open):Math.max(limit,x.open);break;}
    if(!s.model_version?.startsWith('5.0.')&&s.targets[0]&&(dir>0?x.high>=s.targets[0].price:x.low<=s.targets[0].price))return {state:'TARGET TESTED BEFORE ENTRY',entered:false,end_i:i};
  }
  if(entryIndex===null)return {state:b.length-1<signalIndex+s.entry_expiry_sessions?'PENDING ENTRY':'ENTRY EXPIRED',entered:false,end_i:expiry};
  const risk=dir*(fill-s.stop);if(risk<=0)return {state:'CANCELLED INVALID FILL',entered:false,end_i:entryIndex};
  const outcomes=s.targets.map(()=>null),end=Math.min(b.length-1,entryIndex+s.time_exit_sessions),cost=.001*2*fill/risk;
  let stopIndex=null,ambiguous=false;
  for(let i=entryIndex;i<=end;i++){
    const x=b[i],stop=dir>0?x.low<=s.stop:x.high>=s.stop;
    const targets=s.targets.map(t=>dir>0?x.high>=t.price:x.low<=t.price);
    if(stop){
      ambiguous ||= targets.some((hit,k)=>hit&&!outcomes[k]);
      const exit=dir>0?Math.min(s.stop,x.open):Math.max(s.stop,x.open);
      outcomes.forEach((v,k)=>{if(!v)outcomes[k]={result:'STOP',r:dir*(exit-fill)/risk-cost,i};});stopIndex=i;break;
    }
    // Entry-bar favorable movement may have preceded the limit fill: never count it.
    if(i===entryIndex)continue;
    targets.forEach((hit,k)=>{if(hit&&!outcomes[k])outcomes[k]={result:'TARGET',r:dir*(s.targets[k].price-fill)/risk-cost,i};});
    if(outcomes.every(Boolean))break;
  }
  const complete=end>=entryIndex+s.time_exit_sessions||outcomes.every(Boolean)||stopIndex!==null;
  outcomes.forEach((v,k)=>{if(!v)outcomes[k]={result:complete?'TIME EXIT':'OPEN',r:complete?dir*(b[end].close-fill)/risk-cost:null,i:end};});
  return {state:complete?'RESOLVED':'OPEN',entered:true,entry_i:entryIndex,fill,stop_i:stopIndex,ambiguous,targets:outcomes,end_i:Math.max(...outcomes.map(o=>o.i)),complete};
}
export function activeSetup(b,tech,st,rev,mode,horizon,symbol){
  const start=59,seen=new Set();
  let active=null,last=null;
  for(let i=start;i<b.length;i++){
    if(active){const result=resolveSetup(b.slice(0,i+1),active,active.signal_i);last={setup:active,result};
      if(result.state==='PENDING ENTRY'||result.state==='OPEN')continue;active=null;
    }
    const candidate=setupAt(b,tech,st,rev,i,mode,horizon,{symbol}).setup;
    if(candidate&&!seen.has(candidate.anchor_id)){seen.add(candidate.anchor_id);active=candidate;}
  }
  if(!active)return {setup:null,last_setup:last,status:b.length<60?'INSUFFICIENT DATA':'NO EDGE',reason:'No active confirmed setup. Require a new reclaim, breakout, retest, or reversal; old stops and targets are not recycled.'};
  const resolution=resolveSetup(b,active,active.signal_i);
  return {setup:active,resolution,last_setup:last,status:'UNVERIFIED LEAN',reason:null};
}
export function historicalValidation(b,tech,st,rev,mode='Adaptive',horizon='SWING',symbol=null){
  // Fixed-rule forward replay. No parameters are selected on this history.
  // Because rule development has seen historical markets, this is NOT untouched OOS.
  const start=253,hold=horizon==='POSITION'?63:21,rows=[];
  let eligible=0,next=start;
  for(let i=start;i<b.length-hold-5;i++){
    if(i<next)continue;eligible++;
    const s=setupAt(b,tech,st,rev,i,mode,horizon,{symbol}).setup;
    if(!s)continue;
    const result=resolveSetup(b,s,i);
    if(!result.complete&&result.entered)continue;
    rows.push({signal_i:i,signal_ts:b[i].end_ts,kind:s.kind,direction:s.direction,setup:s,result});
    // Fixed horizon + entry window + one-bar embargo, including expired orders.
    next=i+hold+6;
  }
  const entered=rows.filter(x=>x.result.entered&&x.result.complete),n=entered.length;
  const metrics=[0,1,2].map(k=>{
    const z=entered.filter(x=>x.result.targets[k]),wins=z.filter(x=>x.result.targets[k].result==='TARGET').length;
    return {target:'TP'+(k+1),n:z.length,wins,frequency:z.length?wins/z.length:null,ci95:wilson(wins,z.length),mean_net_r:mean(z.map(x=>x.result.targets[k].r)),classification:z.length?'CALCULATION':'UNAVAILABLE'};
  });
  const baselineRows=[];
  for(let i=start;i+hold<b.length;i+=hold+6)baselineRows.push({up:b[i+hold].close>b[i].close,r:b[i+hold].close/b[i].close-1});
  const baseN=baselineRows.length,baseline=baseN?baselineRows.filter(x=>x.up).length/baseN:null;
  const folds=Array.from({length:3},(_,k)=>{const lo=start+Math.floor((b.length-start)*k/3),hi=start+Math.floor((b.length-start)*(k+1)/3);const z=entered.filter(x=>x.signal_i>=lo&&x.signal_i<hi);return {fold:k+1,n:z.length,t1_frequency:z.length?z.filter(x=>x.result.targets[0]?.result==='TARGET').length/z.length:null};});
  return {classification:n?'CALCULATION':'UNAVAILABLE',status:n<30?'INSUFFICIENT DATA':'UNVERIFIED LEAN',
    methodology:'Causal fixed-rule replay; signals use completed bars and pivots known at issuance. No retrospective score is a calibrated probability.',
    validation_kind:'RETROSPECTIVE CAUSAL REPLAY — NOT UNTOUCHED OUT-OF-SAMPLE',n,signals:rows.length,eligible_periods:eligible,
    coverage:eligible?rows.length/eligible:null,metrics,folds,baseline:{method:'Non-overlapping long close-to-close direction; different payoff from barrier setup, not an edge test.',n:baseN,up_frequency:baseline},
    brier_score:null,brier_skill:null,balanced_accuracy:null,direction_probability:null,
    probability_note:'Unavailable: no independently calibrated directional-probability model is active.',
    overlapping_samples:false,embargo_bars:1,cost_basis_points_per_side:10,
    collision_policy:'Unresolved same-bar stop/target collisions count as stop; entry-bar targets are not credited. Gaps use adverse opening price.',
    ambiguous_stop_count:entered.filter(x=>x.result.ambiguous).length,
    limitations:['Historical universe is selected today; no survivorship-free cross-ticker claim.','Unknown intrabar ordering and spread; fixed cost assumption is not observed execution.','No verified-edge designation until prospective results and a matching baseline are sufficient.'],
    recent_replays:rows.slice(-20)};
}
