import {finite,clamp,mean,std,quantile,ema,diff,rollingMean,zscore,trueRange,rsi,shannonEntropy,hurstExponent,dominantCycle,realizedVol,parkinsonVol,hashSeed,monteCarlo,wilson} from './math.mjs';

const sign=x=>x>0?1:x<0?-1:0;
const annualizer=tf=>({'15M':6552,'1H':1638,'4H':410,'1D':252}[tf]||252);

function pivots(bars,k=3){
  const highs=[],lows=[];
  for(let i=k;i<bars.length-k;i++){
    let hi=true,lo=true;
    for(let j=i-k;j<=i+k;j++){if(j===i)continue;if(bars[j].high>=bars[i].high)hi=false;if(bars[j].low<=bars[i].low)lo=false;}
    if(hi)highs.push({i,price:bars[i].high,confirmedAt:i+k,kind:'H'});
    if(lo)lows.push({i,price:bars[i].low,confirmedAt:i+k,kind:'L'});
  }
  return {highs,lows};
}
function structureEngine(bars,rsiSeries){
  const k=3,{highs,lows}=pivots(bars,k),events=[],activeH=[],activeL=[];let hix=0,lix=0,trend=0,lastH=null,lastL=null;
  for(let i=0;i<bars.length;i++){
    while(hix<highs.length&&highs[hix].confirmedAt<=i){activeH.push({...highs[hix],broken:false});lastH=activeH.at(-1);hix++;}
    while(lix<lows.length&&lows[lix].confirmedAt<=i){activeL.push({...lows[lix],broken:false});lastL=activeL.at(-1);lix++;}
    const b=bars[i];
    if(lastH&&!lastH.broken){
      if(b.high>lastH.price&&b.close<lastH.price)events.push({i,type:'LIQUIDITY SWEEP',dir:-1,level:lastH.price});
      if(b.close>lastH.price){events.push({i,type:trend<0?'CHoCH':'BOS',dir:1,level:lastH.price});lastH.broken=true;trend=1;}
    }
    if(lastL&&!lastL.broken){
      if(b.low<lastL.price&&b.close>lastL.price)events.push({i,type:'LIQUIDITY SWEEP',dir:1,level:lastL.price});
      if(b.close<lastL.price){events.push({i,type:trend>0?'CHoCH':'BOS',dir:-1,level:lastL.price});lastL.broken=true;trend=-1;}
    }
  }
  const price=bars.at(-1).close,h2=highs.slice(-2),l2=lows.slice(-2);
  let pattern='MIXED / RANGE',dir=trend;
  if(h2.length===2&&l2.length===2){
    const hh=h2[1].price>h2[0].price,hl=l2[1].price>l2[0].price,lh=h2[1].price<h2[0].price,ll=l2[1].price<l2[0].price;
    if(hh&&hl){pattern='HH + HL';dir=1;} else if(lh&&ll){pattern='LH + LL';dir=-1;}
  }
  const support=lows.filter(x=>x.price<price).sort((a,b)=>b.price-a.price).slice(0,3);
  const resistance=highs.filter(x=>x.price>price).sort((a,b)=>a.price-b.price).slice(0,3);
  let divergence=null;
  if(l2.length===2&&finite(rsiSeries[l2[0].i])&&finite(rsiSeries[l2[1].i])&&l2[1].price<l2[0].price&&rsiSeries[l2[1].i]>rsiSeries[l2[0].i]+2)divergence={dir:1,type:'BULLISH RSI DIVERGENCE',i:l2[1].i};
  if(h2.length===2&&finite(rsiSeries[h2[0].i])&&finite(rsiSeries[h2[1].i])&&h2[1].price>h2[0].price&&rsiSeries[h2[1].i]<rsiSeries[h2[0].i]-2)divergence={dir:-1,type:'BEARISH RSI DIVERGENCE',i:h2[1].i};
  const recentSweep=[...events].reverse().find(e=>e.type==='LIQUIDITY SWEEP'&&e.i>=bars.length-12)||null;
  return {pattern,direction:dir,highs,lows,support,resistance,events,divergence,recentSweep};
}
function historicalContext(bars,currentDir,horizon=10){
  if(!currentDir||bars.length<220)return {status:'INSUFFICIENT',n:0,rate:null,interval:{low:null,high:null},horizon};
  const c=bars.map(b=>b.close),e20=ema(c,20),e50=ema(c,50),rets=c.map((v,i)=>i?Math.log(v/c[i-1]):0),m5=rollingMean(rets,5),hits=[];
  for(let i=80;i<bars.length-horizon;i++){
    const d=sign((e20[i]??c[i])-(e50[i]??c[i])),m=sign(m5[i]||0),s=sign(.7*d+.3*m);
    if(s!==currentDir)continue;hits.push(currentDir*Math.log(c[i+horizon]/c[i])>0);
  }
  const n=hits.length,success=hits.filter(Boolean).length;return {status:n>=30?'RETROSPECTIVE SAMPLE':'SMALL SAMPLE',n,rate:n?success/n:null,interval:wilson(success,n),horizon};
}
function uniqueDirectional(values,entry,dir,minGap){const x=values.filter(finite).filter(v=>dir*(v-entry)>minGap).sort((a,b)=>dir*(a-b)),out=[];for(const v of x)if(!out.some(z=>Math.abs(z-v)<minGap*.45))out.push(v);return out;}
function step(mc,n){return mc?.steps?.find(x=>x.step===n)||null;}
function projection(mc,dir,stop){
  const a=step(mc,5),b=step(mc,10),c=step(mc,20);
  return {primary:{label:dir>0?'PRIMARY UPSIDE PATH':'PRIMARY DOWNSIDE PATH',bar5:a?.median,bar10:b?.median,bar20:c?.median},pullback:{label:dir>0?'PULLBACK PATH':'BOUNCE PATH',bar5:dir>0?a?.p25:a?.p75,bar10:dir>0?b?.p25:b?.p75,bar20:dir>0?c?.p25:c?.p75},expansion:{label:dir>0?'EXPANSION PATH':'EXPANSION PATH',bar5:dir>0?a?.p75:a?.p25,bar10:dir>0?b?.p75:b?.p25,bar20:dir>0?c?.p75:c?.p25},failure:{price:stop,label:'THESIS FAILURE'},range10:b?{low:b.p25,high:b.p75,tailLow:b.p10,tailHigh:b.p90}:null,range20:c?{low:c.p25,high:c.p75,tailLow:c.p10,tailHigh:c.p90}:null};
}

