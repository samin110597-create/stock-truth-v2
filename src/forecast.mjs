import {finite,mean,quantile,clamp} from './numeric.mjs';
export const FORECAST_VERSION='1.1.0-price-volume-actionable';
export const FEATURE_NAMES=['Price vs EMA20 / ATR','EMA20 vs EMA50 / ATR','EMA50 vs EMA200 / ATR','RSI balance','MACD / ATR','MACD histogram / ATR','ADX strength','5-bar momentum / ATR','20-bar momentum / ATR','Candle body / ATR','Close location','20-bar range position','ATR / price','Relative volume','CMF flow','Bollinger width','Signed volume expansion'];
export function forecastFeatures(b,t){return b.map((x,i)=>{
  if(i<199)return null;const a=t.series.atr[i],e=t.series.ema,rvol=t.series.rvol[i],cmf=t.series.cmf[i],adx=t.series.adx[i],bbw=t.series.bbWidth[i];
  if(!finite(a)||a<=0)return null;
  const prior=b.slice(i-20,i),hi20=prior.length?Math.max(...prior.map(z=>z.high)):null,lo20=prior.length?Math.min(...prior.map(z=>z.low)):null;
  const rangePos=finite(hi20)&&finite(lo20)&&hi20>lo20?(x.close-lo20)/(hi20-lo20)*2-1:0;
  const signedVolume=finite(rvol)?(rvol-1)*Math.sign(x.close-x.open):null;
  const v=[(x.close-e[20][i])/a,(e[20][i]-e[50][i])/a,(e[50][i]-e[200][i])/a,(t.series.rsi[i]-50)/25,t.series.macd[i]/a,t.series.hist[i]/a,(adx-20)/20,(x.close-b[i-5].close)/a,(x.close-b[i-20].close)/(a*Math.sqrt(20)),(x.close-x.open)/a,x.high>x.low?(x.close-x.low)/(x.high-x.low)-.5:0,rangePos,a/x.close,Math.log(Math.max(.1,rvol)),cmf,bbw,signedVolume];
  // Warm-up/nulls must never become numeric zero through arithmetic.
  if(![e[20][i],e[50][i],e[200][i],t.series.rsi[i],t.series.macd[i],t.series.hist[i],adx,rvol,cmf,bbw].every(finite)||!v.every(finite))return null;
  return v.map(v=>clamp(v,-10,10));
});}
function solve(A,b){
  const z=A.map((row,i)=>[...row,b[i]]),n=b.length;
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(z[j][i])>Math.abs(z[p][i]))p=j;
    if(Math.abs(z[p][i])<1e-12)return null;[z[i],z[p]]=[z[p],z[i]];
    const d=z[i][i];for(let k=i;k<=n;k++)z[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=z[j][i];for(let k=i;k<=n;k++)z[j][k]-=f*z[i][k];}
  }
  return z.map(row=>row[n]);
}
export function fitAt(b,features,asOf,h,{minSamples=60,maxSamples=756,lambda=12}={}){
  if(!features[asOf])return null;
  const rows=[];
  // One completed-bar embargo: the last training label ends before the origin.
  for(let i=Math.max(199,asOf-h-maxSamples);i+h<asOf;i++)if(features[i])rows.push({i,x:features[i],y:Math.log(b[i+h].close/b[i].close)});
  if(rows.length<minSamples)return null;
  const n=rows.length,d=features[asOf].length,mu=Array.from({length:d},(_,k)=>mean(rows.map(r=>r.x[k]))),sd=mu.map((m,k)=>Math.sqrt(mean(rows.map(r=>(r.x[k]-m)**2)))||1);
  const normalize=x=>[1,...x.map((v,k)=>(v-mu[k])/sd[k])],A=Array.from({length:d+1},()=>Array(d+1).fill(0)),Y=Array(d+1).fill(0);
  for(const r of rows){const x=normalize(r.x);for(let j=0;j<=d;j++){Y[j]+=x[j]*r.y;for(let k=0;k<=d;k++)A[j][k]+=x[j]*x[k];}}
  for(let j=1;j<=d;j++)A[j][j]+=lambda;
  const beta=solve(A,Y);if(!beta)return null;
  const x=normalize(features[asOf]),prediction=beta.reduce((v,w,j)=>v+w*x[j],0);
  const trainingMin=Math.min(...rows.map(r=>r.y)),trainingMax=Math.max(...rows.map(r=>r.y));
  const bounded=clamp(prediction,trainingMin,trainingMax);
  return {prediction:bounded,raw_prediction:prediction,clipped:bounded!==prediction,n,train_first:rows[0].i,train_last:rows.at(-1).i,label_end:rows.at(-1).i+h,drift:mean(rows.map(r=>r.y)),contributions:FEATURE_NAMES.map((name,k)=>({name,value:beta[k+1]*x[k+1]})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,4)};
}
export function forecastTradeCall(b,t,st,read,forecast,horizon='SWING'){
  const sessions=horizon==='POSITION'?63:21,row=(forecast?.horizons||[]).find(x=>x.sessions===sessions),last=b.at(-1),i=b.length-1,a=t.series.atr[i];
  if(!row||!last||!finite(a)||a<=0||!finite(row.base))return {action:'WAIT',status:'UNAVAILABLE',reason:'Forecast or ATR unavailable.',horizon,sessions,targets:[]};
  const trend=t.snapshot.intermediate_trend==='BULLISH'?1:t.snapshot.intermediate_trend==='BEARISH'?-1:0;
  const structure=finite(st?.current?.direction)?st.current.direction:finite(st?.direction)?st.direction:0;
  const momentum=mean([
    finite(t.snapshot.rsi)?clamp((t.snapshot.rsi-50)/20,-1,1):0,
    finite(t.snapshot.macd_hist)?clamp(t.snapshot.macd_hist/a*4,-1,1):0,
  ]);
  const volume=clamp(
    (finite(t.snapshot.cmf)?t.snapshot.cmf*3:0)+
    (finite(t.snapshot.rvol)?Math.sign(last.close-last.open)*(t.snapshot.rvol-1)*.25:0),
    -1,1
  );
  const forecastDir=clamp((row.base-last.close)/(a*1.5),-1,1);
  const readDir=finite(read?.signed_score)?clamp(read.signed_score/100,-1,1):0;
  const score=.35*forecastDir+.20*readDir+.15*trend+.15*structure+.10*momentum+.05*volume;
  const action=score>=.22&&row.base>last.close?'BUY':score<=-.22&&row.base<last.close?'SELL':'WAIT';
  const dir=action==='BUY'?1:action==='SELL'?-1:0;
  const support=st?.current?.support?.[0]?.price??st?.support?.[0]?.price;
  const resistance=st?.current?.resistance?.[0]?.price??st?.resistance?.[0]?.price;
  const ema20=t.snapshot.ema?.[20];
  if(!dir)return {action,status:'MIXED',horizon,sessions,evidence_score:Math.round(Math.abs(score)*100),directional_score:score,anchor:last.close,central_estimate:row.base,lower_scenario:row.bear,upper_scenario:row.bull,targets:[],reason:'Forecast, trend, structure, momentum and volume do not align strongly enough for a directional call.'};

  let center=last.close;
  if(dir>0&&finite(support)&&support<last.close&&last.close-support<=1.2*a)center=support;
  else if(dir<0&&finite(resistance)&&resistance>last.close&&resistance-last.close<=1.2*a)center=resistance;
  else if(dir>0&&finite(ema20)&&ema20<last.close&&last.close-ema20<=a)center=ema20;
  else if(dir<0&&finite(ema20)&&ema20>last.close&&ema20-last.close<=a)center=ema20;

  const zone={low:Math.max(.01,center-.15*a),high:center+.15*a},entry=dir>0?zone.high:zone.low;
  let stop;
  if(dir>0)stop=finite(support)&&support<zone.low?Math.min(zone.low-.8*a,support-.2*a):zone.low-a;
  else stop=finite(resistance)&&resistance>zone.high?Math.max(zone.high+.8*a,resistance+.2*a):zone.high+a;
  stop=Math.max(.01,stop);
  const risk=Math.abs(entry-stop);
  const candidates=[];
  const add=(price,basis)=>{
    if(!finite(price)||price<=0||dir*(price-entry)<=.4*risk)return;
    if(candidates.some(x=>Math.abs(x.price-price)<.25*a))return;
    candidates.push({price,basis});
  };
  if(dir>0){
    add(resistance,'Confirmed structural resistance');
    add(row.base,sessions+'-session central price forecast');
    add(row.bull,'Favorable empirical forecast band');
    add(entry+1.5*risk,'1.5R fallback objective');
    add(entry+2.5*risk,'2.5R fallback objective');
    candidates.sort((x,y)=>x.price-y.price);
  }else{
    add(support,'Confirmed structural support');
    add(row.base,sessions+'-session central price forecast');
    add(row.bear,'Favorable empirical forecast band');
    add(entry-1.5*risk,'1.5R fallback objective');
    add(entry-2.5*risk,'2.5R fallback objective');
    candidates.sort((x,y)=>y.price-x.price);
  }
  const targets=candidates.slice(0,3).map((x,k)=>({...x,name:'TP'+(k+1),risk_reward:Math.abs(x.price-entry)/risk}));
  return {
    action,status:'UNVERIFIED FORECAST CALL',classification:'MODEL ESTIMATE',horizon,sessions,
    evidence_score:Math.round(Math.abs(score)*100),directional_score:score,
    anchor:last.close,entry_zone:zone,entry_reference:entry,stop,targets,
    central_estimate:row.base,lower_scenario:row.bear,upper_scenario:row.bull,
    components:{forecast:forecastDir,technical_read:readDir,trend,structure,momentum,volume},
    reason:'Direction combines the '+sessions+'-session price forecast with current price action, trend, structure, momentum and volume/participation. It is separate from a confirmed setup and is not a calibrated probability.',
    invalidation:'Forecast call is invalidated at the fixed stop; a newly completed candle may create a new forecast, but this displayed plan is not retroactively rewritten.'
  };
}

