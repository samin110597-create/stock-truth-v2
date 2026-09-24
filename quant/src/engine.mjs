import {finite,clamp,mean,std,quantile,ema,diff,rollingMean,zscore,trueRange,rsi,shannonEntropy,hurstExponent,dominantCycle,realizedVol,parkinsonVol,hashSeed,monteCarlo,wilson} from './math.mjs';
import {applyTrainedModel,mtfBias} from './model.mjs';

const sign=x=>x>0?1:x<0?-1:0;
const annualizer=tf=>({'15M':6552,'1H':1638,'4H':410,'1D':252}[tf]||252);
const primaryHorizonFor=tf=>({'15M':'20','1H':'10','4H':'5','1D':'10'}[tf]||'10');

function pivots(bars,k=3){
  const highs=[],lows=[];
  for(let i=k;i<bars.length-k;i++){
    let hi=true,lo=true;
    for(let j=i-k;j<=i+k;j++){if(j===i)continue;if(bars[j].high>=bars[i].high)hi=false;if(bars[j].low<=bars[i].low)lo=false;}
    if(hi)highs.push({i,price:bars[i].high,confirmedAt:i+k,kind:'H',scale:k});
    if(lo)lows.push({i,price:bars[i].low,confirmedAt:i+k,kind:'L',scale:k});
  }
  return {highs,lows};
}
function multiScalePivots(bars){
  const allH=[],allL=[];for(const k of [2,4,7]){const p=pivots(bars,k);allH.push(...p.highs);allL.push(...p.lows);}
  const dedupe=(arr,kind)=>{const by=new Map();for(const p of arr){const key=p.i+'-'+kind,old=by.get(key);if(!old||p.scale>old.scale)by.set(key,p);}return [...by.values()].sort((a,b)=>a.i-b.i);};
  const highs=dedupe(allH,'H'),lows=dedupe(allL,'L'),majorHighs=highs.filter(x=>x.scale>=4),majorLows=lows.filter(x=>x.scale>=4);
  return {highs:majorHighs.length>=2?majorHighs:highs,lows:majorLows.length>=2?majorLows:lows,allHighs:highs,allLows:lows};
}
function structureEngine(bars,rsiSeries){
  const {highs,lows,allHighs,allLows}=multiScalePivots(bars),events=[],activeH=[],activeL=[];let hix=0,lix=0,trend=0,lastH=null,lastL=null;
  for(let i=0;i<bars.length;i++){
    while(hix<highs.length&&highs[hix].confirmedAt<=i){activeH.push({...highs[hix],broken:false});lastH=activeH.at(-1);hix++;}
    while(lix<lows.length&&lows[lix].confirmedAt<=i){activeL.push({...lows[lix],broken:false});lastL=activeL.at(-1);lix++;}
    const b=bars[i];
    if(lastH&&!lastH.broken){
      if(b.high>lastH.price&&b.close<lastH.price)events.push({i,type:'LIQUIDITY SWEEP',dir:-1,level:lastH.price,scale:lastH.scale});
      if(b.close>lastH.price){events.push({i,type:trend<0?'CHoCH':'BOS',dir:1,level:lastH.price,scale:lastH.scale});lastH.broken=true;trend=1;}
    }
    if(lastL&&!lastL.broken){
      if(b.low<lastL.price&&b.close>lastL.price)events.push({i,type:'LIQUIDITY SWEEP',dir:1,level:lastL.price,scale:lastL.scale});
      if(b.close<lastL.price){events.push({i,type:trend>0?'CHoCH':'BOS',dir:-1,level:lastL.price,scale:lastL.scale});lastL.broken=true;trend=-1;}
    }
  }
  const price=bars.at(-1).close,h2=highs.slice(-2),l2=lows.slice(-2);
  let pattern='MIXED / RANGE',dir=trend;
  if(h2.length===2&&l2.length===2){
    const hh=h2[1].price>h2[0].price,hl=l2[1].price>l2[0].price,lh=h2[1].price<h2[0].price,ll=l2[1].price<l2[0].price;
    if(hh&&hl){pattern='HH + HL';dir=1;} else if(lh&&ll){pattern='LH + LL';dir=-1;}
  }
  const support=lows.filter(x=>x.price<price).sort((a,b)=>b.price-a.price).slice(0,3),resistance=highs.filter(x=>x.price>price).sort((a,b)=>a.price-b.price).slice(0,3);
  let divergence=null;
  if(l2.length===2&&finite(rsiSeries[l2[0].i])&&finite(rsiSeries[l2[1].i])&&l2[1].price<l2[0].price&&rsiSeries[l2[1].i]>rsiSeries[l2[0].i]+2)divergence={dir:1,type:'BULLISH RSI DIVERGENCE',i:l2[1].i};
  if(h2.length===2&&finite(rsiSeries[h2[0].i])&&finite(rsiSeries[h2[1].i])&&h2[1].price>h2[0].price&&rsiSeries[h2[1].i]<rsiSeries[h2[0].i]-2)divergence={dir:-1,type:'BEARISH RSI DIVERGENCE',i:h2[1].i};
  const recentSweep=[...events].reverse().find(e=>e.type==='LIQUIDITY SWEEP'&&e.i>=bars.length-14)||null;
  return {pattern,direction:dir,highs,lows,allHighs,allLows,support,resistance,events,divergence,recentSweep,method:'confirmed multi-scale pivots 2/4/7; structure uses scale >=4 when available'};
}
function historicalContext(bars,currentDir,horizon=10){
  if(!currentDir||bars.length<220)return {status:'INSUFFICIENT',n:0,rate:null,interval:{low:null,high:null},horizon};
  const c=bars.map(b=>b.close),e20=ema(c,20),e50=ema(c,50),rets=c.map((v,i)=>i?Math.log(v/c[i-1]):0),m5=rollingMean(rets,5),hits=[];
  for(let i=80;i<bars.length-horizon;i++){const d=sign((e20[i]??c[i])-(e50[i]??c[i])),m=sign(m5[i]||0),s=sign(.7*d+.3*m);if(s!==currentDir)continue;hits.push(currentDir*Math.log(c[i+horizon]/c[i])>0);}
  const n=hits.length,success=hits.filter(Boolean).length;return {status:n>=30?'RETROSPECTIVE SAMPLE':'SMALL SAMPLE',n,rate:n?success/n:null,interval:wilson(success,n),horizon};
}
function uniqueDirectional(values,entry,dir,minGap){const x=values.filter(finite).filter(v=>dir*(v-entry)>minGap).sort((a,b)=>dir*(a-b)),out=[];for(const v of x)if(!out.some(z=>Math.abs(z-v)<minGap*.45))out.push(v);return out;}
function step(mc,n){return mc?.steps?.find(x=>x.step===n)||null;}
function fallbackProjection(mc,dir,stop){
  const a=step(mc,5),b=step(mc,10),c=step(mc,20);
  return {source:'REGIME_VOLATILITY_MONTE_CARLO',primary:{label:dir>0?'PRIMARY UPSIDE PATH':'PRIMARY DOWNSIDE PATH',bar5:a?.median,bar10:b?.median,bar20:c?.median},pullback:{label:dir>0?'PULLBACK PATH':'BOUNCE PATH',bar5:dir>0?a?.p25:a?.p75,bar10:dir>0?b?.p25:b?.p75,bar20:dir>0?c?.p25:c?.p75},expansion:{label:'EXPANSION PATH',bar5:dir>0?a?.p75:a?.p25,bar10:dir>0?b?.p75:b?.p25,bar20:dir>0?c?.p75:c?.p25},failure:{price:stop,label:'THESIS FAILURE'},range10:b?{low:b.p25,high:b.p75,tailLow:b.p10,tailHigh:b.p90}:null,range20:c?{low:c.p25,high:c.p75,tailLow:c.p10,tailHigh:c.p90}:null};
}
const bandPrice=(price,b,key)=>b&&finite(b[key])?price*Math.exp(b[key]):null;
function trainedProjection(trained,mc,price,stop,dir){
  const hs=trained?.horizons||{},fallback={5:step(mc,5),10:step(mc,10),20:step(mc,20)},used=[];
  const value=(h,qkey,mcKey)=>{const m=hs[String(h)],b=m?.returnBand;if(m?.validated&&b){used.push(String(h));return bandPrice(price,b,qkey);}return fallback[h]?.[mcKey]??null;};
  const primary={label:dir>0?'PRIMARY UPSIDE PATH':'PRIMARY DOWNSIDE PATH',bar5:value(5,'q50','median'),bar10:value(10,'q50','median'),bar20:value(20,'q50','median')};
  const pullback={label:dir>0?'PULLBACK PATH':'BOUNCE PATH',bar5:value(5,dir>0?'q25':'q75',dir>0?'p25':'p75'),bar10:value(10,dir>0?'q25':'q75',dir>0?'p25':'p75'),bar20:value(20,dir>0?'q25':'q75',dir>0?'p25':'p75')};
  const expansion={label:'EXPANSION PATH',bar5:value(5,dir>0?'q75':'q25',dir>0?'p75':'p25'),bar10:value(10,dir>0?'q75':'q25',dir>0?'p75':'p25'),bar20:value(20,dir>0?'q75':'q25',dir>0?'p75':'p25')};
  const range=(h)=>{const m=hs[String(h)],b=m?.returnBand,fb=fallback[h];return m?.validated&&b?{low:bandPrice(price,b,'q25'),high:bandPrice(price,b,'q75'),tailLow:bandPrice(price,b,'q10'),tailHigh:bandPrice(price,b,'q90')}:(fb?{low:fb.p25,high:fb.p75,tailLow:fb.p10,tailHigh:fb.p90}:null);};
  const uniq=[...new Set(used)];
  return {source:uniq.length?('HYBRID_OOS_'+uniq.join('_')+'_BAR_WITH_MONTE_CARLO_FALLBACK'):'REGIME_VOLATILITY_MONTE_CARLO',validatedHorizons:uniq,primary,pullback,expansion,failure:{price:stop,label:'THESIS FAILURE'},range10:range(10),range20:range(20)};
}
function trainedTargetPrices(trained,price,dir){
  const b=trained?.horizons?.['20'];if(!b?.validated||!b.returnBand)return [];
  return dir>0?[bandPrice(price,b.returnBand,'q50'),bandPrice(price,b.returnBand,'q75'),bandPrice(price,b.returnBand,'q90')]:[bandPrice(price,b.returnBand,'q50'),bandPrice(price,b.returnBand,'q25'),bandPrice(price,b.returnBand,'q10')];
}