export function analyzeQuant({symbol,sourceSymbol=symbol,asset='STOCK',timeframe='1D',bars,provider='unknown',fetchedAt=null,credentialPolicy=null}){
  const clean=(bars||[]).filter(b=>[b.open,b.high,b.low,b.close].every(finite)&&b.close>0);
  if(clean.length<80)throw new Error('Standalone quant engine needs at least 80 completed bars.');
  const closes=clean.map(b=>b.close),logs=closes.map(Math.log),rets=logs.map((x,i)=>i?x-logs[i-1]:0),rsi14=rsi(closes,14),structure=structureEngine(clean,rsi14);
  const e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),last=clean.length-1,price=closes[last];
  const tr=trueRange(clean),atr=rollingMean(tr,14),atrBase=rollingMean(atr,50),lastAtr=atr[last]||price*.02,atrPct=lastAtr/price;
  const smooth=ema(logs,5),vel=diff(smooth),acc=diff(vel),jerk=diff(acc),norm=x=>finite(x)&&atrPct?clamp(x/atrPct,-4,4):0;
  const velocity=norm(vel[last]),acceleration=norm(acc[last]),jerkNow=norm(jerk[last]),curvature=finite(acc[last])&&finite(vel[last])?Math.abs(acc[last])/Math.pow(1+vel[last]*vel[last],1.5):null;
  const entropy=shannonEntropy(rets.slice(-96)),hurst=hurstExponent(logs.slice(-256)),cycle=dominantCycle(logs.slice(-256));
  const rv=realizedVol(rets.slice(-64),annualizer(timeframe)),pv=parkinsonVol(clean.slice(-64),annualizer(timeframe)),compression=finite(atrBase[last])&&atrBase[last]>0?lastAtr/atrBase[last]:null;
  const vols=clean.map(b=>finite(b.volume)?b.volume:null),volumeZ=zscore(vols,30)[last],bar=clean[last],range=Math.max(1e-12,bar.high-bar.low),body=Math.abs(bar.close-bar.open),lowerWick=Math.max(0,Math.min(bar.open,bar.close)-bar.low)/range,upperWick=Math.max(0,bar.high-Math.max(bar.open,bar.close))/range;
  const bullAbsorption=finite(volumeZ)&&volumeZ>1.2&&lowerWick>.35&&body/range<.65,bearAbsorption=finite(volumeZ)&&volumeZ>1.2&&upperWick>.35&&body/range<.65;
  const trend=price>(e50[last]??price)&&e20[last]>e50[last]?1:price<(e50[last]??price)&&e20[last]<e50[last]?-1:sign((e20[last]??price)-(e50[last]??price));
  const longTerm=finite(e200[last])?sign(price-e200[last]):0,momentum=clamp(.55*velocity+.30*acceleration+.15*jerkNow,-1,1),div=structure.divergence?.dir||0,sweep=structure.recentSweep?.dir||0,flow=bullAbsorption?.6:bearAbsorption?-.6:0,persistence=finite(hurst)?clamp((hurst-.5)*2,-1,1):0,cycleBias=cycle?clamp(Math.sin(cycle.phase)*.45,-.45,.45):0;
  let score=.24*trend+.10*longTerm+.18*structure.direction+.18*momentum+.10*div+.07*sweep+.06*flow+.04*persistence*trend+.03*cycleBias;
  if(finite(entropy)&&entropy>.9)score*=.72;if(finite(compression)&&compression<.7)score*=.82;score=clamp(score,-1,1);
  const dir=Math.abs(score)>=.15?sign(score):0,conviction=Math.round(Math.abs(score)*100);
  let regime='MIXED / LOW EDGE';
  if(finite(compression)&&compression<.72)regime='VOLATILITY COMPRESSION';
  if(finite(hurst)&&hurst>.55&&finite(entropy)&&entropy<.78&&trend)regime=trend>0?'TREND PERSISTENCE UP':'TREND PERSISTENCE DOWN';
  if(bullAbsorption&&sweep>0)regime='BULLISH ABSORPTION AFTER SWEEP';
  if(bearAbsorption&&sweep<0)regime='BEARISH ABSORPTION AFTER SWEEP';
  if(finite(volumeZ)&&volumeZ>2.2&&range/lastAtr>1.6&&rets[last]<0)regime='CAPITULATION-LIKE EXPANSION';
  const sigma=Math.max(std(rets.slice(-64))||.0001,.0001),mu=(mean(rets.slice(-40))||0)*.30+score*sigma*.10,mc=monteCarlo({price,mu,sigma,steps:20,paths:2000,seed:hashSeed(symbol+sourceSymbol+bar.end_ts)});
  const support=structure.support[0]?.price,resistance=structure.resistance[0]?.price,stop=dir>0?(finite(support)?support:price-1.6*lastAtr):dir<0?(finite(resistance)?resistance:price+1.6*lastAtr):null,risk=dir&&finite(stop)?Math.abs(price-stop):null,terminal=mc?.terminal||[];
  const structural=dir>0?(finite(resistance)&&resistance>price?resistance:null):(finite(support)&&support<price?support:null),q=[quantile(terminal,.10),quantile(terminal,.25),quantile(terminal,.40),quantile(terminal,.60),quantile(terminal,.75),quantile(terminal,.90)],candidates=dir>0?[structural,q[3],q[4],q[5]]:dir<0?[structural,q[2],q[1],q[0]]:[],targets=uniqueDirectional(candidates,price,dir,Math.max(lastAtr*.2,price*.001)).slice(0,3).map((p,i)=>({name:'TP'+(i+1),price:p,riskReward:risk?Math.abs(p-price)/risk:null,source:p===structural?'confirmed structure':'forecast distribution'}));
  const entryZone=dir>0?{low:Math.max(stop,price-.65*lastAtr),high:price-.12*lastAtr}:{low:price+.12*lastAtr,high:Math.min(stop,price+.65*lastAtr)},trigger=dir>0?price+.28*lastAtr:dir<0?price-.28*lastAtr:null,rr1=targets[0]?.riskReward??null;
  const trendAligned=dir&&(trend===dir||structure.direction===dir),entropyOk=!finite(entropy)||entropy<.93;let stage='NO EDGE',action='NO TRADE — EDGE TOO WEAK',detail='Wait for cleaner structure, better reward/risk, or stronger directional evidence.';
  if(dir){
    if(conviction>=68&&finite(rr1)&&rr1>=1.35&&trendAligned&&entropyOk){stage='READY';action=dir>0?'LONG SETUP — WAIT FOR ENTRY':'SHORT SETUP — WAIT FOR ENTRY';detail=dir>0?'Use the pullback entry zone or a completed-bar breakout above the trigger.':'Use the bounce entry zone or a completed-bar breakdown below the trigger.';}
    else if(conviction>=52&&finite(rr1)&&rr1>=1.05){stage='DEVELOPING';action=dir>0?'BULLISH SETUP DEVELOPING — DO NOT CHASE':'BEARISH SETUP DEVELOPING — DO NOT CHASE';detail='Directional evidence exists, but the stronger trade-ready filters are not all satisfied.';}
    else {stage='WATCH';action=dir>0?'BULLISH WATCH — WAIT':'BEARISH WATCH — WAIT';detail='Bias exists, but current confluence or reward/risk is insufficient.';}
  }
  const historical=historicalContext(clean,dir,10),quality=stage==='READY'?(conviction>=78&&historical.n>=30&&historical.interval.low>.45?'A':'B+'):stage==='DEVELOPING'?'B':'WATCH';
  const plan=dir?{direction:dir>0?'LONG':'SHORT',action,detail,quality,entry:price,entryZone:{low:Math.min(entryZone.low,entryZone.high),high:Math.max(entryZone.low,entryZone.high)},trigger,stop,targets,rr:rr1,entryRule:dir>0?'Wait for a completed-bar bullish reaction inside the zone or a completed close above trigger.':'Wait for a completed-bar bearish rejection inside the zone or a completed close below trigger.',invalidation:dir>0?'Completed close below stop invalidates the bullish thesis.':'Completed close above stop invalidates the bearish thesis.'}:null;
  return {model:'Q-STANDALONE 1.0',symbol,sourceSymbol,asset,timeframe,provider,fetchedAt,credentialPolicy,bars:clean,generatedAt:new Date().toISOString(),state:{direction:dir>0?'BULLISH':dir<0?'BEARISH':'NEUTRAL',score,conviction,stage,regime,action,quality},structure,indicators:{ema20:e20[last],ema50:e50[last],ema200:e200[last],rsi:rsi14[last]},math:{velocity,acceleration,jerk:jerkNow,curvature,entropy,hurst,dominantCycle:cycle,realizedVol:rv,parkinsonVol:pv,compression,volumeZ,bullAbsorption,bearAbsorption},forecast:{monteCarlo:mc?.steps||[],historical,projection:dir?projection(mc,dir,stop):null},plan,caveats:['Conviction is an evidence score, not a probability.','Projection paths are distributional model estimates, not promised prices.','Historical frequency is retrospective context, not untouched out-of-sample proof.','Absorption is an OHLCV proxy unless true order-flow data is supplied.']};
}
