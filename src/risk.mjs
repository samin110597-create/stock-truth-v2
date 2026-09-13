import {finite} from './numeric.mjs';
export function positionSize({capital,riskPct,maxAllocationPct=100,entry,stop,dir=1}){
  if(![capital,riskPct,maxAllocationPct,entry,stop].every(finite)||capital<=0||riskPct<=0||riskPct>100||maxAllocationPct<=0||maxAllocationPct>100||entry<=0||stop<=0||dir*(entry-stop)<=0)return {status:'INPUT REQUIRED',shares:null};
  const perShare=dir*(entry-stop),budget=capital*riskPct/100;
  const shares=Math.max(0,Math.floor(Math.min(budget/perShare,capital*maxAllocationPct/100/entry)));
  return {classification:'CALCULATION',status:'CALCULATED',shares,risk_budget:budget,planned_loss:shares*perShare,notional:shares*entry,allocation_pct:shares*entry/capital*100,note:'Whole shares, no leverage; gaps, spread and fees can exceed the planned loss. No order is placed.'};
}
export function livePlanState(plan,resolution,raw,health,now=Date.now()/1000){
  if(!plan)return {action:'WAIT — NO QUALIFYING SETUP',entry_allowed:false};
  if(!health.tradeable)return {action:'WAIT — DATA '+health.status,entry_allowed:false};
  const q=raw.quote||{},dir=plan.dir,signal=plan.signal_ts;
  // Use only observations after the signal, never the earlier signal candle's range.
  const newerQuote=finite(q.as_of)&&q.as_of>signal&&q.as_of<=now+60;
  const forming=(raw.timeframes?.['1D']?.forming_bars||[]).filter(b=>b.ts>signal&&[b.open,b.high,b.low,b.close].every(finite)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close));
  const quoteSession=newerQuote&&q.session_date&&q.session_date>new Date(signal*1000).toISOString().slice(0,10);
  const lows=forming.map(x=>x.low).filter(finite),highs=forming.map(x=>x.high).filter(finite);
  if(quoteSession){if(finite(q.low))lows.push(q.low);if(finite(q.high))highs.push(q.high);}
  if(newerQuote&&finite(q.price)){lows.push(q.price);highs.push(q.price);}
  const low=lows.length?Math.min(...lows):null,high=highs.length?Math.max(...highs):null;
  const stopHit=dir>0?finite(low)&&low<=plan.stop:finite(high)&&high>=plan.stop;
  const targetHit=plan.targets[0]&&(dir>0?finite(high)&&high>=plan.targets[0].price:finite(low)&&low<=plan.targets[0].price);
  if(stopHit)return {action:'INVALIDATED — STOP ALREADY TESTED',entry_allowed:false,stop_tested:true,classification:'CALCULATION'};
  if(resolution?.entered)return {action:resolution.targets?.[0]?.result==='TARGET'?'TP1 TESTED — MANAGE EXISTING PLAN':'ENTRY TESTED — MANAGE EXISTING PLAN',entry_allowed:false,classification:'CALCULATION',note:'Historical OHLCV replay is not evidence of your execution.'};
  if(targetHit)return {action:'WAIT — TARGET ALREADY TESTED',entry_allowed:false,target_tested:true,classification:'CALCULATION'};
  if(raw.market?.state!=='OPEN')return {action:'PLAN FOR NEXT SESSION',entry_allowed:false,classification:'CALCULATION'};
  const fresh=newerQuote&&now-q.as_of<=15*60;
  if(!fresh)return {action:'WAIT — CURRENT QUOTE UNVERIFIED',entry_allowed:false};
  const rangeKnown=quoteSession&&finite(q.low)&&finite(q.high)||forming.some(b=>finite(b.high)&&finite(b.low));
  if(!rangeKnown)return {action:'WAIT — SESSION RANGE UNAVAILABLE',entry_allowed:false};
  const touched=dir>0?finite(low)&&low<=plan.entry_zone.high:finite(high)&&high>=plan.entry_zone.low;
  if(touched)return {action:'ENTRY ZONE TESTED — VERIFY FILL',entry_allowed:false,classification:'CALCULATION'};
  const inZone=q.price>=plan.entry_zone.low&&q.price<=plan.entry_zone.high;
  return {action:inZone?'CONDITIONAL ENTRY ZONE':plan.current_action,entry_allowed:inZone,classification:'CALCULATION'};
}
