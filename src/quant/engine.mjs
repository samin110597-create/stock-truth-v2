import {analyzeFrame} from '../analysis.mjs';
import {clamp,finite,mean,std,ema,diff,zscore,shannonEntropy,hurstExponent,dominantCycle,trueRange,rollingMean,realizedVol,parkinsonVol,monteCarlo,hashSeed,wilson,quantile} from './math.mjs';

const annualizer=tf=>({'15M':6552,'1H':1638,'4H':410,'1D':252,'1W':52}[tf]||252);
const sign=x=>x>0?1:x<0?-1:0;
function atrSeries(bars,n=14){return rollingMean(trueRange(bars),n);}
function directionFromTrend(t){return t==='BULLISH'?1:t==='BEARISH'?-1:0;}
function stageWeight(stage=''){return /CONFIRMED/.test(stage)?1:/DEVELOPING/.test(stage)?.65:/WATCH/.test(stage)?.35:0;}
function historicalCalibration(bars,scoreNow,dir,horizon=10){
  if(bars.length<180||!dir)return {status:'INSUFFICIENT',n:0,rate:null,interval:{low:null,high:null}};
  const closes=bars.map(b=>b.close),e20=ema(closes,20),e50=ema(closes,50),rets=closes.map((c,i)=>i?Math.log(c/closes[i-1]):0),mom=rollingMean(rets,5),samples=[];
  for(let i=80;i<bars.length-horizon;i++){
    if(!finite(e20[i])||!finite(e50[i])||!finite(mom[i]))continue;
    const trend=sign(e20[i]-e50[i]),m=sign(mom[i]),simple=clamp(.65*trend+.35*m,-1,1);
    if(sign(simple)!==dir||Math.abs(Math.abs(simple)-Math.abs(scoreNow))>.45)continue;
    samples.push(dir*Math.log(closes[i+horizon]/closes[i])>0);
  }
  const n=samples.length,success=samples.filter(Boolean).length,rate=n?success/n:null;
  return {status:n>=30?'RETROSPECTIVE SAMPLE':'SMALL SAMPLE',n,rate,interval:wilson(success,n),horizon};
}
function uniqueDirectional(values,entry,dir,minGap){
  const x=values.filter(finite).filter(v=>dir*(v-entry)>minGap).sort((a,b)=>dir*(a-b));
  const out=[];for(const v of x)if(!out.some(z=>Math.abs(z-v)<minGap*.45))out.push(v);return out;
}
function getStep(mc,n){return mc?.steps?.find(x=>x.step===n)||null;}
function projectionSummary(mc,dir,entry,stop){
  const s5=getStep(mc,5),s10=getStep(mc,10),s20=getStep(mc,20);
  const primary=s10?.median??s20?.median??null;
  return {
    horizonBars:20,
    primary:{label:dir>0?'Bullish continuation':'Bearish continuation',bar5:s5?.median??null,bar10:s10?.median??null,bar20:s20?.median??null,note:finite(primary)?'Median model path; not a guaranteed price.':null},
    pullback:{label:dir>0?'Pullback / lower-band path':'Bounce / upper-band path',bar5:dir>0?s5?.p25:s5?.p75,bar10:dir>0?s10?.p25:s10?.p75,bar20:dir>0?s20?.p25:s20?.p75},
    expansion:{label:dir>0?'Upside expansion':'Downside expansion',bar5:dir>0?s5?.p75:s5?.p25,bar10:dir>0?s10?.p75:s10?.p25,bar20:dir>0?s20?.p75:s20?.p25},
    failure:{label:'Invalidation path',price:stop,note:dir>0?'A decisive loss of the fixed stop invalidates the bullish thesis.':'A decisive break above the fixed stop invalidates the bearish thesis.'},
    range10:s10?{low:s10.p25,high:s10.p75,tailLow:s10.p10,tailHigh:s10.p90}:null,
    range20:s20?{low:s20.p25,high:s20.p75,tailLow:s20.p10,tailHigh:s20.p90}:null,
    entry
  };
}
export function quantAnalyze({symbol,sourceSymbol=symbol,asset='STOCK',timeframe='1D',bars,provider='unknown',fetchedAt=null,credentialPolicy=null}){
  if(!Array.isArray(bars)||bars.length<80)throw new Error('Quant engine needs at least 80 completed bars.');
  const clean=bars.filter(b=>[b.open,b.high,b.low,b.close].every(finite)&&b.close>0),frame=analyzeFrame({bars:clean,status:'COMPLETED BAR',quality:'PASS',provider},timeframe);
  const closes=clean.map(b=>b.close),logs=closes.map(Math.log),rets=logs.map((x,i)=>i?x-logs[i-1]:0),smooth=ema(logs,5),v=diff(smooth),a=diff(v),j=diff(a),atr=atrSeries(clean,14),atr50=rollingMean(atr,50),last=clean.length-1,lastAtr=atr[last]||null,atrPct=finite(lastAtr)?lastAtr/closes[last]:null;
  const norm=x=>finite(x)&&atrPct?clamp(x/atrPct,-4,4):0;
  const velocity=norm(v[last]),acceleration=norm(a[last]),jerk=norm(j[last]);
  const curvature=finite(a[last])&&finite(v[last])?Math.abs(a[last])/Math.pow(1+v[last]*v[last],1.5):null;
  const entropy=shannonEntropy(rets.slice(-96),7),hurst=hurstExponent(logs.slice(-256)),cycle=dominantCycle(logs.slice(-256),10,80);
  const rv=realizedVol(rets.slice(-64),annualizer(timeframe)),pv=parkinsonVol(clean.slice(-64),annualizer(timeframe));
  const compression=finite(atr[last])&&finite(atr50[last])&&atr50[last]>0?atr[last]/atr50[last]:null;
  const volumes=clean.map(b=>finite(b.volume)?b.volume:null),vz=zscore(volumes,30)[last];
  const bar=clean[last],range=Math.max(1e-12,bar.high-bar.low),body=Math.abs(bar.close-bar.open),lowerWick=Math.max(0,Math.min(bar.open,bar.close)-bar.low)/range,upperWick=Math.max(0,bar.high-Math.max(bar.open,bar.close))/range;
  const bullAbsorption=finite(vz)&&vz>1.2&&lowerWick>.35&&body/range<.65,bearAbsorption=finite(vz)&&vz>1.2&&upperWick>.35&&body/range<.65;
  const trend=directionFromTrend(frame.technicals?.intermediate_trend),pattern=frame.structure?.pattern||'',structure=pattern.includes('UP')?1:pattern.includes('DOWN')?-1:0;
  const revDir=frame.reversal?.dir||0,revWeight=stageWeight(frame.reversal?.stage),mom=clamp(.55*velocity+.30*acceleration+.15*jerk,-1,1);
  const cycleBias=cycle?clamp(Math.sin(cycle.phase)*.45,-.45,.45):0;
  const flow=bullAbsorption?.55:bearAbsorption?-.55:finite(vz)?clamp((bar.close-bar.open)/range*Math.min(1,Math.max(0,vz)/2),-.35,.35):0;
  const persistence=finite(hurst)?clamp((hurst-.5)*2,-1,1):0;
  let raw=.28*trend+.16*structure+.22*mom+.12*revDir*revWeight+.08*flow+.07*cycleBias+.07*persistence*trend;
  if(finite(entropy)&&entropy>.9)raw*=.72;if(finite(compression)&&compression<.72)raw*=.82;raw=clamp(raw,-1,1);
  const dir=Math.abs(raw)>=.16?sign(raw):0,conviction=Math.round(Math.abs(raw)*100),entry=closes[last];
  let regime='MIXED / NO EDGE';
  if(finite(compression)&&compression<.72)regime='VOLATILITY COMPRESSION';
  if(finite(entropy)&&entropy<.72&&finite(hurst)&&hurst>.55&&trend)regime=trend>0?'BULLISH TREND PERSISTENCE':'BEARISH TREND PERSISTENCE';
  if(bullAbsorption&&velocity<0&&acceleration>0)regime='POSSIBLE ACCUMULATION / ABSORPTION';
  if(bearAbsorption&&velocity>0&&acceleration<0)regime='POSSIBLE DISTRIBUTION / ABSORPTION';
  if(finite(vz)&&vz>2.2&&range/(lastAtr||range)>1.6&&rets[last]<0)regime='CAPITULATION-LIKE VOLATILITY';
  const mu=mean(rets.slice(-40))||0,sigma=std(rets.slice(-64))||0,mc=monteCarlo({price:entry,mu:mu*.35+raw*Math.max(sigma*.08,0),sigma:Math.max(sigma,1e-5),steps:20,paths:1600,seed:hashSeed(symbol+sourceSymbol+bar.end_ts)});
  const calibration=historicalCalibration(clean,raw,dir,10);
  const support=frame.structure?.support?.[0]?.price,resistance=frame.structure?.resistance?.[0]?.price;
  const stop=dir>0?(finite(support)&&support<entry?support:entry-1.6*(lastAtr||0)):dir<0?(finite(resistance)&&resistance>entry?resistance:entry+1.6*(lastAtr||0)):null;
  const risk=dir&&finite(stop)?Math.abs(entry-stop):null,terminal=mc?.terminal||[],minGap=Math.max((lastAtr||entry*.01)*.2,entry*.001);
  const q40=quantile(terminal,.40),q50=quantile(terminal,.50),q60=quantile(terminal,.60),q25=quantile(terminal,.25),q75=quantile(terminal,.75),q10=quantile(terminal,.10),q90=quantile(terminal,.90);
  const structural=dir>0?(finite(resistance)&&resistance>entry?resistance:null):(finite(support)&&support<entry?support:null);
  const candidates=dir>0?[structural,q60,q75,q90]:dir<0?[structural,q40,q25,q10]:[];
  const targetValues=dir?uniqueDirectional(candidates,entry,dir,minGap).slice(0,3):[];
  const targets=targetValues.map((price,i)=>({name:'TP'+(i+1),price,riskReward:finite(risk)&&risk>0?Math.abs(price-entry)/risk:null,source:price===structural?'Nearest confirmed structure':'Monte Carlo distribution'}));
  const pullbackLow=dir>0?Math.max(stop||-Infinity,entry-.65*(lastAtr||0)):entry+.15*(lastAtr||0);
  const pullbackHigh=dir>0?entry-.15*(lastAtr||0):Math.min(stop||Infinity,entry+.65*(lastAtr||0));
  const entryZone=dir>0?{low:Math.min(pullbackLow,pullbackHigh),high:Math.max(pullbackLow,pullbackHigh)}:{low:Math.min(pullbackLow,pullbackHigh),high:Math.max(pullbackLow,pullbackHigh)};
  const breakoutTrigger=dir>0?entry+.28*(lastAtr||0):dir<0?entry-.28*(lastAtr||0):null;
  const rr1=targets[0]?.riskReward??null,entropyOk=!finite(entropy)||entropy<.93,trendAligned=dir&&(trend===dir||structure===dir),historicalSupport=calibration.n>=30&&finite(calibration.interval.low)&&calibration.interval.low>.45;
  let signalStage='NO EDGE',action='NO TRADE — EDGE TOO WEAK',actionDetail='Wait for a stronger directional state, cleaner structure, or improved projected reward/risk.';
  if(dir){
    if(conviction>=68&&finite(rr1)&&rr1>=1.35&&entropyOk&&trendAligned){signalStage='READY';action=dir>0?'LONG SETUP — WAIT FOR ENTRY / TRIGGER':'SHORT SETUP — WAIT FOR ENTRY / TRIGGER';actionDetail=dir>0?'Preferred entry is a controlled pullback into the entry zone, or a completed-bar breakout above the trigger.':'Preferred entry is a controlled bounce into the entry zone, or a completed-bar breakdown below the trigger.';}
    else if(conviction>=52&&finite(rr1)&&rr1>=1.05){signalStage='DEVELOPING';action=dir>0?'BULLISH SETUP DEVELOPING — DO NOT CHASE':'BEARISH SETUP DEVELOPING — DO NOT CHASE';actionDetail='The directional model is constructive, but the setup has not cleared the stronger trade-ready filters.';}
    else {signalStage='WATCH';action=dir>0?'BULLISH WATCH — WAIT':'BEARISH WATCH — WAIT';actionDetail='Directional lean exists, but current confluence or reward/risk is not strong enough for a trade-ready state.';}
  }
  const projection=dir?projectionSummary(mc,dir,entry,stop):null;
  const quality=signalStage==='READY'?(conviction>=78&&historicalSupport?'A':'B+'):(signalStage==='DEVELOPING'?'B':'WATCH');
  const plan=dir?{direction:dir>0?'LONG':'SHORT',action,actionDetail,quality,entry,entryZone,breakoutTrigger,stop,targets,rr:rr1,atr:lastAtr,entryRule:dir>0?'Use a completed-bar reclaim/rejection inside the entry zone, or a completed-bar break above the breakout trigger.':'Use a completed-bar rejection inside the entry zone, or a completed-bar break below the breakdown trigger.',invalidation:dir>0?'Close below the fixed stop invalidates the bullish setup.':'Close above the fixed stop invalidates the bearish setup.'}:null;
  return {model:'Q1.1',symbol,sourceSymbol,asset,timeframe,provider,fetchedAt,credentialPolicy,bars:clean,frame,generatedAt:new Date().toISOString(),state:{direction:dir>0?'BULLISH':dir<0?'BEARISH':'NEUTRAL',score:raw,conviction,signalStage,regime,action,quality},math:{velocity,acceleration,jerk,curvature,entropy,hurst,dominantCycle:cycle,realizedVol:rv,parkinsonVol:pv,compression,volumeZ:vz,bullAbsorption,bearAbsorption},forecast:{classification:'MODEL ESTIMATE',monteCarlo:mc?.steps||[],horizonBars:20,calibration,projection},plan,caveats:['Quant conviction is a normalized evidence score, not a probability.','Monte Carlo paths are regime-conditioned model estimates, not guaranteed future prices.','Historical same-direction frequency is retrospective context, not untouched out-of-sample proof.','Absorption/distribution labels are OHLCV proxies unless true order-book data is supplied.']};
}
