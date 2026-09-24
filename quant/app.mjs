import {createChart,CandlestickSeries,HistogramSeries,LineSeries,createSeriesMarkers} from '../vendor/lightweight-charts.mjs';
import {loadMarketData,loadFreshQuote,detectAsset} from './src/data.mjs';
import {analyzeQuant} from './src/engine.mjs';

const $=s=>document.querySelector(s),finite=Number.isFinite;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>finite(x)?'$'+x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const num=(x,n=2)=>finite(x)?x.toFixed(n):'—';
const pct=x=>finite(x)?(x*100).toFixed(1)+'%':'—';
function ageText(epochSeconds){
  if(!finite(epochSeconds))return '—';
  const sec=Math.max(0,Math.floor(Date.now()/1000-epochSeconds));
  if(sec<60)return sec+' sec';
  if(sec<3600)return Math.floor(sec/60)+'m '+(sec%60)+'s';
  if(sec<86400)return Math.floor(sec/3600)+'h '+Math.floor((sec%3600)/60)+'m';
  return Math.floor(sec/86400)+'d '+Math.floor((sec%86400)/3600)+'h';
}
function ageClass(epochSeconds,marketState=''){
  if(!finite(epochSeconds))return 'amber';
  const sec=Math.max(0,Date.now()/1000-epochSeconds),m=String(marketState||'').toUpperCase();
  if(m.includes('CLOSED')||m.includes('POST')||m.includes('PRE'))return sec<86400?'cyan':'amber';
  return sec<=120?'up':sec<=900?'amber':'down';
}
function renderQuote(){
  const q=quoteState;
  $('#quote-price').textContent=q?money(q.price):'—';
  $('#quote-symbol').textContent=q?(q.requestedSymbol+(q.sourceSymbol&&q.sourceSymbol!==q.requestedSymbol?' → '+q.sourceSymbol:'')+(q.isProxy?' · PROXY':'')):'Enter a ticker and analyze.';
  $('#quote-market').textContent=q?((q.marketState||'UNKNOWN')+(q.currency?' · '+q.currency:'')):'—';
  $('#quote-time').textContent=q&&finite(q.asOf)?new Date(q.asOf*1000).toLocaleString():'—';
  $('#quote-age').textContent=q?ageText(q.asOf):'—';
  $('#quote-age').className='quote-value '+(q?ageClass(q.asOf,q.marketState):'amber');
  $('#quote-provider').textContent=q?(q.provider+(q.exchange?' · '+q.exchange:'')):'—';
  $('#refresh-quote').disabled=quoteBusy;
}
async function refreshQuote({quiet=false}={}){
  const symbol=$('#symbol').value.trim().toUpperCase();if(!symbol)return null;
  quoteController?.abort();quoteController=new AbortController();quoteBusy=true;renderQuote();
  if(!quiet)$('#status').textContent='Refreshing live quote for '+symbol+'…';
  try{
    const asset=detectAsset(symbol,$('#asset').value),q=await loadFreshQuote({symbol,asset,signal:quoteController.signal});
    quoteState=q;renderQuote();
    if(!quiet)$('#status').textContent='QUOTE REFRESHED · '+q.sourceSymbol+' · '+ageText(q.asOf)+' old';
    return q;
  }catch(e){
    if(e.name==='AbortError')return null;
    quoteState=null;renderQuote();
    if(!quiet)$('#status').textContent='QUOTE ERROR · '+e.message;
    return null;
  }finally{quoteBusy=false;renderQuote();}
}
let chart=null,controller=null,quoteController=null,quoteState=null,quoteBusy=false;

