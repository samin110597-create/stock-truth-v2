import {finite,clamp,ema,rollingMean,zscore,trueRange,rsi,std} from './math.mjs';

function latentFilter(logp,alpha=.22,beta=.045){
  const level=[],velocity=[],acceleration=[];let lv=null,v=0,prevV=0;
  for(let i=0;i<logp.length;i++){
    const z=logp[i];
    if(!finite(z)){level.push(null);velocity.push(null);acceleration.push(null);continue;}
    if(lv==null){lv=z;v=0;prevV=0;}
    else{const pred=lv+v,err=z-pred;lv=pred+alpha*err;prevV=v;v=v+beta*err;}
    level.push(lv);velocity.push(v);acceleration.push(i? v-prevV:0);
  }
  return {level,velocity,acceleration};
}
function rollingStd(values,n){
  return values.map((_,i)=>{
    if(i<n-1)return null;
    const w=values.slice(i-n+1,i+1).filter(finite);
    return w.length>=Math.max(5,Math.floor(n/2))?std(w):null;
  });
}
export function modelFeatures(bars){
  const b=(bars||[]).filter(x=>[x.open,x.high,x.low,x.close].every(finite)&&x.close>0);
  if(b.length<220)return null;
  const c=b.map(x=>x.close),logs=c.map(Math.log),rets=c.map((v,i)=>i?Math.log(v/c[i-1]):null),e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),r=rsi(c,14),tr=trueRange(b),atr14=rollingMean(tr,14),atr50=rollingMean(atr14,50),vols=b.map(x=>finite(x.volume)?x.volume:null),vz=zscore(vols,30),rv20=rollingStd(rets,20),latent=latentFilter(logs),i=b.length-1;
  if(i<210)return null;
  const atrPct=finite(atr14[i])&&c[i]>0?atr14[i]/c[i]:null,hi20=Math.max(...b.slice(i-20,i).map(x=>x.high)),lo20=Math.min(...b.slice(i-20,i).map(x=>x.low)),width=hi20-lo20,rangePos=width>0?(c[i]-lo20)/width*2-1:0,breakout=c[i]>hi20?1:c[i]<lo20?-1:0,trend=e20[i]>e50[i]?1:e20[i]<e50[i]?-1:0,comp=finite(atr14[i])&&finite(atr50[i])&&atr50[i]>0?atr14[i]/atr50[i]:null,rcenter=finite(r[i])?(r[i]-50)/50:null,ret1=rets[i],ret5=logs[i]-logs[i-5],ret20=logs[i]-logs[i-20],meanrev=finite(rcenter)&&Math.abs(rcenter)>.30?-rcenter:0;
  const values={
    ret1,ret5,ret20,
    ema20_dist:e20[i]>0?c[i]/e20[i]-1:null,
    ema50_dist:e50[i]>0?c[i]/e50[i]-1:null,
    ema200_dist:e200[i]>0?c[i]/e200[i]-1:null,
    rsi_center:rcenter,atr_pct:atrPct,volume_z:vz[i],
    compression:finite(comp)?comp-1:null,
    range_pos20:rangePos,breakout20:breakout,
    latent_velocity:finite(latent.velocity[i])&&finite(atrPct)&&atrPct>0?latent.velocity[i]/atrPct:null,
    latent_acceleration:finite(latent.acceleration[i])&&finite(atrPct)&&atrPct>0?latent.acceleration[i]/atrPct:null,
    realized_vol20:rv20[i],trend_state:trend,trend_momentum:trend*ret5,
    compression_flag:finite(comp)&&comp<.80?1:0,meanrev_signal:meanrev
  };
  return Object.values(values).every(finite)?values:null;
}
function sigmoid(z){if(z>=0){const e=Math.exp(-z);return 1/(1+e);}const e=Math.exp(z);return e/(1+e);}
function calibrate(raw,points=[]){
  const p=points.filter(x=>finite(x.raw)&&finite(x.calibrated)).sort((a,b)=>a.raw-b.raw);
  if(!p.length)return raw;if(raw<=p[0].raw)return p[0].calibrated;if(raw>=p.at(-1).raw)return p.at(-1).calibrated;
  for(let i=1;i<p.length;i++)if(raw<=p[i].raw){const a=p[i-1],b=p[i],t=(raw-a.raw)/Math.max(1e-9,b.raw-a.raw);return a.calibrated+t*(b.calibrated-a.calibrated);}
  return raw;
}
function bandFor(raw,bands=[]){
  const b=bands.find(x=>raw>=x.low&&raw<(x.high>=1?1.000001:x.high));
  if(b)return b;if(!bands.length)return null;
  return [...bands].sort((a,b)=>Math.abs((a.low+a.high)/2-raw)-Math.abs((b.low+b.high)/2-raw))[0];
}
export function applyTrainedModel(model,timeframe,bars){
  const features=modelFeatures(bars),tf=model?.timeframes?.[timeframe];if(!features||!tf)return null;
  const out={features,horizons:{},modelVersion:model.model_version,generatedAt:model.generated_at,promotionRule:model.promotion_rule,labelDefinition:model.label_definition};
  for(const h of ['5','10','20']){
    const m=tf[h];if(!m||!Array.isArray(m.coef)||!m.scaler)continue;
    const names=model.features||[],x=names.map(n=>features[n]),means=m.scaler.mean||[],scales=m.scaler.scale||[];if(x.some(v=>!finite(v)))continue;
    let z=m.intercept||0;for(let i=0;i<x.length;i++){const s=finite(scales[i])&&Math.abs(scales[i])>1e-12?scales[i]:1;z+=(m.coef[i]||0)*((x[i]-(means[i]||0))/s);}
    const raw=sigmoid(clamp(z,-35,35)),cal=calibrate(raw,m.calibration||[]),band=bandFor(raw,m.return_bands||[]);
    out.horizons[h]={rawProbabilityUp:raw,probabilityUp:m.validated?cal:null,validated:!!m.validated,status:m.status,metrics:m.metrics||null,returnBand:band||null,oosSamples:m.oos_samples||0,samples:m.samples||0};
  }
  return out;
}
export function mtfBias(mtf={}){
  const rows=[];for(const tf of ['15M','1H','4H','1D']){const bars=mtf?.[tf];if(!Array.isArray(bars)||bars.length<60)continue;const c=bars.map(b=>b.close),e20=ema(c,20),e50=ema(c,50),i=c.length-1;rows.push({timeframe:tf,bias:e20[i]>e50[i]?1:e20[i]<e50[i]?-1:0,close:c[i]});}
  const sum=rows.reduce((s,x)=>s+x.bias,0);return {rows,net:rows.length?sum/rows.length:0,available:rows.length};
}
