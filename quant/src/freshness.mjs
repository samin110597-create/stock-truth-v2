const finite=Number.isFinite;
// Select a complete source record, never splice session extremes across providers.
export function freshestQuote(symbol, candidates, now=Date.now()/1000){
  const valid=candidates.filter(q=>q&&(!q.symbol||q.symbol===symbol)&&finite(q.price)&&q.price>0&&finite(q.as_of)&&q.as_of>0&&q.as_of<=now+60&&(!q.currency||q.currency==='USD'));
  return valid.sort((a,b)=>b.as_of-a.as_of||Number(!!b.api_secret_used)-Number(!!a.api_secret_used))[0]||null;
}
export function dataUsed(state,tf='1D'){
  const f=state.frames?.[tf],d=state.frames?.['1D'];
  return {quote:{provider:state.quote?.provider,as_of:state.quote?.as_of,fetched_at:state.quote?.fetched_at,delay:state.quote?.delay},technical_timeframe:tf,technical_bar_end:f?.bars?.at(-1)?.end_ts,forecast_daily_bar_end:d?.bars?.at(-1)?.end_ts,fundamentals_source_updated_at:state.fundamentals?.source_updated_at,fundamentals_fetched_at:state.fundamentals?.fetched_at,calculated_at:state.generated_at};
}

export function quoteFreshness(quote,now=Date.now()/1000){
  if(!quote||!Number.isFinite(quote.as_of))return {status:'UNAVAILABLE',age:null,label:'QUOTE UNAVAILABLE'};
  const age=Math.max(0,Math.floor(now-quote.as_of));
  const status=age<=120?'RECENT':age<=900?'DELAYED':'OLDER QUOTE';
  return {status,age,label:status+' · '+(age<60?age+' sec':age<3600?Math.floor(age/60)+' min':Math.floor(age/3600)+' hr')+' old'};
}
