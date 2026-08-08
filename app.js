const PERIODS=[9,21,50,100,150,200];
const THRESHOLDS=[0.54,0.56,0.58,0.60,0.62,0.65,0.68,0.70];
const $=s=>document.querySelector(s);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const fmt=(x,d=2)=>finite(x)?Number(x).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=(x,d=1)=>finite(x)?`${(Number(x)*100).toFixed(d)}%`:'—';
const pct100=(x,d=1)=>finite(x)?`${Number(x).toFixed(d)}%`:'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function getStock(symbol){
  const r=await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store'});
  const j=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
  if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
  return j;
}

function sma(v,n){
  const out=Array(v.length).fill(null);let s=0,q=[];
  for(let i=0;i<v.length;i++){
    const x=Number(v[i]);q.push(x);s+=x;
    if(q.length>n)s-=q.shift();
    if(q.length===n)out[i]=s/n;
  }return out;
}
function ema(v,n){
  const out=Array(v.length).fill(null),k=2/(n+1);let e=null;
  for(let i=0;i<v.length;i++){
    const x=Number(v[i]);
    e=e==null?x:x*k+e*(1-k);out[i]=e;
  }return out;
}
function rsi(v,n=14){
  const out=Array(v.length).fill(null);let ag=0,al=0;
  for(let i=1;i<v.length;i++){
    const d=v[i]-v[i-1],g=Math.max(d,0),l=Math.max(-d,0);
    if(i<=n){ag+=g;al+=l;if(i===n){ag/=n;al/=n;out[i]=al===0?100:100-100/(1+ag/al);}}
    else{ag=(ag*(n-1)+g)/n;al=(al*(n-1)+l)/n;out[i]=al===0?100:100-100/(1+ag/al);}
  }return out;
}
function atr(bars,n=14){
  const tr=bars.map((b,i)=>i===0?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)));
  return ema(tr,n);
}
function rollingStd(v,n){
  const out=Array(v.length).fill(null);
  for(let i=n-1;i<v.length;i++){
    const a=v.slice(i-n+1,i+1),m=a.reduce((s,x)=>s+x,0)/n;
    out[i]=Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/Math.max(1,n-1));
  }return out;
}
function returns(v,n){return v.map((x,i)=>i>=n&&finite(v[i-n])&&Number(v[i-n])!==0?x/v[i-n]-1:null);}

function weekKey(date){
  const d=new Date(`${date}T00:00:00Z`);const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);
  return d.toISOString().slice(0,10);
}
function resample(bars,mode){
  const groups=new Map();
  for(const b of bars){
    const key=mode==='weekly'?weekKey(b.date):b.date.slice(0,7);
    let g=groups.get(key);
    if(!g){g={date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:Number(b.volume)||0};groups.set(key,g);}
    else{g.date=b.date;g.high=Math.max(g.high,b.high);g.low=Math.min(g.low,b.low);g.close=b.close;g.volume+=(Number(b.volume)||0);}
  }
  return [...groups.values()];
}

