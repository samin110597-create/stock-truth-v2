// Explain the canonical engine; no second prediction model or invented probabilities.
export function buildBriefing(q,gate){
 const finite=Number.isFinite,b=q.bars.at(-1),p=q.plan,dir=q.state.direction==='BULLISH'?1:q.state.direction==='BEARISH'?-1:0;
 const support=q.structure.support?.[0]?.price,resistance=q.structure.resistance?.[0]?.price;
 const rows=q.forecast.monteCarlo||[],h={'15M':20,'1H':10,'4H':5,'1D':10}[q.timeframe]||10;
 const mc=rows.find(x=>x.step===h),band=q.trained?.horizons?.[h];
 const valid=band?.validated&&band.returnBand,range=valid?{low:b.close*Math.exp(band.returnBand.q25),mid:b.close*Math.exp(band.returnBand.q50),high:b.close*Math.exp(band.returnBand.q75)}:{low:mc?.p25,mid:mc?.median,high:mc?.p75};
 const historyOK=gate.historyStatus==='COMPLETED BAR',mode=!historyOK?'HISTORICAL REVIEW':gate.allowed?'CURRENT DATA':'CANDLE-BASED PLAN · LIVE ENTRY BLOCKED';
 const pathways=[];
 if(p&&finite(p.stop)){
  for(const [name,entry]of [['Pullback',dir>0?p.entryZone?.high:p.entryZone?.low],['Breakout',p.trigger]]){
   const risk=dir*(entry-p.stop);if(!dir||!finite(entry)||risk<=0)continue;
   const targets=(p.targets||[]).filter(t=>finite(t.price)&&dir*(t.price-entry)>0).map(t=>({...t,riskReward:dir*(t.price-entry)/risk}));
   pathways.push({name:dir<0?(name==='Pullback'?'Bounce rejection':'Breakdown'):name,entry,stop:p.stop,targets,rr:targets[0]?.riskReward??null});
  }
 }
 const execution=pathways.find(x=>x.rr>=1.35)||pathways[0]||null;
 const freshPrice=gate.quote.allowed?q.quote.price:null,invalidated=p&&finite(freshPrice)&&dir*(freshPrice-p.stop)<=0;
 const chased=execution&&finite(freshPrice)&&execution.targets[0]&&dir*(freshPrice-execution.targets[0].price)>=0;
 let action='WAIT FOR CONFIRMATION',reason='The model has a directional lean, but the entry trigger still needs a completed candle.';
 if(!historyOK){action='WAIT — UPDATE HISTORY';reason='Completed candles are missing or need review. Levels below are historical reference only.';}
 else if(!gate.allowed){action='PLAN NOW · WAIT TO ENTER';reason='Use the completed-candle roadmap below. A price within 15 minutes is required before considering an entry.';}
 else if(invalidated){action='AVOID THIS SETUP';reason='The current quote has crossed the planned invalidation. Reassess with a new completed candle; do not use the old entry.';}
 else if(chased){action='DO NOT CHASE';reason='The current quote is already beyond the first planned objective. Wait for a new pullback or a newly calculated setup.';}
 else if(!dir){action='WAIT — RANGE / NO EDGE';reason='Directional evidence is mixed. Wait for a confirmed break of the range.';}
 else if(!execution||execution.rr<1.35){action='WAIT — REWARD TOO SMALL';reason='The nearest usable target does not offer at least 1.35 times the planned risk. A directional bias alone is not an entry.';}
 else if(q.state.stage==='READY'){action=dir>0?'WATCH LONG ENTRY':'WATCH SHORT ENTRY';reason='The model setup passes its filters. Enter only after the specified completed-bar confirmation, with fresh data and acceptable execution price.';}
 return {mode,action,reason,dir,support,resistance,close:b.close,bar:b,horizon:h,horizonLabel:q.timeframe==='1D'?h+' trading sessions':h+' completed '+q.timeframe+' bars',range,rangeSource:valid?'Validated conditional return range':'Volatility simulation · not a calibrated probability',pathways,execution,historyOK,invalidated,chased,bias:dir>0?'UPWARD LEAN':dir<0?'DOWNWARD LEAN':'RANGE / MIXED'};
}
