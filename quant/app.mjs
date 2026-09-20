import {createChart,CandlestickSeries,HistogramSeries,LineSeries,createSeriesMarkers} from '../vendor/lightweight-charts.mjs';
import {loadMarketData,detectAsset} from './src/data.mjs';
import {analyzeQuant} from './src/engine.mjs';

const $=s=>document.querySelector(s),finite=Number.isFinite;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>finite(x)?'$'+x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const num=(x,n=2)=>finite(x)?x.toFixed(n):'—';
const pct=x=>finite(x)?(x*100).toFixed(1)+'%':'—';
let chart=null,controller=null;

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
  const step={15M:900,'15M':900,'1H':3600,'4H':14400}[q.timeframe]||86400,out=[];let t=last.ts;
  for(let i=0;i<n;i++){t+=step;out.push(t);}return out;
}
function drawProjection(q,candle){
  const mc=q.forecast.monteCarlo;if(!mc?.length)return;const times=futureTimes(q),lastTime=q.timeframe==='1D'?q.bars.at(-1).date:q.bars.at(-1).ts,lastPrice=q.bars.at(-1).close;
  const sets=[
    {key:'median',color:'#49d7e6',width:2},
    {key:'p25',color:'#7f93a3',width:1},
    {key:'p75',color:'#7f93a3',width:1}
  ];
  for(const s of sets){const line=chart.addSeries(LineSeries,{color:s.color,lineWidth:s.width,lineStyle:s.key==='median'?0:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});const points=[{time:lastTime,value:lastPrice},...mc.slice(0,20).map((x,i)=>({time:times[i],value:x[s.key]})).filter(x=>finite(x.value))];line.setData(points);}
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
  marks.sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0);createSeriesMarkers(c,marks);drawProjection(q,c);
  chart.timeScale().setVisibleLogicalRange({from:Math.max(0,q.bars.length-150),to:q.bars.length+22});
  $('#chart-note').textContent=`${q.sourceSymbol} · ${q.timeframe} · ${q.bars.length.toLocaleString()} completed bars · forecast lines extend 20 bars beyond last completed candle`;
}
function render(q){
  const k=klass(q.state.direction),p=q.plan,pr=q.forecast.projection,h=q.forecast.historical,m=q.math,s=q.structure;
  $('#decision').innerHTML=`<div>${cell('MODEL ACTION',esc(q.state.action),k)}<div class="micro">${esc(p?.detail||'No trade until the model develops an edge.')}</div></div>${cell('DIRECTION',esc(q.state.direction),k)}${cell('CONVICTION',q.state.conviction+'/100',k)}${cell('REGIME',esc(q.state.regime))}${cell('QUALITY',esc(q.state.quality),q.state.quality==='A'?'up':'amber')}`;
  $('#source').textContent=q.provider;
  $('#trade').innerHTML=`<h2>EXECUTION MAP</h2><div class="trade-action ${k}">${esc(q.state.action)}</div>${p?kv('Bias',p.direction,k)+kv('Preferred entry',money(p.entryZone.low)+' – '+money(p.entryZone.high),'amber')+kv(p.direction==='LONG'?'Breakout trigger':'Breakdown trigger',money(p.trigger),'cyan')+kv('Fixed invalidation',money(p.stop),'down')+p.targets.map(t=>kv(t.name,money(t.price)+' · '+(finite(t.riskReward)?num(t.riskReward)+'R':'—'),'up')).join('')+kv('Nearest target R:R',finite(p.rr)?num(p.rr)+'R':'—')+`<div class="rule"><b>Entry condition:</b> ${esc(p.entryRule)}<br><br><b>Failure:</b> ${esc(p.invalidation)}</div>`:'<div class="rule">No actionable execution map while the model is neutral.</div>'}`;
  $('#projections').innerHTML=`<div class="panel-head"><span>PROJECTED PRICE PATHS</span><span>5 / 10 / 20 BARS</span></div>${pr?`<div class="projection-grid">${pathCard(pr.primary,k)}${pathCard(pr.pullback,'amber')}${pathCard(pr.expansion,k)}<div class="path"><b class="down">THESIS FAILURE</b><div class="path-row"><span>Invalidation</span><strong>${money(pr.failure.price)}</strong></div><div class="micro">If invalidation breaks on a completed bar, the current directional thesis is no longer valid.</div></div></div><div class="micro">10-bar central range: ${money(pr.range10?.low)} – ${money(pr.range10?.high)} · 20-bar central range: ${money(pr.range20?.low)} – ${money(pr.range20?.high)}</div>`:'<div class="micro">No directional projection in a neutral state.</div>'}`;
  $('#state-grid').innerHTML=
    stateCard('Velocity',num(m.velocity),'smoothed price velocity',Math.min(100,Math.abs(m.velocity)*35))+
    stateCard('Acceleration',num(m.acceleration),'change in velocity',Math.min(100,Math.abs(m.acceleration)*40))+
    stateCard('Entropy',num(m.entropy,3),finite(m.entropy)&&m.entropy>.9?'chaotic / lower confidence':'organized / usable',finite(m.entropy)?(1-m.entropy)*100:null)+
    stateCard('Hurst',num(m.hurst,3),finite(m.hurst)?(m.hurst>.55?'persistent trend regime':m.hurst<.45?'mean-reverting tendency':'near random walk'):'insufficient')+
    stateCard('Dominant cycle',m.dominantCycle?m.dominantCycle.period+' bars':'—',m.dominantCycle?'phase '+num(m.dominantCycle.phase*180/Math.PI,0)+'°':'')+
    stateCard('Realized vol',pct(m.realizedVol),'annualized recent log-return volatility')+
    stateCard('Compression',num(m.compression,2),finite(m.compression)&&m.compression<.72?'compressed / expansion risk':'normal or expanded')+
    stateCard('Volume anomaly',num(m.volumeZ,2)+'σ',m.bullAbsorption?'bullish absorption proxy':m.bearAbsorption?'bearish absorption proxy':'no strong absorption proxy');
  const rows=q.forecast.monteCarlo.filter(x=>[1,5,10,20].includes(x.step));
  $('#distribution').innerHTML=rows.length?`<table class="forecast-table"><thead><tr><th>Bars</th><th>P10</th><th>P25</th><th>Median</th><th>P75</th><th>P90</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.step}</td><td>${money(x.p10)}</td><td>${money(x.p25)}</td><td>${money(x.median)}</td><td>${money(x.p75)}</td><td>${money(x.p90)}</td></tr>`).join('')}</tbody></table>`:'<div class="micro">Forecast unavailable.</div>';
  const recent=s.events.slice(-5).reverse();
  $('#evidence').innerHTML=`<div class="evidence-list"><div class="e-item"><b>STRUCTURE</b>${esc(s.pattern)} · directional state ${s.direction>0?'up':s.direction<0?'down':'neutral'}</div><div class="e-item"><b>DIVERGENCE</b>${esc(s.divergence?.type||'No confirmed RSI pivot divergence')}</div><div class="e-item"><b>RECENT SWEEP</b>${esc(s.recentSweep?s.recentSweep.dir>0?'Bullish downside liquidity sweep':'Bearish upside liquidity sweep':'None in the recent window')}</div><div class="e-item"><b>RECENT STRUCTURE EVENTS</b>${recent.length?recent.map(e=>esc(e.type)+' @ '+money(e.level)).join(' · '):'None'}</div><div class="e-item"><b>HISTORICAL CONTEXT</b>${h.n?`${(h.rate*100).toFixed(1)}% of ${h.n} simplified same-direction historical states were positive after ${h.horizon} bars; 95% interval ${pct(h.interval.low)}–${pct(h.interval.high)}.`:'Insufficient comparable sample.'}</div></div>`;
  $('#integrity').innerHTML=kv('Model',esc(q.model))+kv('Requested',esc(q.symbol))+kv('Source symbol',esc(q.sourceSymbol))+kv('Bars',q.bars.length.toLocaleString())+kv('Provider',esc(q.provider))+kv('Fetched',q.fetchedAt?new Date(q.fetchedAt).toLocaleString():'—')+kv('Credential handling',esc(q.credentialPolicy||'No browser credential'))+`<div class="micro">${esc(q.caveats.join(' '))}</div>`;
  renderChart(q);
}
async function run(){
  const symbol=$('#symbol').value.trim().toUpperCase();if(!symbol)return;controller?.abort();controller=new AbortController();$('#status').textContent='Loading data into standalone quant engine…';
  try{const asset=detectAsset(symbol,$('#asset').value),timeframe=$('#tf').value,data=await loadMarketData({symbol,asset,timeframe,signal:controller.signal}),q=analyzeQuant({...data});render(q);$('#status').textContent=`READY · ${data.provider} · ${data.bars.length.toLocaleString()} completed bars`;history.replaceState(null,'',`?symbol=${encodeURIComponent(symbol)}&tf=${timeframe}&asset=${asset}`);}
  catch(e){if(e.name==='AbortError')return;$('#status').textContent='ERROR · '+e.message;$('#decision').innerHTML=`<div>${cell('MODEL ACTION','DATA UNAVAILABLE','amber')}</div>`;$('#chart').innerHTML='<div class="micro" style="padding:40px">No chart until a valid data series is available.</div>';$('#trade').innerHTML='';$('#projections').innerHTML='';$('#state-grid').innerHTML='';}
}
$('#form').onsubmit=e=>{e.preventDefault();run();};$('#tf').onchange=()=>run();
const qp=new URLSearchParams(location.search);if(qp.get('symbol'))$('#symbol').value=qp.get('symbol').toUpperCase();if(qp.get('tf'))$('#tf').value=qp.get('tf');if(qp.get('asset'))$('#asset').value=qp.get('asset');run();