function timeframePack(bars){
  const c=bars.map(b=>Number(b.close));
  const ma={},em={};for(const p of PERIODS){ma[p]=sma(c,p);em[p]=ema(c,p);}
  const scores=Array(c.length).fill(null),availability=Array(c.length).fill(0);
  const pw={9:0.8,21:1,50:1.1,100:1.05,150:1,200:1.15};
  for(let i=0;i<c.length;i++){
    let base=0,den=0,avail=0;
    for(const p of PERIODS){
      if(finite(ma[p][i])){base+=(c[i]>=ma[p][i]?1:-1)*pw[p];den+=pw[p];avail++;}
      if(finite(em[p][i])){base+=(c[i]>=em[p][i]?1:-1)*pw[p];den+=pw[p];avail++;}
    }
    if(!den)continue;
    let s=2*(base/den);
    if(finite(em[9][i])&&finite(em[21][i])&&finite(em[50][i])){
      if(em[9][i]>em[21][i]&&em[21][i]>em[50][i])s+=0.45;
      if(em[9][i]<em[21][i]&&em[21][i]<em[50][i])s-=0.45;
    }
    if(PERIODS.slice(2).every(p=>finite(ma[p][i]))){
      const a=[50,100,150,200].map(p=>ma[p][i]);
      if(a[0]>a[1]&&a[1]>a[2]&&a[2]>a[3])s+=0.55;
      if(a[0]<a[1]&&a[1]<a[2]&&a[2]<a[3])s-=0.55;
    }
    if(i>=5&&finite(em[21][i-5]))s+=0.25*Math.sign(em[21][i]/em[21][i-5]-1);
    if(i>=10&&finite(em[50][i-10]))s+=0.25*Math.sign(em[50][i]/em[50][i-10]-1);
    scores[i]=clamp(s,-3,3);availability[i]=avail/(PERIODS.length*2);
  }
  return{bars,c,ma,em,scores,availability};
}

function mapCompletedToDaily(dailyBars,pack){
  const out=Array(dailyBars.length).fill(null),av=Array(dailyBars.length).fill(0);let j=-1;
  for(let i=0;i<dailyBars.length;i++){
    while(j+1<pack.bars.length&&pack.bars[j+1].date<=dailyBars[i].date)j++;
    if(j>=0){out[i]=pack.scores[j];av[i]=pack.availability[j];}
  }return{scores:out,availability:av};
}

function alignSeries(targetBars,sourceBars,field='close'){
  const out=Array(targetBars.length).fill(null);let j=-1;
  for(let i=0;i<targetBars.length;i++){
    while(j+1<sourceBars.length&&sourceBars[j+1].date<=targetBars[i].date)j++;
    if(j>=0)out[i]=Number(sourceBars[j][field]);
  }return out;
}