function klass(dir){return dir==='BULLISH'||dir==='LONG'?'up':dir==='BEARISH'||dir==='SHORT'?'down':'amber';}
function cell(label,value,k=''){return `<div><div class="label">${esc(label)}</div><div class="value ${k}">${value}</div></div>`;}
function kv(label,value,k=''){return `<div class="kv"><span>${esc(label)}</span><span class="${k}">${value}</span></div>`;}
function pathCard(p,k=''){if(!p)return'';return `<div class="path"><b class="${k}">${esc(p.label)}</b><div class="path-row"><span>5 bars</span><strong>${money(p.bar5)}</strong></div><div class="path-row"><span>10 bars</span><strong>${money(p.bar10)}</strong></div><div class="path-row"><span>20 bars</span><strong>${money(p.bar20)}</strong></div></div>`;}
function stateCard(label,value,detail='',score=null){return `<div class="state-card"><div class="label">${esc(label)}</div><div class="value">${value}</div>${detail?`<div class="micro">${esc(detail)}</div>`:''}${finite(score)?`<div class="bar"><i style="width:${Math.max(0,Math.min(100,score))}%"></i></div>`:''}</div>`;}

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
  const k=klass(q.state.direction),p=q.plan,pr=q.forecast.projection,h=q.forecast.historical,m=q.math,s=q.structure,ctx=q.apiContext||null,primaryH=String(q.state.calibratedProbabilityHorizon||({'15M':20,'1H':10,'4H':5,'1D':10}[q.timeframe]||10)),hPrimary=q.trained?.horizons?.[primaryH]||null,lastBar=q.bars?.at(-1);
  const providers=ctx?.providers||{},providerRows=Object.values(providers),providerOK=providerRows.filter(x=>x?.status==='OK').length,providerTotal=providerRows.length;
  const fred=providers.fred?.series||{},macroText=[fred.DGS10?.value!=null?'10Y '+fred.DGS10.value+'%':null,fred.DFII10?.value!=null?'Real 10Y '+fred.DFII10.value+'%':null,fred.T10YIE?.value!=null?'BE inflation '+fred.T10YIE.value+'%':null,fred.DTWEXBGS?.value!=null?'USD index '+fred.DTWEXBGS.value:null].filter(Boolean).join(' · ');
  const probText=q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?pct(q.state.calibratedProbabilityDirection):'WITHHELD',probLabel=primaryH+'-BAR P(SETUP DIR FIRST)';
  $('#decision').innerHTML=`<div>${cell('MODEL ACTION',esc(q.state.action),k)}<div class="micro">${esc(p?.detail||'No trade until the model develops an edge.')}</div></div>${cell('DIRECTION',esc(q.state.direction),k)}${cell(probLabel,probText,q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?k:'amber')}${cell('REGIME',esc(q.state.regime))}${cell('QUALITY',esc(q.state.quality),q.state.quality==='A'?'up':'amber')}`;
  $('#source').textContent=q.provider;
  $('#trade').innerHTML=`<h2>EXECUTION MAP</h2><div class="trade-action ${k}">${esc(q.state.action)}</div>${p?kv('Bias',p.direction,k)+kv(primaryH+'-bar calibrated P(setup dir first)',probText,q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?k:'amber')+kv('Preferred entry',money(p.entryZone.low)+' – '+money(p.entryZone.high),'amber')+kv(p.direction==='LONG'?'Breakout trigger':'Breakdown trigger',money(p.trigger),'cyan')+kv('Fixed invalidation',money(p.stop),'down')+p.targets.map(t=>kv(t.name,money(t.price)+' · '+(finite(t.riskReward)?num(t.riskReward)+'R':'—')+' · '+esc(t.source),'up')).join('')+kv('Nearest target R:R',finite(p.rr)?num(p.rr)+'R':'—')+`<div class="rule"><b>Entry condition:</b> ${esc(p.entryRule)}<br><br><b>Failure:</b> ${esc(p.invalidation)}</div>`:'<div class="rule">No actionable execution map while the model is neutral.</div>'}`;
  $('#projections').innerHTML=`<div class="panel-head"><span>PROJECTED PRICE PATHS</span><span>${esc(pr?.source||'NO MODEL PATH')}</span></div>${pr?`<div class="projection-grid">${pathCard(pr.primary,k)}${pathCard(pr.pullback,'amber')}${pathCard(pr.expansion,k)}<div class="path"><b class="down">THESIS FAILURE</b><div class="path-row"><span>Invalidation</span><strong>${money(pr.failure.price)}</strong></div><div class="micro">If invalidation breaks on a completed bar, the current directional thesis is no longer valid.</div></div></div><div class="micro">10-bar central range: ${money(pr.range10?.low)} – ${money(pr.range10?.high)} · 20-bar central range: ${money(pr.range20?.low)} – ${money(pr.range20?.high)}. Walk-forward conditional ranges are used only when the probability model passed promotion.</div>`:'<div class="micro">No directional projection in a neutral state.</div>'}`;
  const mtfDetail=q.mtf?.rows?.map(x=>x.timeframe+' '+(x.bias>0?'↑':x.bias<0?'↓':'—')).join(' · ')||'No multi-timeframe snapshot';
  const skill=hPrimary?.metrics?.brier_skill;
  $('#state-grid').innerHTML=
    stateCard('Model conviction',q.state.conviction+'/100',q.state.probabilityStatus==='WALK_FORWARD_VALIDATED'?'trained model dominates fixed heuristic':'rule-based because probability model is withheld',q.state.conviction)+
    stateCard('MTF alignment',finite(q.mtf?.alignmentWithTrade)?num(q.mtf.alignmentWithTrade,2):'—',mtfDetail,finite(q.mtf?.alignmentWithTrade)?(q.mtf.alignmentWithTrade+1)*50:null)+
    stateCard('OOS Brier skill',finite(skill)?pct(skill):'WITHHELD',hPrimary?.validated?`${hPrimary.oosSamples||0} out-of-sample observations`:esc(hPrimary?.status||'No trained model'),finite(skill)?Math.max(0,Math.min(100,skill*1000)):null)+
    stateCard('Latent velocity',num(m.velocity),'state-filtered price velocity',Math.min(100,Math.abs(m.velocity)*35))+
    stateCard('Latent acceleration',num(m.acceleration),'change in filtered velocity',Math.min(100,Math.abs(m.acceleration)*40))+
    stateCard('Entropy',num(m.entropy,3),finite(m.entropy)&&m.entropy>.9?'chaotic / lower confidence':'organized / usable',finite(m.entropy)?(1-m.entropy)*100:null)+
    stateCard('Hurst',num(m.hurst,3),finite(m.hurst)?(m.hurst>.55?'persistent trend regime':m.hurst<.45?'mean-reverting tendency':'near random walk'):'insufficient')+
    stateCard('Dominant cycle',m.dominantCycle?m.dominantCycle.period+' bars':'—',m.dominantCycle?'phase '+num(m.dominantCycle.phase*180/Math.PI,0)+'°':'')+
    stateCard('Realized vol',pct(m.realizedVol),'annualized recent log-return volatility')+
    stateCard('Compression',num(m.compression,2),finite(m.compression)&&m.compression<.72?'compressed / expansion risk':'normal or expanded')+
    stateCard('Volume anomaly',num(m.volumeZ,2)+'σ',m.bullAbsorption?'bullish absorption proxy':m.bearAbsorption?'bearish absorption proxy':'no strong absorption proxy')+
    stateCard('API health',providerTotal?providerOK+'/'+providerTotal+' OK':'—',ctx?.spy_cross_source?.status?('SPY cross-check '+ctx.spy_cross_source.status+(finite(ctx.spy_cross_source.dispersion_pct)?' · '+num(ctx.spy_cross_source.dispersion_pct,3)+'% dispersion':'')):'No secured context manifest yet',providerTotal?providerOK/providerTotal*100:null)+
    stateCard('Bar freshness',esc(q.dataStatus||'COMPLETED BAR'),lastBar?('last completed '+(lastBar.date||new Date((lastBar.end_ts||0)*1000).toISOString())+' · '+ageText(lastBar.end_ts)+' old'):'no completed bar');
  const trainedRows=trainedDistributionRows(q),rows=trainedRows.length?trainedRows:q.forecast.monteCarlo.filter(x=>[1,5,10,20].includes(x.step));
  $('#distribution').innerHTML=rows.length?`<table class="forecast-table"><thead><tr><th>Bars</th><th>P10</th><th>P25</th><th>Median</th><th>P75</th><th>P90</th><th>OOS n</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.step}</td><td>${money(x.p10)}</td><td>${money(x.p25)}</td><td>${money(x.median)}</td><td>${money(x.p75)}</td><td>${money(x.p90)}</td><td>${x.n||'simulation'}</td></tr>`).join('')}</tbody></table><div class="micro">${trainedRows.length?'Distribution is conditioned on walk-forward out-of-sample prediction bins.':'No promoted return model for all horizons; showing simulation fallback.'}</div>`:'<div class="micro">Forecast unavailable.</div>';
  const recent=s.events.slice(-5).reverse();
  const trainedEvidence=hPrimary?`${primaryH}-bar ${hPrimary.validated?'PROMOTED':'WITHHELD'} · OOS ${hPrimary.oosSamples||0} · Brier ${num(hPrimary.metrics?.brier,4)} vs base ${num(hPrimary.metrics?.base_brier,4)} · skill ${finite(skill)?pct(skill):'—'} · folds ${hPrimary.metrics?.positive_folds??'—'}/${hPrimary.metrics?.required_positive_folds??'—'} positive · log loss ${num(hPrimary.metrics?.log_loss,4)} vs base ${num(hPrimary.metrics?.base_log_loss,4)}`:'No Q2 trained model artifact available.';
  $('#evidence').innerHTML=`<div class="evidence-list"><div class="e-item"><b>WALK-FORWARD MODEL</b>${esc(trainedEvidence)}</div><div class="e-item"><b>MULTI-TIMEFRAME</b>${esc(mtfDetail)} · alignment with current trade ${finite(q.mtf?.alignmentWithTrade)?num(q.mtf.alignmentWithTrade,2):'—'}</div><div class="e-item"><b>STRUCTURE</b>${esc(s.pattern)} · ${esc(s.method)} · directional state ${s.direction>0?'up':s.direction<0?'down':'neutral'}</div><div class="e-item"><b>DIVERGENCE</b>${esc(s.divergence?.type||'No confirmed RSI pivot divergence')}</div><div class="e-item"><b>RECENT SWEEP</b>${esc(s.recentSweep?s.recentSweep.dir>0?'Bullish downside liquidity sweep':'Bearish upside liquidity sweep':'None in the recent window')}</div><div class="e-item"><b>RECENT STRUCTURE EVENTS</b>${recent.length?recent.map(e=>esc(e.type)+' @ '+money(e.level)+' · scale '+(e.scale||'—')).join(' · '):'None'}</div><div class="e-item"><b>RULE-BASED HISTORICAL CONTEXT</b>${h.n?`${(h.rate*100).toFixed(1)}% of ${h.n} simplified same-direction historical states were positive after ${h.horizon} bars; 95% interval ${pct(h.interval.low)}–${pct(h.interval.high)}.`:'Insufficient comparable sample.'}</div><div class="e-item"><b>MACRO CONTEXT · FRED</b>${esc(macroText||providers.fred?.reason||'No sanitized FRED context yet.')}</div></div>`;
  const apiLines=providerRows.length?Object.entries(providers).map(([name,v])=>kv('API '+name.toUpperCase(),esc(v?.status||'UNKNOWN')+(v?.reason?' · '+esc(v.reason):''),v?.status==='OK'?'up':'amber')).join(''):kv('API context','No context manifest yet','amber');
  $('#integrity').innerHTML=kv('Engine',esc(q.model))+kv('Trained artifact',esc(q.trained?.modelVersion||'Unavailable'))+kv('Trained artifact generated',q.trained?.generatedAt?new Date(q.trained.generatedAt).toLocaleString():'—')+kv('Probability policy',esc(q.state.probabilityStatus))+kv('Probability definition',esc(q.trained?.labelDefinition||'Withheld/unavailable'))+kv('Projection source',esc(q.forecast.source||'—'))+kv('Requested',esc(q.symbol))+kv('Source symbol',esc(q.sourceSymbol))+kv('Bars',q.bars.length.toLocaleString())+kv('Primary bar provider',esc(q.provider))+kv('Fetched',q.fetchedAt?new Date(q.fetchedAt).toLocaleString():'—')+kv('Data status',esc(q.dataStatus||'—'))+kv('Last completed bar',q.lastCompletedBar?new Date(q.lastCompletedBar*1000).toLocaleString():(lastBar?.date||'—'))+kv('Bar age',q.lastCompletedBar?ageText(q.lastCompletedBar):'—')+kv('Live quote age',quoteState?ageText(quoteState.asOf):'—')+kv('Credential handling',esc(q.credentialPolicy||'No browser credential'))+apiLines+`<div class="micro">${esc(ctx?.purpose||'API context is informational and does not silently change the trade score.')} ${esc(q.caveats.join(' '))}</div>`;
  renderChart(q);
}
async function run(){
  const symbol=$('#symbol').value.trim().toUpperCase();if(!symbol)return;controller?.abort();controller=new AbortController();$('#status').textContent='Fetching fresh '+symbol+' bars + quote, then running Q-State 2.0…';
  const quotePromise=refreshQuote({quiet:true});
  try{
    const asset=detectAsset(symbol,$('#asset').value),timeframe=$('#tf').value,data=await loadMarketData({symbol,asset,timeframe,signal:controller.signal,preferFresh:true}),q=analyzeQuant({...data});
    q.apiContext=data.apiContext;q.dataStatus=data.dataStatus||'COMPLETED BAR';q.lastCompletedBar=data.lastCompletedBar||data.bars?.at(-1)?.end_ts||null;render(q);
    await quotePromise;
    const barAge=q.lastCompletedBar?ageText(q.lastCompletedBar):'unknown';
    const quoteAge=quoteState?ageText(quoteState.asOf):'unavailable';
    $('#status').textContent=`READY · ${data.provider} · BAR AGE ${barAge} · QUOTE AGE ${quoteAge} · ${q.state.probabilityStatus}`;
    history.replaceState(null,'',`?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}&asset=${asset}`);
  }catch(e){
    if(e.name==='AbortError')return;await quotePromise;
    $('#status').textContent='ERROR · '+e.message;$('#decision').innerHTML=`<div>${cell('MODEL ACTION','DATA UNAVAILABLE','amber')}</div>`;$('#chart').innerHTML='<div class="micro" style="padding:40px">Fresh data could not be loaded for this symbol/timeframe. The live quote above may still be available.</div>';$('#trade').innerHTML='';$('#projections').innerHTML='';$('#state-grid').innerHTML='';
  }
}
$('#form').onsubmit=e=>{e.preventDefault();run();};
$('#tf').onchange=()=>run();
$('#asset').onchange=()=>run();
$('#symbol').onchange=()=>run();
$('#refresh-quote').onclick=()=>refreshQuote();
setInterval(()=>{if(quoteState)renderQuote();},1000);
const qp=new URLSearchParams(location.search);if(qp.get('symbol'))$('#symbol').value=qp.get('symbol').toUpperCase();if(qp.get('tf'))$('#tf').value=qp.get('tf');if(qp.get('asset'))$('#asset').value=qp.get('asset');renderQuote();run();
