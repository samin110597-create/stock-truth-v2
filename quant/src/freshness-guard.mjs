import {marketSchedule,refreshBlock} from './public-data.mjs';
export const MAX_QUOTE_AGE=900;
export function quoteGate(symbol,quote,now=Date.now()/1000){
  if(!quote||quote.symbol!==symbol||!Number.isFinite(quote.price)||quote.price<=0||!Number.isFinite(quote.as_of)||quote.as_of<=0||quote.as_of>now)return {allowed:false,status:'QUOTE UNAVAILABLE',age:null};
  const age=now-quote.as_of;
  return {allowed:age<=MAX_QUOTE_AGE,status:age<=MAX_QUOTE_AGE?'WITHIN 15 MIN':'STALE QUOTE',age};
}
export function freshnessGate(data,now=Date.now()/1000){
  const quote=quoteGate(data.symbol,data.quote,now),cal=data.calendar;
  let market=null,historyStatus='UNKNOWN';
  if(cal?.sessions){
    const dates=Object.keys(cal.sessions).sort();
    const today=new Date(now*1000).toISOString().slice(0,10);
    if(dates.length&&today>=dates[0]&&today<=dates.at(-1)){
      market=marketSchedule(cal,now);
      historyStatus=refreshBlock({bars:data.bars,quality:data.dataStatus==='REVIEW'?'REVIEW':'PASS'},data.timeframe,cal,now)?.status||'UNKNOWN';
    }
  }
  const reasons=[];
  if(!quote.allowed)reasons.push(quote.status+' — no verified price within 15 minutes');
  if(historyStatus!=='COMPLETED BAR')reasons.push(historyStatus+' HISTORY — latest required completed candle unavailable');
  return {allowed:reasons.length===0,quote,market,historyStatus,reasons,checkedAt:now};
}
export function gateAnalysis(q,now=Date.now()/1000){
  const gate=freshnessGate(q,now);
  if(gate.allowed)return {...q,freshness:gate};
  return {...q,freshness:gate,plan:null,state:{...q.state,stage:'DATA REVIEW',action:'CURRENT SETUP WITHHELD',quality:'WITHHELD',probabilityStatus:'WITHHELD',calibratedProbabilityUp:null,calibratedProbabilityDirection:null},forecast:{...q.forecast,projection:null,monteCarlo:[]}};
}