function buildFeatureEngine(stockBars,spyBars){
  const daily=timeframePack(stockBars),weekly=timeframePack(resample(stockBars,'weekly')),monthly=timeframePack(resample(stockBars,'monthly'));
  const w=mapCompletedToDaily(stockBars,weekly),m=mapCompletedToDaily(stockBars,monthly);
  const spyD=timeframePack(spyBars),spyW=timeframePack(resample(spyBars,'weekly')),spyM=timeframePack(resample(spyBars,'monthly'));
  const spyDailyScore=mapCompletedToDaily(stockBars,spyD),spyWeeklyScore=mapCompletedToDaily(stockBars,spyW),spyMonthlyScore=mapCompletedToDaily(stockBars,spyM);
  const c=daily.c,spyC=alignSeries(stockBars,spyBars);
  const ret5=returns(c,5),ret21=returns(c,21),ret63=returns(c,63),ret126=returns(c,126),ret252=returns(c,252);
  const sret21=returns(spyC,21),sret63=returns(spyC,63),sret126=returns(spyC,126);
  const rs63=c.map((_,i)=>finite(ret63[i])&&finite(sret63[i])?ret63[i]-sret63[i]:null);
  const rs126=c.map((_,i)=>finite(ret126[i])&&finite(sret126[i])?ret126[i]-sret126[i]:null);
  const rsi14=rsi(c,14),atr14=atr(stockBars,14),vol20=rollingStd(c.map((x,i)=>i?Math.log(x/c[i-1]):0),20);
  const v=stockBars.map(b=>Number(b.volume)||0),v20=sma(v,20);
  const score=Array(c.length).fill(null),detail=Array(c.length).fill(null);
  for(let i=0;i<c.length;i++){
    const ds=daily.scores[i],ws=w.scores[i],ms=m.scores[i];
    if(!finite(ds))continue;
    let tf=0,tfw=0;
    for(const [x,wt] of [[ds,0.45],[ws,0.35],[ms,0.20]])if(finite(x)){tf+=x*wt;tfw+=wt;}
    tf=tfw?tf/tfw:0;
    let mom=0;
    if(finite(ret21[i]))mom+=0.30*clamp(ret21[i]/0.08,-1,1);
    if(finite(ret63[i]))mom+=0.35*clamp(ret63[i]/0.18,-1,1);
    if(finite(ret126[i]))mom+=0.25*clamp(ret126[i]/0.30,-1,1);
    if(finite(ret252[i]))mom+=0.20*clamp(ret252[i]/0.50,-1,1);
    if(finite(rsi14[i]))mom+=0.20*clamp((rsi14[i]-50)/20,-1,1);
    let rs=0;
    if(finite(rs63[i]))rs+=0.35*clamp(rs63[i]/0.15,-1,1);
    if(finite(rs126[i]))rs+=0.25*clamp(rs126[i]/0.25,-1,1);
    let mr=0,mrw=0;
    for(const [x,wt] of [[spyDailyScore.scores[i],0.5],[spyWeeklyScore.scores[i],0.3],[spyMonthlyScore.scores[i],0.2]])if(finite(x)){mr+=x*wt;mrw+=wt;}
    mr=mrw?mr/mrw:0;
    let volPenalty=0;
    if(finite(atr14[i])&&c[i]){
      const ap=atr14[i]/c[i];if(ap>0.06)volPenalty=0.20*Math.sign(tf)*-1;else if(ap<0.018)volPenalty=0.08*Math.sign(tf);
    }
    let volume=0;if(finite(v20[i])&&v20[i]>0&&v[i]>0)volume=0.10*clamp((v[i]/v20[i]-1)/1.5,-1,1)*Math.sign(ret21[i]||tf);
    const total=clamp(tf+mom+rs+0.22*mr+volPenalty+volume,-4,4);
    const availability=daily.availability[i]*0.45+w.availability[i]*0.35+m.availability[i]*0.20;
    score[i]=total;detail[i]={daily:ds,weekly:ws,monthly:ms,momentum:mom,relative:rs,market:mr,rsi:rsi14[i],atrPct:finite(atr14[i])?atr14[i]/c[i]:null,vol20:vol20[i],availability,rs63:rs63[i],rs126:rs126[i]};
  }
  return{daily,weekly,monthly,score,detail,close:c,stockBars};
}

function fitLogistic(xs,ys){
  const n=xs.length;if(n<30)return null;
  const mean=xs.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(xs.reduce((s,x)=>s+(x-mean)*(x-mean),0)/Math.max(1,n-1))||1;
  const positives=ys.reduce((s,y)=>s+y,0);let a=Math.log((positives+1)/(n-positives+1)),b=0;
  const lr=0.08,lambda=0.01;
  for(let it=0;it<700;it++){
    let ga=0,gb=0;
    for(let i=0;i<n;i++){
      const z=(xs[i]-mean)/sd,p=1/(1+Math.exp(-(a+b*z))),e=p-ys[i];ga+=e;gb+=e*z;
    }
    a-=lr*ga/n;b-=lr*(gb/n+lambda*b);
  }
  return{a,b,mean,sd,predict(x){const z=(x-mean)/sd;return 1/(1+Math.exp(-(a+b*z)));}};
}
function confusion(rows){
  let tp=0,tn=0,fp=0,fn=0,correct=0;
  for(const r of rows){const pred=r.dir===1?1:0;if(pred===r.y)correct++;if(pred&&r.y)tp++;else if(pred&&!r.y)fp++;else if(!pred&&!r.y)tn++;else fn++;}
  const tpr=tp+fn?tp/(tp+fn):null,tnr=tn+fp?tn/(tn+fp):null;
  return{accuracy:rows.length?correct/rows.length:null,balanced:finite(tpr)&&finite(tnr)?(tpr+tnr)/2:null};
}
function chooseThreshold(train,model){
  const minCalls=Math.max(50,Math.floor(train.length*0.08));let best=null;
  for(const t of THRESHOLDS){
    const calls=[];
    for(const r of train){const p=model.predict(r.x);if(p>=t)calls.push({...r,dir:1,p});else if(p<=1-t)calls.push({...r,dir:-1,p});}
    if(calls.length<minCalls)continue;
    const cm=confusion(calls),coverage=calls.length/train.length;
    if(!finite(cm.accuracy)||!finite(cm.balanced))continue;
    const objective=cm.accuracy+0.30*cm.balanced+0.02*Math.log(Math.max(coverage,0.01));
    if(!best||objective>best.objective)best={t,objective,accuracy:cm.accuracy,balanced:cm.balanced,coverage,calls:calls.length};
  }
  return best||{t:0.58,objective:0,accuracy:null,balanced:null,coverage:0,calls:0};
}
function wilsonLower(w,n,z=1.96){
  if(!n)return null;const p=w/n,zz=z*z,den=1+zz/n;
  return (p+zz/(2*n)-z*Math.sqrt(p*(1-p)/n+zz/(4*n*n)))/den;
}

