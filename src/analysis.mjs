import {finite,mean} from './numeric.mjs';
import {canonical,TIMEFRAMES,dataHealth} from './bars.mjs';
import {technicals} from './technicals.mjs';
import {structure} from './structure.mjs';
import {reversals} from './reversal.mjs';
import {setupAt,MODEL_VERSION} from './setups.mjs';
import {historicalValidation} from './validation.mjs';
export function analyzeFrame(block,timeframe){
  const clean=canonical(block),b=clean.bars;
  if(!b.length)return {timeframe,status:'UNAVAILABLE',reason:block?.reason||'No valid completed bars.',bars:[],provenance:block};
  const t=technicals(b,timeframe),s=structure(b,t),r=reversals(b,t,s);
  return {timeframe,status:clean.errors.length?'REVIEW':block.status||'COMPLETED BAR',bars:b,technicals:t.snapshot,structure:s.current,reversal:r.current,
    events:s.events,pivots:s.pivots,provenance:{...block,bars:undefined,forming_bars:undefined},_technical:t,_structure:s,_reversal:r};
}
function alignment(frames,keys){
  const z=keys.map(k=>frames[k]).filter(f=>f?.technicals&&f.technicals.intermediate_trend!=='INSUFFICIENT DATA');
  const bull=z.filter(f=>f.technicals.intermediate_trend==='BULLISH').length,bear=z.filter(f=>f.technicals.intermediate_trend==='BEARISH').length;
  return {label:!z.length?'UNAVAILABLE':bull&&bear?'CONFLICT':bull===z.length?'BULLISH':bear===z.length?'BEARISH':'MIXED',available:z.length,requested:keys.length};
}
export function marketContext(raw,benchmarks){
  const b=raw.timeframes?.['1D']?.bars||[],rows=[];
  for(const symbol of ['SPY','QQQ']){
    const z=benchmarks?.[symbol]?.timeframes?.['1D']?.bars||[];
    if(z.length<60){rows.push({symbol,status:'UNAVAILABLE'});continue;}
    const t=technicals(z),map=new Map(z.map(x=>[x.date,x.close])),aligned=b.filter(x=>map.has(x.date)).slice(-64);
    const rs=aligned.length===64?(aligned.at(-1).close/aligned[0].close)/(map.get(aligned.at(-1).date)/map.get(aligned[0].date))-1:null;
    rows.push({symbol,status:'CALCULATION',trend:t.snapshot.intermediate_trend,relative_strength_63:rs,provider:benchmarks[symbol].timeframes['1D'].provider,as_of:z.at(-1).end_ts});
  }
  return rows;
}
export function analyze(raw,{validate=true,benchmarks={}}={}){
  const frames=Object.fromEntries(TIMEFRAMES.map(tf=>[tf,analyzeFrame(raw.timeframes?.[tf],tf)]));
  const d=frames['1D'],health=dataHealth(raw),setups={},validation={};
  if(d.bars.length){
    for(const mode of ['Strict','Adaptive'])for(const horizon of ['SWING','POSITION']){
      const key=mode+'_'+horizon;
      setups[key]=setupAt(d.bars,d._technical,d._structure,d._reversal,d.bars.length-1,mode,horizon,{symbol:raw.symbol});
      if(validate&&horizon==='SWING')validation[key]=historicalValidation(d.bars,d._technical,d._structure,d._reversal,mode,horizon,raw.symbol);
      const p=setups[key].setup;if(p){p.confidence=validation[key]?.status||'UNVERIFIED LEAN';if(!health.tradeable)p.current_action='WAIT — DATA '+health.status;}
    }
  }
  const sup=d.structure?.support?.[0]?.price,res=d.structure?.resistance?.[0]?.price,c=d.bars.at(-1)?.close;
  const money=x=>finite(x)?'$'+x.toFixed(2):'an unconfirmed level';
  const adaptive=setups.Adaptive_SWING?.setup;
  const thesis={classification:'PROXY',current:!finite(c)?'Price history is unavailable for this ticker.':`${raw.symbol}: daily ${d.technicals.intermediate_trend.toLowerCase()} trend with ${d.structure.pattern.toLowerCase()}. ${d.reversal.stage.toLowerCase()}.`,
    bull:finite(res)?`A completed close above ${money(res)}, followed by a successful retest, would strengthen continuation.`:'No overhead confirmed resistance is available; do not invent a target.',
    base:finite(sup)&&finite(res)?`While price remains between ${money(sup)} and ${money(res)}, wait for a confirmed reaction at either boundary.`:'Wait for additional completed swings to establish a reliable range.',
    bear:finite(sup)?`A completed break below ${money(sup)} would weaken support; wait for a new structure assessment.`:'No confirmed support is available; downside invalidation cannot be established.',
    best_action:!health.tradeable?'WAIT — '+health.status:adaptive?adaptive.current_action:'WAIT — NO QUALIFYING SWING SETUP'};
  for(const f of Object.values(frames)){delete f._technical;delete f._structure;delete f._reversal;}
  return {schema_version:5,symbol:raw.symbol,name:raw.name,model_version:MODEL_VERSION,generated_at:new Date().toISOString(),source_data_timestamp:raw.fetched_at,
    quote:raw.quote,market:raw.market,health,frames,alignment:{short:alignment(frames,['5M','15M','30M','1H']),swing:alignment(frames,['4H','1D','1W']),long:alignment(frames,['1W','1M'])},
    setups,validation,thesis,market_context:marketContext(raw,benchmarks),fundamentals:raw.fundamentals,provider_errors:raw.provider_errors||[],
    classification_policy:{source_facts:'Provider quotes, OHLCV and filed SEC values.',calculations:'Indicators, confirmed structure, risk/reward, historical frequencies.',model_estimates:'Conditional entry/stop/target plan, not a forecast guarantee.',proxies:'Reversal, absorption, distribution, capitulation, OHLCV VWAP and price-action interpretation.',unavailable:'Missing data remains null; no calibrated direction probability.'}};
}