export function technicalForecast(b,t,{maxFolds=40}={}){
  const features=forecastFeatures(b,t),origin=b.length-1,last=b.at(-1),horizons=[];
  for(const h of [1,5,21,63]){
    const fit=fitAt(b,features,origin,h);
    if(!fit){horizons.push({sessions:h,status:'INSUFFICIENT DATA',reason:'Needs 200 indicator warm-up bars plus 60 matured training labels and a one-bar embargo.',training_samples:Math.max(0,b.length-200-h)});continue;}
    const folds=[];
    // Test windows do not overlap. Each refit sees only labels already matured
    // before that test origin. Hyperparameters never use the test outcomes.
    const origins=[];for(let i=origin-h;i>=199+60+h&&origins.length<maxFolds;i-=h+1)origins.push(i);
    for(const i of origins.reverse()){
      const f=fitAt(b,features,i,h);if(!f)continue;
      const actual=Math.log(b[i+h].close/b[i].close);
      folds.push({origin:b[i].date,through:b[i+h].date,train_through:b[f.label_end].date,predicted:f.prediction,actual,drift:f.drift,residual:actual-f.prediction});
    }
    const n=folds.length,mae=n?mean(folds.map(f=>Math.abs(Math.expm1(f.predicted)-Math.expm1(f.actual)))):null,baseline=n?mean(folds.map(f=>Math.abs(Math.expm1(f.actual)))):null,driftMae=n?mean(folds.map(f=>Math.abs(Math.expm1(f.drift)-Math.expm1(f.actual)))):null;
    const directional=folds.filter(f=>f.actual!==0&&f.predicted!==0),accuracy=directional.length?mean(directional.map(f=>Math.sign(f.predicted)===Math.sign(f.actual)?1:0)):null;
    const skill=finite(baseline)&&baseline>0?1-mae/baseline:null,base=last.close*Math.exp(fit.prediction);
    const residuals=folds.map(f=>f.residual),bounds=n>=20?[quantile(residuals,.1),quantile(residuals,.9)]:null;
    // Honest sequential band coverage: only earlier residuals construct a band.
    const coverage=[];for(let i=20;i<folds.length;i++){const prev=residuals.slice(0,i);coverage.push(folds[i].residual>=quantile(prev,.1)&&folds[i].residual<=quantile(prev,.9)?1:0);}
    const positive=n>=30&&finite(skill)&&skill>0&&mae<driftMae;
    horizons.push({sessions:h,status:n<20?'UNVERIFIED · LIMITED VALIDATION':positive?'HISTORICAL BASELINE IMPROVEMENT':'NO DEMONSTRATED BASELINE ADVANTAGE',classification:'MODEL ESTIMATE',training_samples:fit.n,training_label_end:b[fit.label_end].date,origin:last.date,anchor_price:last.close,predicted_return:Math.expm1(fit.prediction),base,
      bear:bounds?last.close*Math.exp(fit.prediction+bounds[0]):null,bull:bounds?last.close*Math.exp(fit.prediction+bounds[1]):null,band_basis:bounds?'10th–90th percentiles of prior walk-forward residuals; an empirical range, not calibrated odds.':'INSUFFICIENT DATA for empirical range (20 test windows required).',clipped:fit.clipped,drivers:fit.contributions,
      validation:{n,mae,no_change_mae:baseline,drift_mae:driftMae,mae_skill:skill,directional_accuracy:accuracy,directional_n:directional.length,range_coverage:coverage.length?mean(coverage):null,range_coverage_n:coverage.length,folds}});
  }
  return {version:FORECAST_VERSION,classification:'MODEL ESTIMATE',as_of:last?.end_ts||null,anchor_price:last?.close||null,horizons,features:FEATURE_NAMES,method:'Locally fitted ridge regression on completed-bar price action, EMA trend, momentum, ADX, volatility, relative volume, CMF and candle/range-location features. Fixed regularization 12; up to 756 training labels; at least 60 required. One-bar label embargo; up to 40 non-overlapping chronological test windows per horizon. Predictions bounded to the training-return range. No tuning on test windows.',
    update_policy:'Refitted when newly completed daily price action is retrieved. A live quote is context only; the forecast origin remains the latest completed candle. These research forecasts never alter issued entry, stop or TP levels.',
    limitation:'Retrospective walk-forward results are not untouched prospective validation. Overlapping training labels reduce effective sample size. No calibrated up/down probability or claimed trading edge. Price returns exclude dividends and execution costs; a better price forecast is not proof of profitable trades.'};
}