function walkForward(engine,horizon){
  const n=engine.close.length,warmup=260;
  const candidates=[];
  for(let i=warmup;i+horizon<n;i++)if(finite(engine.score[i]))candidates.push(i);
  if(candidates.length<350)return{status:'INSUFFICIENT_DATA',reason:`${candidates.length} usable labelled rows`};
  const initial=Math.floor(candidates.length*0.50),remaining=candidates.length-initial,chunk=Math.max(1,Math.floor(remaining/5));
  const oos=[];
  for(let f=0;f<5;f++){
    const ps=initial+f*chunk,pe=f===4?candidates.length:Math.min(candidates.length,ps+chunk);if(ps>=pe)continue;
    const firstTestIndex=candidates[ps];
    const trainIdx=candidates.slice(0,ps).filter(i=>i+horizon<firstTestIndex);
    const testIdx=candidates.slice(ps,pe);
    if(trainIdx.length<200||testIdx.length<20)continue;
    const train=trainIdx.map(i=>({i,x:engine.score[i],y:engine.close[i+horizon]>engine.close[i]?1:0}));
    const model=fitLogistic(train.map(r=>r.x),train.map(r=>r.y));if(!model)continue;
    const sel=chooseThreshold(train,model),baseP=train.reduce((s,r)=>s+r.y,0)/train.length,baseDir=baseP>=0.5?1:-1;
    for(const i of testIdx){
      const y=engine.close[i+horizon]>engine.close[i]?1:0,p=model.predict(engine.score[i]);
      let dir=0;if(p>=sel.t)dir=1;else if(p<=1-sel.t)dir=-1;
      oos.push({i,y,p,dir,baseP,baseDir,threshold:sel.t});
    }
  }
  if(oos.length<150)return{status:'INSUFFICIENT_OOS',reason:`${oos.length} OOS rows`};
  const calls=oos.filter(r=>r.dir!==0),cm=confusion(calls);
  let bw=0;for(const r of calls)if((r.baseDir===1?1:0)===r.y)bw++;
  const baseAcc=calls.length?bw/calls.length:null;
  const brier=oos.reduce((s,r)=>s+(r.p-r.y)*(r.p-r.y),0)/oos.length;
  const baseBrier=oos.reduce((s,r)=>s+(r.baseP-r.y)*(r.baseP-r.y),0)/oos.length;
  const skill=baseBrier>0?1-brier/baseBrier:null;
  const wins=calls.reduce((s,r)=>s+(((r.dir===1?1:0)===r.y)?1:0),0),lower=wilsonLower(wins,calls.length);
  const edge=finite(cm.accuracy)&&finite(baseAcc)?cm.accuracy-baseAcc:null,coverage=calls.length/oos.length;
  const verified=calls.length>=120&&coverage>=0.08&&finite(cm.balanced)&&cm.balanced>=0.53&&finite(edge)&&edge>=0.02&&finite(skill)&&skill>=0.01&&finite(lower)&&lower>0.50;
  const mature=[];for(let i=warmup;i+horizon<n;i++)if(finite(engine.score[i]))mature.push({i,x:engine.score[i],y:engine.close[i+horizon]>engine.close[i]?1:0});
  const currentModel=fitLogistic(mature.map(r=>r.x),mature.map(r=>r.y));const sel=currentModel?chooseThreshold(mature,currentModel):{t:0.58};
  const latest=n-1,pNow=currentModel&&finite(engine.score[latest])?currentModel.predict(engine.score[latest]):null;
  let current='NO VERIFIED EDGE';
  if(verified&&finite(pNow)){if(pNow>=sel.t)current='UP BIAS';else if(pNow<=1-sel.t)current='DOWN BIAS';else current='NEUTRAL';}
  return{status:verified?'VERIFIED_EDGE':'NO_VERIFIED_EDGE',verified,current,probUp:pNow,threshold:sel.t,oosRows:oos.length,calls:calls.length,coverage,hitRate:cm.accuracy,balancedAccuracy:cm.balanced,baselineAccuracy:baseAcc,edge,brier,brierSkill:skill,wilsonLower:lower,walkForwardSplits:5};
}