export function analyzeQuant({symbol,sourceSymbol=symbol,asset='STOCK',timeframe='1D',bars,mtf={},trainedModel=null,provider='unknown',fetchedAt=null,credentialPolicy=null}){
  const clean=(bars||[]).filter(b=>[b.open,b.high,b.low,b.close].every(finite)&&b.close>0);if(clean.length<80)throw new Error('Standalone quant engine needs at least 80 completed bars.');
  const closes=clean.map(b=>b.close),logs=closes.map(Math.log),rets=logs.map((x,i)=>i?x-logs[i-1]:0),rsi14=rsi(closes,14),structure=structureEngine(clean,rsi14);
  const e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),last=clean.length-1,price=closes[last],tr=trueRange(clean),atr=rollingMean(tr,14),atrBase=rollingMean(atr,50),lastAtr=atr[last]||price*.02,atrPct=lastAtr/price;
  const smooth=ema(logs,5),vel=diff(smooth),acc=diff(vel),jerk=diff(acc),norm=x=>finite(x)&&atrPct?clamp(x/atrPct,-4,4):0,directVelocity=norm(vel[last]),directAcceleration=norm(acc[last]),jerkNow=norm(jerk[last]),curvature=finite(acc[last])&&finite(vel[last])?Math.abs(acc[last])/Math.pow(1+vel[last]*vel[last],1.5):null;
  const entropy=shannonEntropy(rets.slice(-96)),hurst=hurstExponent(logs.slice(-256)),cycle=dominantCycle(logs.slice(-256)),rv=realizedVol(rets.slice(-64),annualizer(timeframe)),pv=parkinsonVol(clean.slice(-64),annualizer(timeframe)),compression=finite(atrBase[last])&&atrBase[last]>0?atr[last]/atrBase[last]:null;
  const volumes=clean.map(b=>finite(b.volume)?b.volume:null),volumeZ=zscore(volumes,30)[last],bar=clean[last],range=Math.max(1e-12,bar.high-bar.low),body=Math.abs(bar.close-bar.open),lowerWick=Math.max(0,Math.min(bar.open,bar.close)-bar.low)/range,upperWick=Math.max(0,bar.high-Math.max(bar.open,bar.close))/range;
  const bullAbsorption=finite(volumeZ)&&volumeZ>1.2&&lowerWick>.35&&body/range<.65,bearAbsorption=finite(volumeZ)&&volumeZ>1.2&&upperWick>.35&&body/range<.65;
  const trained=trainedModel?applyTrainedModel(trainedModel,timeframe,clean):null,features=trained?.features||{},velocity=finite(features.latent_velocity)?features.latent_velocity:directVelocity,acceleration=finite(features.latent_acceleration)?features.latent_acceleration:directAcceleration;
  const trend=price>(e50[last]??price)&&e20[last]>e50[last]?1:price<(e50[last]??price)&&e20[last]<e50[last]?-1:sign((e20[last]??price)-(e50[last]??price)),longTerm=finite(e200[last])?sign(price-e200[last]):0,momentum=clamp(.62*velocity+.28*acceleration+.10*jerkNow,-1,1),div=structure.divergence?.dir||0,sweep=structure.recentSweep?.dir||0,flow=bullAbsorption?.6:bearAbsorption?-.6:0,persistence=finite(hurst)?clamp((hurst-.5)*2,-1,1):0,cycleBias=cycle?clamp(Math.sin(cycle.phase)*.45,-.45,.45):0;
  let heuristic=.22*trend+.09*longTerm+.20*structure.direction+.18*momentum+.10*div+.08*sweep+.06*flow+.04*persistence*trend+.03*cycleBias;if(finite(entropy)&&entropy>.9)heuristic*=.72;if(finite(compression)&&compression<.7)heuristic*=.82;heuristic=clamp(heuristic,-1,1);
  const primaryHorizon=primaryHorizonFor(timeframe),primaryModel=trained?.horizons?.[primaryHorizon],calibrated=!!primaryModel?.validated&&finite(primaryModel.probabilityUp),modelEdge=calibrated?2*(primaryModel.probabilityUp-.5):null;
  let score=calibrated?clamp(.78*modelEdge+.22*heuristic,-1,1):heuristic,dir=Math.abs(score)>=.12?sign(score):0,conviction=Math.round(Math.abs(score)*100);
  let regime='MIXED / LOW EDGE';if(finite(compression)&&compression<.72)regime='VOLATILITY COMPRESSION';if(finite(hurst)&&hurst>.55&&finite(entropy)&&entropy<.78&&trend)regime=trend>0?'TREND PERSISTENCE UP':'TREND PERSISTENCE DOWN';if(finite(hurst)&&hurst<.45&&finite(rsi14[last])&&(rsi14[last]<35||rsi14[last]>65))regime='MEAN REVERSION / EXTREME';if(bullAbsorption&&sweep>0)regime='BULLISH ABSORPTION AFTER SWEEP';if(bearAbsorption&&sweep<0)regime='BEARISH ABSORPTION AFTER SWEEP';if(finite(volumeZ)&&volumeZ>2.2&&range/lastAtr>1.6&&rets[last]<0)regime='CAPITULATION-LIKE EXPANSION';
  const mtfState=mtfBias(mtf),alignment=dir&&mtfState.available?mean(mtfState.rows.map(x=>x.bias*dir)):null;
  const sigma=Math.max(std(rets.slice(-64))||.0001,.0001),mu=(mean(rets.slice(-40))||0)*.25+score*sigma*.08,mc=monteCarlo({price,mu,sigma,steps:20,paths:2000,seed:hashSeed(symbol+sourceSymbol+bar.end_ts)});
  const support=structure.support[0]?.price,resistance=structure.resistance[0]?.price,stop=dir>0?(finite(support)?support:price-1.6*lastAtr):dir<0?(finite(resistance)?resistance:price+1.6*lastAtr):null,risk=dir&&finite(stop)?Math.abs(price-stop):null;
  const trainedTargets=trainedTargetPrices(trained,price,dir),terminal=mc?.terminal||[],structural=dir>0?(finite(resistance)&&resistance>price?resistance:null):(finite(support)&&support<price?support:null),fallbackQ=[quantile(terminal,.10),quantile(terminal,.25),quantile(terminal,.50),quantile(terminal,.75),quantile(terminal,.90)],fallbackTargets=dir>0?[fallbackQ[2],fallbackQ[3],fallbackQ[4]]:[fallbackQ[2],fallbackQ[1],fallbackQ[0]],candidates=[structural,...(trainedTargets.length?trainedTargets:fallbackTargets)],targets=uniqueDirectional(candidates,price,dir,Math.max(lastAtr*.2,price*.001)).slice(0,3).map(p=>({name:'TP'+(uniqueDirectional(candidates,price,dir,Math.max(lastAtr*.2,price*.001)).slice(0,3).indexOf(p)+1),price:p,riskReward:risk?Math.abs(p-price)/risk:null,source:p===structural?'confirmed major structure':trainedTargets.includes(p)?'walk-forward OOS conditional return':'Monte Carlo fallback'}));
  const entryZone=dir>0?{low:Math.max(stop??-Infinity,price-.65*lastAtr),high:price-.12*lastAtr}:{low:price+.12*lastAtr,high:Math.min(stop??Infinity,price+.65*lastAtr)},trigger=dir>0?price+.28*lastAtr:dir<0?price-.28*lastAtr:null,rr1=targets[0]?.riskReward??null,trendAligned=dir&&(trend===dir||structure.direction===dir),entropyOk=!finite(entropy)||entropy<.93,mtfOk=!finite(alignment)||mtfState.available<2||alignment>=0;
  const pDir=calibrated&&dir?(dir>0?primaryModel.probabilityUp:1-primaryModel.probabilityUp):null;let stage='NO EDGE',action='NO TRADE — EDGE TOO WEAK',detail='Wait for cleaner structure, better reward/risk, or stronger directional evidence.';
  if(dir){
    if(calibrated){
      if(pDir>=.58&&finite(rr1)&&rr1>=1.35&&trendAligned&&entropyOk&&mtfOk){stage='READY';action=dir>0?'LONG SETUP — WAIT FOR ENTRY':'SHORT SETUP — WAIT FOR ENTRY';detail='Calibrated directional edge, structure and reward/risk pass the trade-ready gate. Wait for the defined entry condition.';}
      else if(pDir>=.54&&finite(rr1)&&rr1>=1.05){stage='DEVELOPING';action=dir>0?'BULLISH SETUP DEVELOPING — DO NOT CHASE':'BEARISH SETUP DEVELOPING — DO NOT CHASE';detail='The walk-forward model has directional edge, but execution filters are not all satisfied.';}
      else{stage='WATCH';action=dir>0?'BULLISH WATCH — WAIT':'BEARISH WATCH — WAIT';detail='Model bias exists, but calibrated probability, MTF agreement or reward/risk is below the trade-ready threshold.';}
    }else{
      if(conviction>=72&&finite(rr1)&&rr1>=1.35&&trendAligned&&entropyOk&&mtfOk){stage='READY';action=dir>0?'RULE-BASED LONG SETUP — WAIT FOR ENTRY':'RULE-BASED SHORT SETUP — WAIT FOR ENTRY';detail='No promoted probability model is available for this timeframe. The deterministic setup passes the stricter rule-based gate.';}
      else if(conviction>=54&&finite(rr1)&&rr1>=1.05){stage='DEVELOPING';action=dir>0?'BULLISH SETUP DEVELOPING — DO NOT CHASE':'BEARISH SETUP DEVELOPING — DO NOT CHASE';detail='Rule-based directional evidence exists, but no calibrated probability is being claimed.';}
      else{stage='WATCH';action=dir>0?'BULLISH WATCH — WAIT':'BEARISH WATCH — WAIT';detail='Bias exists, but current confluence or reward/risk is insufficient.';}
    }
  }
  const historical=historicalContext(clean,dir,10),skill=primaryModel?.metrics?.brier_skill,quality=stage==='READY'?(calibrated&&pDir>=.62&&finite(skill)&&skill>=.02&&(!finite(alignment)||alignment>=.25)?'A':'B+'):stage==='DEVELOPING'?'B':'WATCH';
  const plan=dir?{direction:dir>0?'LONG':'SHORT',action,detail,quality,entry:price,entryZone:{low:Math.min(entryZone.low,entryZone.high),high:Math.max(entryZone.low,entryZone.high)},trigger,stop,targets,rr:rr1,entryRule:dir>0?'Wait for a completed-bar bullish reaction inside the zone or a completed close above trigger.':'Wait for a completed-bar bearish rejection inside the zone or a completed close below trigger.',invalidation:dir>0?'Completed close below stop invalidates the bullish thesis.':'Completed close above stop invalidates the bearish thesis.'}:null;
  const proj=dir?trainedProjection(trained,mc,price,stop,dir):null;
  return {model:'Q-STATE 2.0',symbol,sourceSymbol,asset,timeframe,provider,fetchedAt,credentialPolicy,bars:clean,generatedAt:new Date().toISOString(),state:{direction:dir>0?'BULLISH':dir<0?'BEARISH':'NEUTRAL',score,heuristicScore:heuristic,conviction,stage,regime,action,quality,calibratedProbabilityUp:calibrated?primaryModel.probabilityUp:null,calibratedProbabilityDirection:pDir,calibratedProbabilityHorizon:+primaryHorizon,probabilityStatus:calibrated?'WALK_FORWARD_VALIDATED':primaryModel?.status||'WITHHELD'},structure,mtf:{...mtfState,alignmentWithTrade:alignment},trained,indicators:{ema20:e20[last],ema50:e50[last],ema200:e200[last],rsi:rsi14[last]},math:{velocity,acceleration,jerk:jerkNow,curvature,entropy,hurst,dominantCycle:cycle,realizedVol:rv,parkinsonVol:pv,compression,volumeZ,bullAbsorption,bearAbsorption},forecast:{monteCarlo:mc?.steps||[],historical,projection:proj,source:proj?.source||null},plan,caveats:['Displayed numerical probability is withheld unless the walk-forward model beats its base-rate Brier benchmark and passes the promotion gate.','Walk-forward return bands use OOS predictions only when validated; otherwise projections fall back to a regime/volatility simulation.','Targets combine major confirmed structure with validated conditional return bands when available.','Absorption remains an OHLCV proxy unless true order-flow data is supplied.']};
}
