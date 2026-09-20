import {analyzeFrame} from '../analysis.mjs';
import {clamp,finite,mean,std,ema,diff,zscore,shannonEntropy,hurstExponent,dominantCycle,trueRange,rollingMean,realizedVol,parkinsonVol,monteCarlo,hashSeed,wilson,quantile} from './math.mjs';

const annualizer=tf=>({'15M':6552,'1H':1638,'4H':410,'1D':252,'1W':52}[tf]||252);
const sign=x=>x>0?1:x<0?-1:0;
function atrSeries(bars,n=14){const tr=trueRange(bars);return rollingMean(tr,n);}
function directionFromTrend(t){return t==='BULLISH'?1:t==='BEARISH'?-1:0;}
function stageWeight(stage=''){return /CONFIRMED/.test(stage)?1:/DEVELOPING/.test(stage)?.65:/WATCH/.test(stage)?.35:0;}
function historicalCalibration(bars,scoreNow,dir,horizon=10){if(bars.length<180||!dir)return {status:'INSUFFICIENT',n:0,rate:null,interval:{low:null,high:null}};const closes=bars.map(b=>b.close),e20=ema(closes,20),e50=ema(closes,50),rets=closes.map((c,i)=>i?Math.log(c/closes[i-1]):0),mom=rollingMean(rets,5);const samples=[];for(let i=80;i<bars.length-horizon;i++){if(!finite(e20[i])||!finite(e50[i])||!finite(mom[i]))continue;const trend=sign(e20[i]-e50[i]),m=sign(mom[i]),simple=clamp(.65*trend+.35*m,-1,1);if(sign(simple)!==dir)continue;if(Math.abs(Math.abs(simple)-Math.abs(scoreNow))>.45)continue;const r=Math.log(closes[i+horizon]/closes[i]);samples.push(dir*r>0);}const n=samples.length,success=samples.filter(Boolean).length,rate=n?success/n:null;return {status:n>=30?'RETROSPECTIVE SAMPLE':'SMALL SAMPLE',n,rate,interval:wilson(success,n),horizon};}
export function quantAnalyze({symbol,sourceSymbol=symbol,asset='STOCK',timeframe='1D',bars,provider='unknown'}){
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
  const bullAbsorption=finite(vz)&&vz>1.2&&lowerWick>.35&&body/range<.65;const bearAbsorption=finite(vz)&&vz>1.2&&upperWick>.35&&body/range<.65;
  const trend=directionFromTrend(frame.technicals?.intermediate_trend),structure=directionFromTrend(frame.structure?.pattern?.includes('UP')?'BULLISH':frame.structure?.pattern?.includes('DOWN')?'BEARISH':'');
  const revDir=frame.reversal?.dir||0,revWeight=stageWeight(frame.reversal?.stage),mom=clamp(.55*velocity+.30*acceleration+.15*jerk,-1,1);
  const cycleBias=cycle?clamp(Math.sin(cycle.phase)*.45,-.45,.45):0;
  const flow=bullAbsorption?.55:bearAbsorption?-.55:finite(vz)?clamp((bar.close-bar.open)/range*Math.min(1,Math.max(0,vz)/2),-.35,.35):0;
  const persistence=finite(hurst)?clamp((hurst-.5)*2,-1,1):0;
  let raw=.28*trend+.16*structure+.22*mom+.12*revDir*revWeight+.08*flow+.07*cycleBias+.07*persistence*trend;
  if(finite(entropy)&&entropy>.9)raw*=.72;if(finite(compression)&&compression<.72)raw*=.82;raw=clamp(raw,-1,1);
  const dir=Math.abs(raw)>=.16?sign(raw):0,conviction=Math.round(Math.abs(raw)*100);
  let regime='MIXED / NO EDGE';
  if(finite(compression)&&compression<.72)regime='VOLATILITY COMPRESSION';
  if(finite(entropy)&&entropy<.72&&finite(hurst)&&hurst>.55&&trend)regime=trend>0?'BULLISH TREND PERSISTENCE':'BEARISH TREND PERSISTENCE';
  if(bullAbsorption&&velocity<0&&acceleration>0)regime='POSSIBLE ACCUMULATION / ABSORPTION';
  if(bearAbsorption&&velocity>0&&acceleration<0)regime='POSSIBLE DISTRIBUTION / ABSORPTION';
  if(finite(vz)&&vz>2.2&&range/(lastAtr||range)>1.6&&rets[last]<0)regime='CAPITULATION-LIKE VOLATILITY';
  const mu=mean(rets.slice(-40))||0,sigma=std(rets.slice(-64))||0,mc=monteCarlo({price:closes[last],mu:mu*.35+raw*Math.max(sigma*.08,0),sigma:Math.max(sigma,1e-5),steps:20,paths:1200,seed:hashSeed(symbol+sourceSymbol+bar.end_ts)});
  const calibration=historicalCalibration(clean,raw,dir,10);
  const support=frame.structure?.support?.[0]?.price,resistance=frame.structure?.resistance?.[0]?.price;
  const stop=dir>0?(finite(support)?support:closes[last]-1.5*(lastAtr||0)):dir<0?(finite(resistance)?resistance:closes[last]+1.5*(lastAtr||0)):null;
  const risk=dir&&finite(stop)?Math.abs(closes[last]-stop):null;
  const terminal=mc?.terminal||[],target=dir>0?quantile(terminal,.75):dir<0?quantile(terminal,.25):null,rr=finite(target)&&finite(risk)&&risk>0?Math.abs(target-closes[last])/risk:null;
  const signalStage=dir===0?'NO EDGE':conviction>=72&&frame.reversal?.stage?.includes('CONFIRMED')?'CONFIRMED':conviction>=58?'DEVELOPING':'WATCH';
  return {model:'Q1.0',symbol,sourceSymbol,asset,timeframe,provider,bars:clean,frame,generatedAt:new Date().toISOString(),state:{direction:dir>0?'BULLISH':dir<0?'BEARISH':'NEUTRAL',score:raw,conviction,signalStage,regime},math:{velocity,acceleration,jerk,curvature,entropy,hurst,dominantCycle:cycle,realizedVol:rv,parkinsonVol:pv,compression,volumeZ:vz,bullAbsorption,bearAbsorption},forecast:{classification:'MODEL ESTIMATE',monteCarlo:mc?.steps||[],horizonBars:20,calibration},plan:dir?{direction:dir>0?'LONG':'SHORT',entry:closes[last],entryZone:{low:closes[last]-.2*(lastAtr||0),high:closes[last]+.2*(lastAtr||0)},stop,target,rr,atr:lastAtr,note:'Model-derived watch plan. It is not a fill instruction and is not a calibrated forecast probability.'}:null,caveats:['Quant conviction is a normalized evidence score, not a probability.','Monte Carlo paths are regime-conditioned model estimates, not guaranteed future prices.','Absorption/distribution labels are OHLCV proxies unless order-book data is supplied.']};
}