function currentContext(data){
  const c=data.context||{},now=Date.now();let earnings=null;
  const dates=c.earnings?.nextDates||[];
  for(const iso of dates){const t=Date.parse(iso);if(Number.isFinite(t)&&t>=now-86400000){const days=(t-now)/86400000;if(!earnings||days<earnings.days)earnings={iso,days};}}
  const rev=(c.revisions||[]).find(x=>x.period==='0q')||(c.revisions||[])[0]||null;
  let revLabel='Unavailable',revDelta=null;
  if(rev&&finite(rev.epsTrendCurrent)&&finite(rev.epsTrend30dAgo)&&Number(rev.epsTrend30dAgo)!==0){revDelta=Number(rev.epsTrendCurrent)/Number(rev.epsTrend30dAgo)-1;revLabel=revDelta>0.02?'RISING':revDelta<-0.02?'FALLING':'STABLE';}
  return{earnings,rev,revLabel,revDelta,fund:c.fundamentals||null,status:c.status||'UNAVAILABLE',policy:c.backtest_policy||''};
}

function tfRows(engine){
  const rows=[];const packs=[['Daily',engine.daily],['Weekly',engine.weekly],['Monthly',engine.monthly]];
  for(const [name,p] of packs){const k=p.bars.length-1,close=p.c[k];for(const period of PERIODS)rows.push({timeframe:name,period,close,sma:p.ma[period][k],ema:p.em[period][k]});}
  return rows;
}

function renderMatrix(rows){
  const by={Daily:[],Weekly:[],Monthly:[]};for(const r of rows)by[r.timeframe].push(r);
  return Object.entries(by).map(([tf,a])=>`<div class="tfbox"><h3>${tf}</h3><table><thead><tr><th>Period</th><th>SMA</th><th>EMA</th><th>Price vs both</th></tr></thead><tbody>${a.map(r=>{
    const okS=finite(r.sma),okE=finite(r.ema),bull=okS&&okE&&r.close>r.sma&&r.close>r.ema,bear=okS&&okE&&r.close<r.sma&&r.close<r.ema;
    return `<tr><td>${r.period}</td><td>${fmt(r.sma)}</td><td>${fmt(r.ema)}</td><td class="${bull?'pos':bear?'neg':''}">${!okS||!okE?'Insufficient history':bull?'Above':bear?'Below':'Mixed'}</td></tr>`;}).join('')}</tbody></table></div>`).join('');
}

