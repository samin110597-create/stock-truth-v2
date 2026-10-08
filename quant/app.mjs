import {createChart,CandlestickSeries,HistogramSeries,LineSeries,createSeriesMarkers} from '../vendor/lightweight-charts.mjs';
import {loadMarketData,detectAsset,currentQuote} from './src/data.mjs';
import {quoteFreshness,freshestQuote} from './src/freshness.mjs';
import {quoteGate,freshnessGate,gateAnalysis} from './src/freshness-guard.mjs';
import {analyzeQuant} from './src/engine.mjs';
import {recordIssuedForecast,settleForCurrentSeries,accuracySnapshot} from './src/accuracy.mjs';

const $=s=>document.querySelector(s),finite=Number.isFinite;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>finite(x)?'$'+x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const num=(x,n=2)=>finite(x)?x.toFixed(n):'—';
const pct=x=>finite(x)?(x*100).toFixed(1)+'%':'—';
let chart=null,controller=null,requestId=0,activeSymbol=null,activeQuote=null,quoteTimer=null,quoteRequest=0,quoteController=null,activeAnalysis=null,lastGateAllowed=null,expiryTimer=null;
const eastern=x=>!x?'Unavailable':new Date(typeof x==='number'?x*1000:x).toLocaleString('en-US',{timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'});

function klass(dir){return dir==='BULLISH'||dir==='LONG'?'up':dir==='BEARISH'||dir==='SHORT'?'down':'amber';}
function cell(label,value,k=''){return `<div><div class="label">${esc(label)}</div><div class="value ${k}">${value}</div></div>`;}
function kv(label,value,k=''){return `<div class="kv"><span>${esc(label)}</span><span class="${k}">${value}</span></div>`;}
function pathCard(p,k=''){if(!p)return'';return `<div class="path"><b class="${k}">${esc(p.label)}</b><div class="path-row"><span>5 bars</span><strong>${money(p.bar5)}</strong></div><div class="path-row"><span>10 bars</span><strong>${money(p.bar10)}</strong></div><div class="path-row"><span>20 bars</span><strong>${money(p.bar20)}</strong></div></div>`;}
function stateCard(label,value,detail='',score=null){return `<div class="state-card"><div class="label">${esc(label)}</div><div class="value">${value}</div>${detail?`<div class="micro">${esc(detail)}</div>`:''}${finite(score)?`<div class="bar"><i style="width:${Math.max(0,Math.min(100,score))}%"></i></div>`:''}</div>`;}
function flattenResearch(obj,prefix='',depth=0,out=[]){
  if(!obj||typeof obj!=='object'||depth>2||out.length>=18)return out;
  for(const [k,v] of Object.entries(obj)){
    if(out.length>=18)break;
    const label=prefix?prefix+' · '+k:k;
    if(v==null)continue;
    if(typeof v==='number'&&finite(v))out.push([label,Math.abs(v)>=1000?v.toLocaleString():num(v,3)]);
    else if(typeof v==='string'&&v.length<=80&&!/^https?:/i.test(v))out.push([label,v]);
    else if(typeof v==='object'&&!Array.isArray(v))flattenResearch(v,label,depth+1,out);
  }
  return out;
}

function metric(v,kind='pct'){
  if(!finite(v))return '—';
  if(kind==='num')return num(v,4);
  return pct(v);
}
function renderAccuracy(a){
  const host=$('#accuracy');if(!host)return;
  if(!a){host.innerHTML='<div class="micro">Forward accuracy ledger unavailable in this browser.</div>';return;}
  const primary={'15M':20,'1H':10,'4H':5,'1D':10};
  const cards=['15M','1H','4H','1D'].map(tf=>{
    const h=primary[tf],m=a.timeframes?.[tf]?.[h]||{};
    return `<div class="accuracy-card"><div class="label">${tf} · PRIMARY ${h} BARS</div><div class="accuracy-main">${metric(m.directionalAccuracy)}</div><div class="micro">direction · n=${m.directionN||0}</div><div class="accuracy-line"><span>Brier</span><strong>${metric(m.brier,'num')}</strong></div><div class="accuracy-line"><span>Calibration gap</span><strong>${metric(m.calibrationGap)}</strong></div><div class="accuracy-line"><span>Avg MAE</span><strong>${metric(m.avgMaePct)}</strong></div><div class="accuracy-line"><span>TP1 before stop</span><strong>${metric(m.tp1HitRate)}</strong></div></div>`;
  }).join('');
  const rows=[];
  for(const tf of ['15M','1H','4H','1D'])for(const h of [5,10,20]){
    const m=a.timeframes?.[tf]?.[h]||{};
    rows.push(`<tr><td>${tf}</td><td>${h}</td><td>${m.directionN||0}</td><td>${metric(m.directionalAccuracy)}</td><td>${m.brierN||0}</td><td>${metric(m.brier,'num')}</td><td>${metric(m.avgMaePct)}</td><td>${metric(m.avgProjectionAbsErrorPct)}</td><td>${metric(m.tp1HitRate)}</td><td>${metric(m.stopBeforeTp1Rate)}</td><td>${metric(m.falseBreakoutRate)}</td></tr>`);
  }
  const regimes=Object.entries(a.regimes||{}).filter(([,v])=>(v?.n||0)>0).sort((x,y)=>(y[1].n||0)-(x[1].n||0)).slice(0,8);
  host.innerHTML=`<div class="accuracy-top"><div><b>FORWARD LEDGER</b><div class="micro">Issued forecasts are immutable. Outcome observations are appended later from completed bars.</div></div><div class="accuracy-counts"><span>${a.forecastCount||0} issued</span><span>${a.resolvedForecasts||0} observed</span><span>${a.pending||0} pending</span><button id="refresh-accuracy" type="button">UPDATE OPEN OUTCOMES</button></div></div><div class="accuracy-grid">${cards}</div><div class="table-scroll"><table class="forecast-table accuracy-table"><thead><tr><th>TF</th><th>Bars</th><th>Dir n</th><th>Direction</th><th>Brier n</th><th>Brier</th><th>MAE</th><th>Median error</th><th>TP1 hit</th><th>Stop first</th><th>False BO</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>${regimes.length?`<div class="regime-grid">${regimes.map(([name,m])=>`<div class="e-item"><b>${esc(name)}</b>10-bar n=${m.n||0} · direction ${metric(m.directionalAccuracy)} · MAE ${metric(m.avgMaePct)}</div>`).join('')}</div>`:''}<div class="micro">Brier/calibration score only the model's exact validated label: whether +1 ATR is reached before −1 ATR within the model horizon. Same-bar double touches and unresolved paths are excluded. Trade collisions are conservative: if stop and target are both touched in one bar, stop wins. This forward ledger is stored in this browser and does not rewrite issued forecasts.</div>`;const btn=$('#refresh-accuracy');if(btn)btn.onclick=()=>refreshOpenAccuracy(a);
}

function futureTimes(q){
  const n=20,last=q.bars.at(-1);
  if(q.timeframe==='1D'){
    const out=[],d=new Date(last.date+'T00:00:00Z');
    while(out.length<n){d.setUTCDate(d.getUTCDate()+1);const wd=d.getUTCDay();if(wd!==0&&wd!==6)out.push(d.toISOString().slice(0,10));}
    return out;
  }
  const step={'15M':900,'1H':3600,'4H':14400}[q.timeframe]||86400,out=[];let t=last.ts;
  for(let i=0;i<n;i++){t+=step;out.push(t);}return out;
}
function drawProjection(q){
  const times=futureTimes(q),lastTime=q.timeframe==='1D'?q.bars.at(-1).date:q.bars.at(-1).ts,lastPrice=q.bars.at(-1).close,pr=q.forecast.projection;
  if(pr?.source==='WALK_FORWARD_OOS_CONDITIONAL_RETURNS'){
    const sets=[
      {name:'primary',color:'#49d7e6',width:2,lineStyle:0},
      {name:'pullback',color:'#7f93a3',width:1,lineStyle:2},
      {name:'expansion',color:'#b794f4',width:1,lineStyle:2}
    ];
    for(const s of sets){const p=pr[s.name];if(!p)continue;const line=chart.addSeries(LineSeries,{color:s.color,lineWidth:s.width,lineStyle:s.lineStyle,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});line.setData([{time:lastTime,value:lastPrice},{time:times[4],value:p.bar5},{time:times[9],value:p.bar10},{time:times[19],value:p.bar20}].filter(x=>finite(x.value)));}
    return;
  }
  if(pr){
    const sets=[{name:'primary',color:'#49d7e6',width:2,lineStyle:0},{name:'pullback',color:'#7f93a3',width:1,lineStyle:2},{name:'expansion',color:'#b794f4',width:1,lineStyle:2}];
    for(const s of sets){const p=pr[s.name];if(!p)continue;const line=chart.addSeries(LineSeries,{color:s.color,lineWidth:s.width,lineStyle:s.lineStyle,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});line.setData([{time:lastTime,value:lastPrice},{time:times[4],value:p.bar5},{time:times[9],value:p.bar10},{time:times[19],value:p.bar20}].filter(x=>finite(x.value)));}
    return;
  }
}
function renderChart(q){
  if(chart)chart.remove();const host=$('#chart');host.innerHTML='';
  chart=createChart(host,{autoSize:true,layout:{background:{color:'#0d141c'},textColor:'#7f93a3',attributionLogo:true},grid:{vertLines:{color:'#13212c'},horzLines:{color:'#13212c'}},rightPriceScale:{borderColor:'#20303e'},timeScale:{borderColor:'#20303e',timeVisible:q.timeframe!=='1D',rightOffset:22}});
  const time=b=>q.timeframe==='1D'?b.date:b.ts,c=chart.addSeries(CandlestickSeries,{upColor:'#53d18a',downColor:'#ff6f76',borderVisible:false,wickUpColor:'#53d18a',wickDownColor:'#ff6f76'});
  c.setData(q.bars.map(b=>({time:time(b),open:b.open,high:b.high,low:b.low,close:b.close})));
  const v=chart.addSeries(HistogramSeries,{priceScaleId:'vol',priceFormat:{type:'volume'}});v.priceScale().applyOptions({scaleMargins:{top:.87,bottom:0}});v.setData(q.bars.filter(b=>finite(b.volume)).map(b=>({time:time(b),value:b.volume,color:b.close>=b.open?'#214b39':'#552b31'})));
  const priceLine=(p,title,color)=>{if(finite(p))c.createPriceLine({price:p,title,color,lineStyle:2,lineWidth:1,axisLabelVisible:true});};
  if(q.plan){priceLine(q.plan.entryZone.low,'ENTRY LOW','#e6b85a');priceLine(q.plan.entryZone.high,'ENTRY HIGH','#e6b85a');priceLine(q.plan.trigger,q.plan.direction==='LONG'?'BREAKOUT':'BREAKDOWN','#b794f4');priceLine(q.plan.stop,'STOP','#ff6f76');q.plan.targets.forEach((t,i)=>priceLine(t.price,t.name,['#49d7e6','#53d18a','#9ddfbd'][i]||'#49d7e6'));}
  const marks=[];
  for(const e of q.structure.events.slice(-18)){const b=q.bars[e.i];if(!b)continue;marks.push({time:time(b),position:e.dir>0?'belowBar':'aboveBar',shape:e.dir>0?'arrowUp':'arrowDown',color:e.type==='LIQUIDITY SWEEP'?'#e6b85a':e.dir>0?'#53d18a':'#ff6f76',text:e.type,size:.45});}
  if(q.structure.divergence){const d=q.structure.divergence,b=q.bars[d.i];if(b)marks.push({time:time(b),position:d.dir>0?'belowBar':'aboveBar',shape:d.dir>0?'arrowUp':'arrowDown',color:'#b794f4',text:'RSI DIV',size:.55});}
  marks.sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0);createSeriesMarkers(c,marks);drawProjection(q);
  chart.timeScale().setVisibleLogicalRange({from:Math.max(0,q.bars.length-150),to:q.bars.length+22});
  $('#chart-note').textContent=`${q.sourceSymbol} · ${q.timeframe} · ${q.bars.length.toLocaleString()} completed bars · projection source: ${q.forecast.source||'unavailable'}`;
}
function trainedDistributionRows(q){
  const last=q.bars.at(-1).close,hs=q.trained?.horizons||{};
  const rows=[];for(const h of ['5','10','20']){const x=hs[h],b=x?.returnBand;if(!x?.validated||!b)continue;rows.push({step:+h,p10:last*Math.exp(b.q10),p25:last*Math.exp(b.q25),median:last*Math.exp(b.q50),p75:last*Math.exp(b.q75),p90:last*Math.exp(b.q90),n:b.n});}
  return rows;
}
function render(q){
  const k=klass(q.state.direction),p=q.plan,pr=q.forecast.projection,h=q.forecast.historical,m=q.math,s=q.structure,ctx=q.apiContext||null,research=q.research||{},fund=research.fundamentals||{},macro=research.macro||{},primaryH=String(q.state.calibratedProbabilityHorizon||({'15M':20,'1H':10,'4H':5,'1D':10}[q.timeframe]||10)),hPrimary=q.trained?.horizons?.[primaryH]||null,lastBar=q.bars?.at(-1);
  const providers=ctx?.providers||{},providerRows=Object.values(providers),providerOK=providerRows.filter(x=>x?.status==='OK').length,providerTotal=providerRows.length;
  const fred=providers.fred?.series||{},researchFred=macro.series||{},macroSeries=Object.keys(fred).length?fred:researchFred,macroText=[macroSeries.DGS10?.value!=null?'10Y '+macroSeries.DGS10.value+'%':null,macroSeries.DFII10?.value!=null?'Real 10Y '+macroSeries.DFII10.value+'%':null,macroSeries.T10YIE?.value!=null?'BE inflation '+macroSeries.T10YIE.value+'%':null,macroSeries.DTWEXBGS?.value!=null?'USD index '+macroSeries.DTWEXBGS.value:null].filter(Boolean).join(' · ');
  const probText=q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?pct(q.state.calibratedProbabilityDirection):'WITHHELD',probLabel=primaryH+'-BAR P(SETUP DIR FIRST)';
  $('#decision').innerHTML=`<div>${cell('MODEL ACTION',esc(q.state.action),k)}<div class="micro">${esc(p?.detail||'No trade until the model develops an edge.')}</div></div>${cell('DIRECTION',esc(q.state.direction),k)}${cell(probLabel,probText,q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?k:'amber')}${cell('REGIME',esc(q.state.regime))}${cell('QUALITY',esc(q.state.quality),q.state.quality==='A'?'up':'amber')}`;
  $('#source').textContent=(q.runtimeApiConfigured?'':'BACKEND OFF · ')+q.provider;
  $('#trade').innerHTML=`<h2>EXECUTION MAP</h2><div class="trade-action ${k}">${esc(q.state.action)}</div>${p?kv('Bias',p.direction,k)+kv(primaryH+'-bar calibrated P(setup dir first)',probText,q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?k:'amber')+kv('Preferred entry',money(p.entryZone.low)+' – '+money(p.entryZone.high),'amber')+kv(p.direction==='LONG'?'Breakout trigger':'Breakdown trigger',money(p.trigger),'cyan')+kv('Fixed invalidation',money(p.stop),'down')+p.targets.map(t=>kv(t.name,money(t.price)+' · '+(finite(t.riskReward)?num(t.riskReward)+'R':'—')+' · '+esc(t.source),'up')).join('')+kv('Nearest target R:R',finite(p.rr)?num(p.rr)+'R':'—')+`<div class="rule"><b>Entry condition:</b> ${esc(p.entryRule)}<br><br><b>Failure:</b> ${esc(p.invalidation)}</div>`:'<div class="rule">No actionable execution map while the model is neutral.</div>'}`;
  $('#projections').innerHTML=`<div class="panel-head"><span>PROJECTED PRICE PATHS</span><span>${esc(pr?.source||'NO MODEL PATH')}</span></div>${pr?`<div class="projection-grid">${pathCard(pr.primary,k)}${pathCard(pr.pullback,'amber')}${pathCard(pr.expansion,k)}<div class="path"><b class="down">THESIS FAILURE</b><div class="path-row"><span>Invalidation</span><strong>${money(pr.failure.price)}</strong></div><div class="micro">If invalidation breaks on a completed bar, the current directional thesis is no longer valid.</div></div></div><div class="micro">10-bar central range: ${money(pr.range10?.low)} – ${money(pr.range10?.high)} · 20-bar central range: ${money(pr.range20?.low)} – ${money(pr.range20?.high)}. Walk-forward conditional ranges are used only when the probability model passed promotion.</div>`:'<div class="micro">No directional projection in a neutral state.</div>'}`;
  const mtfDetail=q.mtf?.rows?.map(x=>x.timeframe+' '+(x.bias>0?'↑':x.bias<0?'↓':'—')).join(' · ')||'No multi-timeframe snapshot';
  const skill=hPrimary?.metrics?.brier_skill,hold=hPrimary?.metrics?.untouched_holdout||null;
  $('#state-grid').innerHTML=
    stateCard('Model conviction',q.state.conviction+'/100',q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?'trained model dominates fixed heuristic':'rule-based because probability model is withheld',q.state.conviction)+
    stateCard('MTF alignment',finite(q.mtf?.alignmentWithTrade)?num(q.mtf.alignmentWithTrade,2):'—',mtfDetail,finite(q.mtf?.alignmentWithTrade)?(q.mtf.alignmentWithTrade+1)*50:null)+
    stateCard('OOS Brier skill',finite(skill)?pct(skill):'WITHHELD',hPrimary?.validated?`${hPrimary.oosSamples||0} walk-forward OOS observations`:esc(hPrimary?.status||'No trained model'),finite(skill)?Math.max(0,Math.min(100,skill*1000)):null)+
    stateCard('Untouched holdout',hold?.passed?'PASS':hold?'FAIL / WITHHOLD':'—',hold?`n=${hold.n||0} · Brier skill ${finite(hold.brier_skill)?pct(hold.brier_skill):'—'} · log loss ${num(hold.log_loss,4)} vs ${num(hold.base_log_loss,4)}`:'Final holdout evidence unavailable',hold?.passed?100:hold?0:null)+
    stateCard('Latent velocity',num(m.velocity),'state-filtered price velocity',Math.min(100,Math.abs(m.velocity)*35))+
    stateCard('Latent acceleration',num(m.acceleration),'change in filtered velocity',Math.min(100,Math.abs(m.acceleration)*40))+
    stateCard('Entropy',num(m.entropy,3),finite(m.entropy)&&m.entropy>.9?'chaotic / lower confidence':'organized / usable',finite(m.entropy)?(1-m.entropy)*100:null)+
    stateCard('Hurst',num(m.hurst,3),finite(m.hurst)?(m.hurst>.55?'persistent trend regime':m.hurst<.45?'mean-reverting tendency':'near random walk'):'insufficient')+
    stateCard('Dominant cycle',m.dominantCycle?m.dominantCycle.period+' bars':'—',m.dominantCycle?'phase '+num(m.dominantCycle.phase*180/Math.PI,0)+'°':'')+
    stateCard('Realized vol',pct(m.realizedVol),'annualized recent log-return volatility')+
    stateCard('Compression',num(m.compression,2),finite(m.compression)&&m.compression<.72?'compressed / expansion risk':'normal or expanded')+
    stateCard('Volume anomaly',num(m.volumeZ,2)+'σ',m.bullAbsorption?'bullish absorption proxy':m.bearAbsorption?'bearish absorption proxy':'no strong absorption proxy')+
    stateCard('Scheduled API checks',providerTotal?providerOK+'/'+providerTotal+' OK':'—',ctx?.spy_cross_source?.status?('SPY cross-check '+ctx.spy_cross_source.status+(finite(ctx.spy_cross_source.dispersion_pct)?' · '+num(ctx.spy_cross_source.dispersion_pct,3)+'% dispersion':'')):'No secured context manifest yet',providerTotal?providerOK/providerTotal*100:null)+
    stateCard('Data freshness',esc(q.dataStatus||'COMPLETED BAR'),lastBar?('last completed '+(lastBar.date||new Date((lastBar.end_ts||0)*1000).toISOString())):'no completed bar');
  const trainedRows=trainedDistributionRows(q),rows=trainedRows.length?trainedRows:q.forecast.monteCarlo.filter(x=>[1,5,10,20].includes(x.step));
  $('#distribution').innerHTML=rows.length?`<table class="forecast-table"><thead><tr><th>Bars</th><th>P10</th><th>P25</th><th>Median</th><th>P75</th><th>P90</th><th>OOS n</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.step}</td><td>${money(x.p10)}</td><td>${money(x.p25)}</td><td>${money(x.median)}</td><td>${money(x.p75)}</td><td>${money(x.p90)}</td><td>${x.n||'simulation'}</td></tr>`).join('')}</tbody></table><div class="micro">${trainedRows.length?'Distribution is conditioned on walk-forward out-of-sample prediction bins.':'No promoted return model for all horizons; showing simulation fallback.'}</div>`:'<div class="micro">Forecast unavailable.</div>';
  const recent=s.events.slice(-5).reverse();
  const trainedEvidence=hPrimary?`${primaryH}-bar ${hPrimary.validated?'PROMOTED':'WITHHELD'} · OOS ${hPrimary.oosSamples||0} · Brier ${num(hPrimary.metrics?.brier,4)} vs base ${num(hPrimary.metrics?.base_brier,4)} · skill ${finite(skill)?pct(skill):'—'} · folds ${hPrimary.metrics?.positive_folds??'—'}/${hPrimary.metrics?.required_positive_folds??'—'} positive · log loss ${num(hPrimary.metrics?.log_loss,4)} vs base ${num(hPrimary.metrics?.base_log_loss,4)} · untouched holdout ${hold?.passed?'PASS':hold?'FAIL':'—'}`:'No Q-State trained model artifact available.';
  $('#evidence').innerHTML=`<div class="evidence-list"><div class="e-item"><b>WALK-FORWARD MODEL</b>${esc(trainedEvidence)}</div><div class="e-item"><b>MULTI-TIMEFRAME</b>${esc(mtfDetail)} · alignment with current trade ${finite(q.mtf?.alignmentWithTrade)?num(q.mtf.alignmentWithTrade,2):'—'}</div><div class="e-item"><b>STRUCTURE</b>${esc(s.pattern)} · ${esc(s.method)} · directional state ${s.direction>0?'up':s.direction<0?'down':'neutral'}</div><div class="e-item"><b>DIVERGENCE</b>${esc(s.divergence?.type||'No confirmed RSI pivot divergence')}</div><div class="e-item"><b>RECENT SWEEP</b>${esc(s.recentSweep?s.recentSweep.dir>0?'Bullish downside liquidity sweep':'Bearish upside liquidity sweep':'None in the recent window')}</div><div class="e-item"><b>RECENT STRUCTURE EVENTS</b>${recent.length?recent.map(e=>esc(e.type)+' @ '+money(e.level)+' · scale '+(e.scale||'—')).join(' · '):'None'}</div><div class="e-item"><b>RULE-BASED HISTORICAL CONTEXT</b>${h.n?`${(h.rate*100).toFixed(1)}% of ${h.n} simplified same-direction historical states were positive after ${h.horizon} bars; 95% interval ${pct(h.interval.low)}–${pct(h.interval.high)}.`:'Insufficient comparable sample.'}</div><div class="e-item"><b>FUNDAMENTAL RESEARCH</b>${esc(fund.status||'UNAVAILABLE')} · ${esc(fund.provider||'No fundamentals response')} · ${Object.keys(fund.data||{}).length} sourced blocks. Present-day fundamentals are descriptive until historical OOS ablation proves incremental forecast value.</div><div class="e-item"><b>MACRO CONTEXT · FRED</b>${esc(macroText||providers.fred?.reason||macro.reason||'No sanitized FRED context yet.')} · model weight: 0 until validated.</div></div>`;
  const summary=fund.data?.summary||{};const fundamentalRows=[...flattenResearch(summary.valuation||summary.metrics||{},'Valuation'),...flattenResearch(summary.profitability||{},'Profitability'),...flattenResearch(summary.financialHealth||{},'Financial health')].slice(0,24);
  const macroRows=Object.entries(macroSeries).filter(([,v])=>v?.value!=null).map(([sid,v])=>[v.label||sid,String(v.value)+(sid==='DGS10'||sid==='DFII10'||sid==='T10YIE'?'%':'')]);
  $('#research').innerHTML=`<div class="evidence-list"><div class="e-item"><b>FUNDAMENTALS · ${esc(fund.status||'UNAVAILABLE')}</b><div class="micro">Source updated: ${eastern(summary.asOf?.dataUpdatedAt)} · Retrieved: ${eastern(q.research?.fetched_at)} · ${esc(fund.provider||'Unavailable')}</div>${fundamentalRows.length?fundamentalRows.map(([a,b])=>`${esc(a)}: <strong>${esc(b)}</strong>`).join(' · '):esc(fund.errors?.join(' · ')||fund.reason||'No sourced summary fields available.')}</div><div class="e-item"><b>MACRO · ${esc(macro.status||providers.fred?.status||'UNAVAILABLE')}</b>${macroRows.length?macroRows.map(([a,b])=>`${esc(a)}: <strong>${esc(b)}</strong>`).join(' · '):esc(macro.reason||providers.fred?.reason||'No sourced macro values available.')}</div><div class="e-item"><b>MODEL USE</b>Research inputs are visible here, but their production forecast weight is 0% until synchronized historical features pass leakage-controlled OOS ablation and the winning method is incorporated into the one Q-State artifact.</div></div>`;
  const apiLines=providerRows.length?Object.entries(providers).map(([name,v])=>kv('API '+name.toUpperCase(),esc(v?.status||'UNKNOWN')+(v?.reason?' · '+esc(v.reason):''),v?.status==='OK'?'up':'amber')).join(''):kv('API context','No context manifest yet','amber');
  $('#integrity').innerHTML=kv('Engine',esc(q.model))+kv('Trained artifact',esc(q.trained?.modelVersion||'Unavailable'))+kv('Trained artifact generated',q.trained?.generatedAt?eastern(q.trained.generatedAt):'—')+kv('Probability policy',esc(q.state.probabilityStatus))+kv('Probability definition',esc(q.trained?.labelDefinition||'Withheld/unavailable'))+kv('Projection source',esc(q.forecast.source||'—'))+kv('Requested',esc(q.symbol))+kv('Source symbol',esc(q.sourceSymbol))+kv('Bars',q.bars.length.toLocaleString())+kv('Secure gateway configured',q.runtimeApiConfigured?'YES · availability checked per request':'NO · independent public retrieval enabled',q.runtimeApiConfigured?'up':'amber')+kv('Data route',q.onDemand?'SECURE ON-DEMAND API':q.runtimeApiConfigured?'INDEPENDENT FALLBACK':'DIRECT PUBLIC / SAVED FALLBACK',q.onDemand?'up':'amber')+kv('Primary bar provider',esc(q.provider))+kv('Cross-source check',q.crossValidation?esc(q.crossValidation.status)+(finite(q.crossValidation.dispersionPct)?' · '+num(q.crossValidation.dispersionPct,3)+'% dispersion':''):'—')+kv('Fundamentals',esc(fund.status||'UNAVAILABLE')+' · '+esc(fund.provider||'Independent fundamentals source'))+kv('Macro research',esc(macro.status||'UNAVAILABLE')+' · '+esc(macro.provider||'FRED'))+kv('Research weighting','0% until synchronized OOS validation','amber')+kv('Fetched',q.fetchedAt?eastern(q.fetchedAt):'—')+kv('Data status',esc(q.dataStatus||'—'))+kv('Last completed bar',q.lastCompletedBar?eastern(q.lastCompletedBar):(lastBar?.date||'—'))+kv('Credential handling',esc(q.credentialPolicy||'No browser credential'))+apiLines+(q.providerTrace?.length?kv('On-demand provider trace',q.providerTrace.map(x=>esc(x.source)+': '+esc(x.status)).join(' · ')):'')+`<div class="micro">${esc(ctx?.purpose||'API context is informational and does not silently change the trade score.')} ${esc(q.caveats.join(' '))}</div>`;
  const quote=q.quote,bar=q.bars.at(-1);
  $('#integrity').insertAdjacentHTML('afterbegin',kv('Quote source',esc(quote?.provider||'Unavailable'))+kv('Quote market time',eastern(quote?.as_of))+kv('Quote retrieved',eastern(quote?.fetched_at))+kv('Output calculated',eastern(q.calculatedAt)));
  let note=$('#data-asof');if(!note){note=document.createElement('div');note.id='data-asof';note.className='micro';$('#status').insertAdjacentElement('afterend',note);}
  note.innerHTML=`<b>DATA USED · EASTERN TIME</b><br>Quote used at calculation: ${money(quote?.price)} · ${eastern(quote?.as_of)} · ${esc(quote?.provider||'QUOTE UNAVAILABLE')}<br>${esc(q.timeframe)} technicals / structure / forecast use completed ${q.timeframe==='1D'?'session '+esc(bar?.session||bar?.date||'Unavailable'):'bar '+eastern(bar?.end_ts)} · ${esc(q.provider)}<br>History retrieved: ${eastern(q.fetchedAt)} · Output calculated: ${eastern(q.calculatedAt)}<br>Research retrieved: ${eastern(q.research?.fetched_at)} · Financial reporting dates remain separate from retrieval time.<br>${esc(quote?.delay||quote?.latency||'Quote latency unspecified by provider')}. Click ANALYZE to refresh all available data.`;
  renderChart(q);
}
async function refreshOpenAccuracy(snapshot){
  const btn=$('#refresh-accuracy');if(btn){btn.disabled=true;btn.textContent='UPDATING…';}
  try{
    const observed=new Map((snapshot?.outcomes||[]).map(x=>[x.id,x])),seen=new Set(),pending=(snapshot?.forecasts||[]).filter(x=>!observed.get(x.id)?.horizons?.[20]).sort((a,b)=>String(a.issuedAt).localeCompare(String(b.issuedAt)));
    for(const f of pending){
      const key=f.symbol+'|'+f.timeframe;if(seen.has(key))continue;seen.add(key);if(seen.size>12)break;
      try{const asset=f.asset==='FUTURE'||f.asset==='METAL_PROXY'?'FUTURE':'STOCK',data=await loadMarketData({symbol:f.symbol,asset,timeframe:f.timeframe});await settleForCurrentSeries({symbol:f.symbol,timeframe:f.timeframe,bars:data.bars});}catch{}
    }
    renderAccuracy(await accuracySnapshot());
  }finally{const b=$('#refresh-accuracy');if(b){b.disabled=false;b.textContent='UPDATE OPEN OUTCOMES';}}
}
function paintQuote(message=''){
  const f=quoteFreshness(activeQuote),gate=quoteGate(activeSymbol,activeQuote),market=activeAnalysis?freshnessGate(activeAnalysis).market:null;
  clearTimeout(expiryTimer);if(gate.allowed)expiryTimer=setTimeout(()=>{paintQuote();enforceFreshness();},Math.max(10,(activeQuote.as_of+900-Date.now()/1000)*1000+10));
  $('#quote-status').innerHTML=`<div class="label">${esc(activeSymbol||'')} · ${esc(gate.allowed?f.label:gate.status)}${market?.state==='CLOSED'?' · REGULAR MARKET CLOSED':''}</div><div class="quote-price">${gate.allowed?money(activeQuote?.price):'—'}</div><div class="micro">${!gate.allowed&&activeQuote?'Historical quote only: '+money(activeQuote.price)+' · ':''}Market time: ${eastern(activeQuote?.as_of)} · ${esc(activeQuote?.provider||'No quote source available')}<br>Retrieved: ${eastern(activeQuote?.fetched_at)}. Strict limit: quote market time must be within 15 minutes, including outside regular hours. Older quotes are historical only; provider entitlement still applies.${message?'<br>'+esc(message):''}</div>`;
}
async function refreshPrice(){
  if(!activeSymbol||detectAsset(activeSymbol,$('#asset').value)!=='STOCK')return;
  quoteController?.abort();quoteController=new AbortController();const local=++quoteRequest,symbol=activeSymbol;
  $('#refresh-quote').disabled=true;
  try{const q=await currentQuote(symbol,quoteController.signal);if(local!==quoteRequest||symbol!==activeSymbol)return;activeQuote=freshestQuote(symbol,[q,activeQuote]);paintQuote(q?'Price refreshed. Analysis remains tied to its displayed completed-bar timestamp.':'Refresh unavailable; last successful quote retained with its original time.');}
  catch(e){if(local===quoteRequest&&symbol===activeSymbol&&e.name!=='AbortError')paintQuote('Refresh failed; last successful quote retained with its original time.');}
  finally{if(local===quoteRequest)$('#refresh-quote').disabled=false;}
}
function schedulePrice(){clearInterval(quoteTimer);const interval=Number($('#quote-interval').value);if(interval)quoteTimer=setInterval(()=>{if(!document.hidden)refreshPrice();},interval);}
$('#refresh-quote').onclick=refreshPrice;$('#quote-interval').onchange=schedulePrice;
// Refresh age labels without making network requests.
setInterval(()=>{if(activeSymbol){paintQuote();enforceFreshness();}},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){paintQuote();enforceFreshness();}});
window.addEventListener('pageshow',()=>{paintQuote();enforceFreshness();});schedulePrice();
function enforceFreshness(force=false){
  if(!activeAnalysis)return;
  const q=gateAnalysis(activeAnalysis);
  if(force||q.freshness.allowed!==lastGateAllowed){lastGateAllowed=q.freshness.allowed;render(q);}
  if(!q.freshness.allowed){
    $('#decision').innerHTML=`<div>${cell('MODEL ACTION','CURRENT SETUP WITHHELD','amber')}<div class="micro">${esc(q.freshness.reasons.join(' · '))}. Click ANALYZE to retrieve fresh inputs.</div></div>`;
    $('#trade').innerHTML='<h2>CURRENT SETUP WITHHELD</h2><div class="rule">Historical chart and research remain visible. Entry, stop, targets and current forecasts require a quote within 15 minutes and current completed candles.</div>';
    $('#projections').innerHTML='<div class="micro">Current projections withheld by the freshness gate.</div>';
    $('#distribution').innerHTML='<div class="micro">Current forecast distribution withheld by the freshness gate.</div>';
    $('#chart-note').textContent=q.sourceSymbol+' · '+q.timeframe+' · HISTORICAL CONTEXT ONLY — current setup withheld';
  }
  return q;
}
async function run(){
  const symbol=$('#symbol').value.trim().toUpperCase();if(!symbol)return;
  controller?.abort();quoteController?.abort();quoteRequest++;$('#refresh-quote').disabled=false;controller=new AbortController();const signal=controller.signal,id=++requestId;
  activeAnalysis=null;lastGateAllowed=null;activeSymbol=symbol;activeQuote=null;paintQuote('Retrieving this ticker…');
  for(const key of ['decision','chart','chart-note','source','distribution','trade','projections','state-grid','evidence','research','integrity','data-asof'])if($('#'+key))$('#'+key).innerHTML='';
  if(chart){chart.remove();chart=null;}$('#status').textContent='Retrieving available data and calculating Q-State Unified…';
  const asset=detectAsset(symbol,$('#asset').value),timeframe=$('#tf').value;
  const quotePromise=asset==='STOCK'?currentQuote(symbol,signal).then(q=>{if(id===requestId){activeQuote=q;paintQuote();}return q;}).catch(()=>null):Promise.resolve(null);
  try{
    const data=await loadMarketData({symbol,asset,timeframe,signal,quotePromise});if(id!==requestId)return;
    const q=analyzeQuant({...data});q.quote=data.quote;q.calendar=data.calendar;q.research=data.research;q.calculatedAt=new Date().toISOString();q.apiContext=data.apiContext;q.dataStatus=data.dataStatus||'UNKNOWN';q.lastCompletedBar=data.lastCompletedBar||data.bars?.at(-1)?.end_ts||null;q.onDemand=!!data.onDemand;q.runtimeApiConfigured=!!data.runtimeApiConfigured;q.providerTrace=data.providerTrace||[];q.crossValidation=data.crossValidation||null;
    activeQuote=freshestQuote(symbol,[activeQuote,data.quote]);activeAnalysis=q;paintQuote(data.notice||'');const guarded=enforceFreshness(true);
    try{if(guarded?.freshness.allowed)await recordIssuedForecast(guarded);const accuracy=await settleForCurrentSeries(q);if(id===requestId)renderAccuracy(accuracy);}catch{if(id===requestId)renderAccuracy(null);}
    if(id!==requestId)return;
    $('#status').textContent=`${guarded?.freshness.allowed?(data.notice||'READY'):'CURRENT SETUP WITHHELD — '+guarded.freshness.reasons.join('; ')} · ${data.onDemand?'SECURE GATEWAY':'INDEPENDENT DATA FALLBACK'} · ${data.provider} · ${data.bars.length.toLocaleString()} completed ${data.timeframe} bars · ${q.dataStatus} · ${q.state.probabilityStatus}`;
    history.replaceState(null,'',`?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}&asset=${asset}`);
  }catch(e){if(id!==requestId||e.name==='AbortError')return;$('#status').textContent='ANALYSIS UNAVAILABLE · '+e.message;$('#decision').innerHTML=`<div>${cell('MODEL ACTION','DATA UNAVAILABLE','amber')}</div>`;$('#chart').innerHTML='<div class="micro" style="padding:40px">No verified history for this ticker. Try ANALYZE again; price refresh remains independent.</div>';}
}
$('#form').onsubmit=e=>{e.preventDefault();run();};$('#tf').onchange=()=>run();
accuracySnapshot().then(renderAccuracy).catch(()=>renderAccuracy(null));
const qp=new URLSearchParams(location.search);if(qp.get('symbol'))$('#symbol').value=qp.get('symbol').toUpperCase();if(qp.get('tf'))$('#tf').value=qp.get('tf');if(qp.get('asset'))$('#asset').value=qp.get('asset');run();

