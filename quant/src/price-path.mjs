// Interpretation of the canonical Q-State output, never a second prediction model.
const finite=Number.isFinite;
export function nearbyLevels(q,price){
 const n=q.bars.length,atr=q.math?.atr,tolerance=finite(atr)&&atr>0?atr*.15:price*.001;
 const all=[...(q.structure.allHighs||q.structure.highs||[]),...(q.structure.allLows||q.structure.lows||[])];
 const candidates=(all.length?all:[...(q.structure.support||[]),...(q.structure.resistance||[])])
  .filter(x=>finite(x.price)&&x.price>0&&(!finite(x.i)||x.i>=n-252)&&(!finite(x.confirmedAt)||x.confirmedAt<n));
 const side=dir=>{
  const sorted=candidates.filter(x=>dir*(x.price-price)>0).sort((a,b)=>dir*(a.price-b.price)),out=[];
  for(const x of sorted){if(out.some(y=>Math.abs(x.price-y.price)<=tolerance))continue;out.push({...x,distancePct:100*(x.price/price-1),distanceATR:finite(atr)&&atr>0?Math.abs(x.price-price)/atr:null});if(out.length===3)break;}
  return out;
 };
 return {below:side(-1),above:side(1),lookback:Math.min(n,252),tolerance};
}
export function projectionEnd(q,horizon){
 const last=q.bars.at(-1),sessions=Object.entries(q.calendar?.sessions||{}).sort(([a],[b])=>a.localeCompare(b));
 if(q.timeframe==='1D')return sessions.filter(([date])=>date>last.date)[horizon-1]?.[1]?.[1]??null;
 const width={'15M':900,'1H':3600,'4H':14400}[q.timeframe];if(!width)return null;
 let count=0;for(const [, [open,close]]of sessions){for(let start=open;start<close;start+=width){if(start<last.end_ts)continue;if(++count===horizon)return Math.min(start+width,close);}}
 return null;
}
export function pricePath(q,gate){
 const b=q.bars.at(-1),fresh=gate.quote?.allowed&&finite(q.quote?.price),price=fresh?q.quote.price:b.close;
 const levels=nearbyLevels(q,price),oldLevels=nearbyLevels(q,b.close),atr=q.math?.atr;
 const crossed=fresh?[...oldLevels.below,...oldLevels.above].filter(x=>(x.price-b.close)*(x.price-price)<0):[];
 const moved=!!(fresh&&(crossed.length||(finite(atr)&&atr>0&&Math.abs(price-b.close)>=atr*.5)));
 const historyOK=gate.historyStatus==='COMPLETED BAR',dir=q.state.direction==='BULLISH'?1:q.state.direction==='BEARISH'?-1:0;
 const studies=(q.priceStudy||[]).filter(x=>x.status==='COMPLETED BAR'),current=studies.find(x=>x.tf===q.timeframe);
 const disagreement=!!(dir&&(studies.some(x=>x.direction*dir<0)||(current&&current.direction===0)||q.structure.direction*dir<0));
 const bias=!historyOK?'CURRENT DIRECTION UNAVAILABLE':moved?'PRICE HAS MOVED — CONFIRM THE NEXT CLOSE':disagreement||!dir?'MIXED — WAIT FOR AGREEMENT':dir>0?'UPWARD LEAN, CONDITIONAL':'DOWNWARD LEAN, CONDITIONAL';
 const rows=[5,10,20].map(h=>{
  const trained=q.trained?.horizons?.[h],band=trained?.validated?trained.returnBand:null,sim=q.forecast.monteCarlo?.find(x=>x.step===h);
  const value=(key,simKey)=>band&&finite(band[key])?b.close*Math.exp(band[key]):sim?.[simKey];
  return {h,end:projectionEnd(q,h),low:value('q10','p10'),mid:value('q50','median'),high:value('q90','p90'),source:band?'Validated historical model':'Uncalibrated simulation',sample:band?.n??null,available:historyOK&&!moved};
 });
 return {price,fresh,levels,crossed,moved,moveDirection:Math.sign(price-b.close),changePct:100*(price/b.close-1),historyOK,dir,disagreement,bias,rows,missing:(q.priceStudy||[]).filter(x=>x.status!=='COMPLETED BAR').map(x=>x.tf),confirmationBuffer:finite(atr)&&atr>0?atr*.1:null};
}