function renderFundamentals(ctx){
  const f=ctx.fund;if(!f)return '<p class="muted">Fundamental snapshot unavailable from the current provider.</p>';
  const items=[['Market cap',f.marketCap,0],['Forward P/E',f.forwardPE,2],['Price / book',f.priceToBook,2],['Revenue growth',f.revenueGrowth,'pct'],['Earnings growth',f.earningsGrowth,'pct'],['Operating margin',f.operatingMargins,'pct'],['ROE',f.returnOnEquity,'pct'],['Free cash flow',f.freeCashflow,0],['Total debt',f.totalDebt,0],['Debt / equity',f.debtToEquity,1]];
  return `<div class="mini-grid">${items.map(([k,v,d])=>`<div class="mini"><span>${k}</span><b>${d==='pct'?pct(v):fmt(v,d)}</b></div>`).join('')}</div><p class="warning">Current snapshot only. Excluded from the historical win-rate calculation until filing-date point-in-time history is available.</p>`;
}

function renderBacktest(label,m){
  if(!m||!finite(m.hitRate))return `<div class="modelcard"><h3>${label}</h3><p class="muted">${esc(m?.reason||'Insufficient history')}</p></div>`;
  const cls=m.verified?'good':'warn';
  return `<div class="modelcard"><div class="modeltop"><h3>${label}</h3><span class="pill ${cls}">${m.verified?'VERIFIED EDGE':'NO VERIFIED EDGE'}</span></div>
    <div class="model-grid"><div><span>Current P(up)</span><b>${pct(m.probUp)}</b></div><div><span>Current thesis</span><b>${m.current}</b></div><div><span>OOS hit rate</span><b>${pct(m.hitRate)}</b></div><div><span>Balanced accuracy</span><b>${pct(m.balancedAccuracy)}</b></div><div><span>Naive baseline</span><b>${pct(m.baselineAccuracy)}</b></div><div><span>Edge vs baseline</span><b>${pct(m.edge)}</b></div><div><span>Brier skill</span><b>${pct(m.brierSkill)}</b></div><div><span>Coverage</span><b>${pct(m.coverage)}</b></div><div><span>Calls / OOS</span><b>${m.calls} / ${m.oosRows}</b></div><div><span>95% hit-rate lower bound</span><b>${pct(m.wilsonLower)}</b></div></div>
    <p class="muted">Five expanding walk-forward splits with a horizon gap. Probability is logistic-calibrated using prior data only. Threshold ${pct(m.threshold)}; abstention is allowed.</p></div>`;
}

