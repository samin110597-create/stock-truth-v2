import {finite,mean} from './numeric.mjs';
import {canonical,TIMEFRAMES,dataHealth} from './bars.mjs';
import {technicals} from './technicals.mjs';
import {structure} from './structure.mjs';
import {reversals} from './reversal.mjs';
import {setupAt,MODEL_VERSION} from './setups.mjs';
import {historicalValidation,activeSetup} from './validation.mjs';
import {livePlanState} from './risk.mjs';
import {researchRead,horizonResearch,chartContext} from './research.mjs';
import {wyckoff} from './wyckoff.mjs';
import {elliott} from './elliott.mjs';
import {technicalForecast,forecastTradeCall} from './forecast.mjs';
export function analyzeFrame(block,timeframe){
  const clean=canonical(block),b=clean.bars;
  if(!b.length)return {timeframe,status:'UNAVAILABLE',reason:block?.reason||'No valid completed bars.',bars:[],provenance:block};
  const t=technicals(b,timeframe),s=structure(b,t),r=reversals(b,t,s);
  return {timeframe,status:clean.errors.length?'REVIEW':block.status||'COMPLETED BAR',bars:b,technicals:t.snapshot,structure:s.current,reversal:r.current,
    wyckoff:wyckoff(b,t),elliott:elliott(b,t,s),events:s.events,pivots:s.pivots,reversal_events:r.events,context:chartContext(b,t,s),provenance:{...block,bars:undefined,forming_bars:undefined},_technical:t,_structure:s,_reversal:r};
}
function alignment(frames,keys){
  const z=keys.map(k=>frames[k]).filter(f=>f?.technicals&&!['STALE','REVIEW','UNAVAILABLE'].includes(f.status)&&f.technicals.intermediate_trend!=='INSUFFICIENT DATA');
  const bull=z.filter(f=>f.technicals.intermediate_trend==='BULLISH').length,bear=z.filter(f=>f.technicals.intermediate_trend==='BEARISH').length;
  return {label:!z.length?'UNAVAILABLE':bull&&bear?'CONFLICT':bull===z.length?'BULLISH':bear===z.length?'BEARISH':'MIXED',available:z.length,requested:keys.length};
}
export function marketContext(raw,benchmarks){
  const b=raw.timeframes?.['1D']?.bars||[],rows=[];
  for(const symbol of Object.keys(benchmarks)){
    const z=benchmarks?.[symbol]?.timeframes?.['1D']?.bars||[];
    if(z.length<60){rows.push({symbol,status:'UNAVAILABLE'});continue;}
    const t=technicals(z),map=new Map(z.map(x=>[x.date,x.close])),aligned=b.filter(x=>map.has(x.date)).slice(-64);
    const rs=aligned.length===64?(aligned.at(-1).close/aligned[0].close)/(map.get(aligned.at(-1).date)/map.get(aligned[0].date))-1:null;
    const stale=z.at(-1).date<(raw.market?.expected_completed_daily||b.at(-1)?.date);
    rows.push({symbol,status:stale?'STALE':'CALCULATION',trend:t.snapshot.intermediate_trend,relative_strength_63:rs,provider:benchmarks[symbol].timeframes['1D'].provider,as_of:z.at(-1).end_ts});
  }
  return rows;
}
export function analyze(raw,{validate=true,benchmarks={}}={}){
  const frames=Object.fromEntries(TIMEFRAMES.map(tf=>[tf,analyzeFrame(raw.timeframes?.[tf],tf)]));
  const d=frames['1D'],health=dataHealth(raw),setups={},validation={};
  if(d.bars.length){
    for(const mode of ['Strict','Adaptive'])for(const horizon of ['SWING','POSITION']){
      const key=mode+'_'+horizon;
      setups[key]=activeSetup(d.bars,d._technical,d._structure,d._reversal,mode,horizon,raw.symbol);
      if(validate)validation[key]=historicalValidation(d.bars,d._technical,d._structure,d._reversal,mode,horizon,raw.symbol);
      const p=setups[key].setup;if(p){p.confidence=validation[key]?.status||'UNVERIFIED LEAN';p.live_check=livePlanState(p,setups[key].resolution,raw,health);p.current_action=p.live_check.action;}
    }
  }
  const sup=d.structure?.support?.[0]?.price,res=d.structure?.resistance?.[0]?.price,c=d.bars.at(-1)?.close;
  const money=x=>finite(x)?'$'+x.toFixed(2):'an unconfirmed level';
  const adaptive=setups.Adaptive_SWING?.setup;
  const read=d.bars.length?researchRead(d.bars,d._technical,d._structure,d._reversal):{label:'UNAVAILABLE',families:[],bull:[],bear:[],neutral:[],coverage:0};
  const forecast=d.bars.length&&d.provenance?.quality!=='REVIEW'?technicalForecast(d.bars,d._technical):{horizons:[],method:'Forecast withheld: insufficient or reviewed daily data.'};
  if(d.bars.length&&forecast.horizons?.length){forecast.calls={SWING:forecastTradeCall(d.bars,d._technical,d._structure,read,forecast,'SWING'),POSITION:forecastTradeCall(d.bars,d._technical,d._structure,read,forecast,'POSITION')};}
  const horizons=d.bars.length?horizonResearch(d.bars,d._technical):[];
  const thesis={classification:'PROXY',current:!finite(c)?'Price history is unavailable for this ticker.':`${raw.symbol} closed at ${money(c)}: ${d.technicals.intermediate_trend.toLowerCase()} daily trend, ${d.structure.pattern.toLowerCase()}. ${read.phase.toLowerCase()}. RSI ${finite(d.technicals.rsi)?d.technicals.rsi.toFixed(1):'unavailable'}; volume ${finite(d.technicals.rvol)?d.technicals.rvol.toFixed(2)+'× its prior 20-bar average':'unavailable'}.`,
    bull:finite(res)?`A completed close above ${money(res)}, followed by a successful retest, would strengthen continuation.`:'No overhead confirmed resistance is available; do not invent a target.',
    base:finite(sup)&&finite(res)?`While price remains between ${money(sup)} and ${money(res)}, wait for a confirmed reaction at either boundary.`:'Wait for additional completed swings to establish a reliable range.',
    bear:finite(sup)?`A completed break below ${money(sup)} would weaken support; wait for a new structure assessment.`:'No confirmed support is available; downside invalidation cannot be established.',
    best_action:!health.tradeable?'WAIT — '+health.status:adaptive?adaptive.current_action:'WAIT — NO QUALIFYING SWING SETUP'};
  for(const f of Object.values(frames)){delete f._technical;delete f._structure;delete f._reversal;}
  return {schema_version:5,symbol:raw.symbol,name:raw.name,model_version:MODEL_VERSION,generated_at:new Date().toISOString(),source_data_timestamp:raw.fetched_at,
    quote:raw.quote,market:raw.market,health,frames,alignment:{short:alignment(frames,['5M','15M','30M','1H']),swing:alignment(frames,['4H','1D','1W']),long:alignment(frames,['1W','1M'])},
    setups,validation,read,horizons,forecast,thesis,market_context:marketContext(raw,benchmarks),fundamentals:raw.fundamentals,provider_errors:raw.provider_errors||[],
    classification_policy:{source_facts:'Provider quotes, OHLCV and filed SEC values.',calculations:'Indicators, confirmed structure, risk/reward, historical frequencies.',model_estimates:'Conditional entry/stop/target plan, not a forecast guarantee.',proxies:'Reversal, absorption, distribution, capitulation, OHLCV VWAP and price-action interpretation.',unavailable:'Missing data remains null; no calibrated direction probability.'}};
}
