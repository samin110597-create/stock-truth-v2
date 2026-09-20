import {finite,mean,quantile,clamp} from './numeric.mjs';
export const FORECAST_VERSION='1.0.0-ridge-walk-forward';
export const FEATURE_NAMES=['Price vs EMA20 / ATR','EMA20 vs EMA50 / ATR','RSI balance','MACD / ATR','MACD histogram / ATR','5-bar momentum / ATR','20-bar momentum / ATR','Candle body / ATR','Close location','ATR / price'];
export function forecastFeatures(b,t){return b.map((x,i)=>{
  if(i<49)return null;const a=t.series.atr[i],e=t.series.ema;
  if(!finite(a)||a<=0)return null;
  const v=[(x.close-e[20][i])/a,(e[20][i]-e[50][i])/a,(t.series.rsi[i]-50)/25,t.series.macd[i]/a,t.series.hist[i]/a,(x.close-b[i-5].close)/a,(x.close-b[i-20].close)/(a*Math.sqrt(20)),(x.close-x.open)/a,x.high>x.low?(x.close-x.low)/(x.high-x.low)-.5:0,a/x.close];
  // Indicator warm-up/nulls must never become numeric zero through arithmetic.
  if(![e[20][i],e[50][i],t.series.rsi[i],t.series.macd[i],t.series.hist[i]].every(finite)||!v.every(finite))return null;
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
  for(let i=Math.max(49,asOf-h-maxSamples);i+h<asOf;i++)if(features[i])rows.push({i,x:features[i],y:Math.log(b[i+h].close/b[i].close)});
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
export function technicalForecast(b,t,{maxFolds=40}={}){
  const features=forecastFeatures(b,t),origin=b.length-1,last=b.at(-1),horizons=[];
  for(const h of [1,5,21,63]){
    const fit=fitAt(b,features,origin,h);
    if(!fit){horizons.push({sessions:h,status:'INSUFFICIENT DATA',reason:'Needs 50 indicator warm-up bars plus 60 matured training labels and a one-bar embargo.',training_samples:Math.max(0,b.length-50-h)});continue;}
    const folds=[];
    // Test windows do not overlap. Each refit sees only labels already matured
    // before that test origin. Hyperparameters never use the test outcomes.
    const origins=[];for(let i=origin-h;i>=49+60+h&&origins.length<maxFolds;i-=h+1)origins.push(i);
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
  return {version:FORECAST_VERSION,classification:'MODEL ESTIMATE',as_of:last?.end_ts||null,anchor_price:last?.close||null,horizons,features:FEATURE_NAMES,method:'Locally fitted ridge regression on ten completed-bar trend, momentum, volatility and candle features. Fixed regularization 12; up to 756 training labels; at least 60 required. One-bar label embargo; up to 40 non-overlapping chronological test windows per horizon. Predictions bounded to the training-return range. No tuning on test windows.',
    update_policy:'Refitted when newly completed daily price action is retrieved. A live quote is context only; the forecast origin remains the latest completed candle. These research forecasts never alter issued entry, stop or TP levels.',
    limitation:'Retrospective walk-forward results are not untouched prospective validation. Overlapping training labels reduce effective sample size. No calibrated up/down probability or claimed trading edge. Price returns exclude dividends and execution costs; a better price forecast is not proof of profitable trades.'};
}