function drawChart(bars){
  const cv=$('#chart'),ctx=cv.getContext('2d'),dpr=window.devicePixelRatio||1,w=cv.clientWidth||900,h=260;cv.width=w*dpr;cv.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
  const a=bars.slice(-260),vals=a.map(b=>b.close),mn=Math.min(...vals),mx=Math.max(...vals),pad=16;
  ctx.strokeStyle='#2d4157';ctx.lineWidth=1;for(let k=1;k<4;k++){const y=pad+(h-2*pad)*k/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke();}
  ctx.strokeStyle='#78aefc';ctx.lineWidth=2;ctx.beginPath();a.forEach((b,i)=>{const x=pad+(w-2*pad)*i/Math.max(1,a.length-1),y=h-pad-(b.close-mn)/(mx-mn||1)*(h-2*pad);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
}

async function analyze(rawSymbol){
  const symbol=String(rawSymbol||$('#ticker').value||'').trim().toUpperCase();if(!symbol)return;
  $('#ticker').value=symbol;$('#status').textContent=`Loading ${symbol} and SPY…`;$('#app').classList.add('hidden');
  try{
    const [data,spy]=await Promise.all([getStock(symbol),getStock('SPY')]);
    const bars=data.candles?.bars||[],spyBars=spy.candles?.bars||[];if(bars.length<120||spyBars.length<120)throw new Error('Not enough closed daily history.');
    $('#status').textContent=`${symbol}: ${bars.length.toLocaleString()} adjusted closed daily bars · ${data.data_quality?.first_bar_date||''} to ${data.data_quality?.last_closed_bar_date||''}`;
    const engine=buildFeatureEngine(bars,spyBars),m5=walkForward(engine,5),m21=walkForward(engine,21),ctx=currentContext(data),i=bars.length-1,d=engine.detail[i];
    const price=data.quote?.current||bars[i].close,change=data.quote?.change_pct;
    $('#title').textContent=`${data.context?.profile?.name||symbol} (${symbol})`;
    $('#price').textContent=`${data.quote?.currency||''} ${fmt(price)}`.trim();$('#change').textContent=finite(change)?`${Number(change)>=0?'+':''}${fmt(change,2)}% vs previous close`:'Latest quote';$('#change').className=finite(change)&&Number(change)>=0?'pos':finite(change)?'neg':'';
    const primary=m21.verified?m21:m5;$('#thesis').textContent=primary.current||'NO VERIFIED EDGE';$('#thesis').className=primary.verified?(primary.current==='UP BIAS'?'pos':primary.current==='DOWN BIAS'?'neg':''):'neutral';
    $('#prob').textContent=pct(primary.probUp);$('#score').textContent=finite(engine.score[i])?fmt(engine.score[i],2):'—';
    $('#tfsummary').textContent=`D ${fmt(d?.daily,2)} · W ${fmt(d?.weekly,2)} · M ${fmt(d?.monthly,2)}`;
    $('#relative').textContent=finite(d?.rs63)?pct(d.rs63):'—';$('#rsi').textContent=finite(d?.rsi)?fmt(d.rsi,1):'—';
    $('#models').innerHTML=renderBacktest('5-session model',m5)+renderBacktest('21-session model',m21);
    $('#matrix').innerHTML=renderMatrix(tfRows(engine));
    let ehtml='<p class="muted">No upcoming earnings date returned by the provider.</p>';
    if(ctx.earnings){const days=ctx.earnings.days;ehtml=`<div class="event ${days<=7?'risk':''}"><b>${new Date(ctx.earnings.iso).toLocaleDateString()}</b><span>${days>=0?`${Math.ceil(days)} days away`:'recent'}</span></div>${days<=7?'<p class="warning">Event-risk flag: earnings are close. The technical probability is not adjusted because historical earnings-calendar features are not yet in the walk-forward backtest.</p>':''}`;}
    $('#earnings').innerHTML=ehtml;
    $('#revisions').innerHTML=`<div class="revision"><b class="${ctx.revLabel==='RISING'?'pos':ctx.revLabel==='FALLING'?'neg':''}">${ctx.revLabel}</b><span>30-day EPS estimate change: ${pct(ctx.revDelta)}</span></div><p class="warning">Current analyst-revision snapshot only; excluded from historical win rate until historical point-in-time revision data is available.</p>`;
    $('#fundamentals').innerHTML=renderFundamentals(ctx);
    $('#truth').innerHTML=`<b>Actually backtested:</b> adjusted closed-bar price history, daily/weekly/monthly MA & EMA structure, momentum, volatility, volume, SPY regime and SPY-relative strength. Historical period mapping never uses a weekly/monthly period-end later than the signal date. <b>Not yet counted in win rate:</b> today’s earnings date, current fundamentals and current analyst revisions. Those remain context only so current information cannot leak into old predictions.`;
    drawChart(bars);$('#app').classList.remove('hidden');
  }catch(e){$('#status').innerHTML=`<span class="neg">${esc(e.message||e)}</span>`;}
}

document.addEventListener('DOMContentLoaded',()=>{
  $('#go').addEventListener('click',()=>analyze());$('#ticker').addEventListener('keydown',e=>{if(e.key==='Enter')analyze();});
  document.querySelectorAll('[data-ticker]').forEach(b=>b.addEventListener('click',()=>analyze(b.dataset.ticker)));
  analyze('AAPL');
});
