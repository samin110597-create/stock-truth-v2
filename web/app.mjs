import {retrieveTicker} from '../src/providers.mjs';
import {finite} from '../src/numeric.mjs';
import {technicals,anchoredVwap} from '../src/technicals.mjs';
import {setupIdentity} from '../src/setups.mjs';
import {resolveSetup} from '../src/validation.mjs';
import {createChart,CandlestickSeries,LineSeries,HistogramSeries,createSeriesMarkers} from '../vendor/lightweight-charts.mjs';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,n=2)=>finite(x)?x.toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
const money=x=>finite(x)?'$'+fmt(x):'—',pct=x=>finite(x)?fmt(x*100,1)+'%':'—';
const when=x=>!x?'Unavailable':new Date(typeof x==='number'?x*1000:x).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const cls=s=>/BULL|LONG|CONFIRMED/.test(s)?'up':/BEAR|SHORT/.test(s)?'down':/WAIT|WATCH|UNVERIFIED|STALE|REVIEW/.test(s)?'amber':'';
const pill=(x,c='')=>`<span class="pill ${c||cls(x)}">${esc(x)}</span>`;
const metric=(k,v,sub='')=>`<div class="metric"><div class="label">${esc(k)}</div><div class="value">${v}</div><div class="sub">${esc(sub)}</div></div>`;
const line=(k,v)=>`<div class="tech-line"><span>${esc(k)}</span><span>${v}</span></div>`;
let state=null,raw=null,calendar=null,config=null,build=null,chart=null,candles=null,volume=null,worker=null,controller=null,requestId=0;
let series=[],priceLines=[],markers=null;const benchmarks={};
function choice(){return {mode:$('#mode').value,horizon:$('#horizon').value,key:$('#mode').value+'_'+$('#horizon').value,tf:$('#timeframe').value};}
function emptyPanels(symbol,message){
  state=null;raw=null;
  if(chart){chart.remove();chart=null;candles=null;}
  $('#identity').innerHTML=`<h1>${esc(symbol)}</h1><span class="muted">${esc(message)}</span>`;
  for(const id of ['decision','thesis','mtf','reversal','validation','technicals','fundamentals','health','ledger'])$('#'+id).innerHTML='';
  $('#chart').innerHTML=`<div class="empty">${esc(message)}</div>`;$('#chart-note').textContent='';
  document.title=`${symbol} · Stock Truth`;
}
function chartData(){
  if(!state)return;const {tf,key}=choice(),f=state.frames[tf],plan=state.setups[key]?.setup;
  if(chart){chart.remove();chart=null;}$('#chart').innerHTML='';series=[];priceLines=[];
  if(!f?.bars?.length){$('#chart').innerHTML=`<div class="empty">${esc(tf)} UNAVAILABLE<br>Other timeframes remain usable.</div>`;$('#chart-note').textContent=f?.reason||'No completed bars returned.';return;}
  chart=createChart($('#chart'),{autoSize:true,layout:{background:{color:'#0e1927'},textColor:'#99a9bf',fontSize:12,attributionLogo:true},grid:{vertLines:{color:'#1a283a'},horzLines:{color:'#1a283a'}},rightPriceScale:{borderColor:'#2d3c52',scaleMargins:{top:.1,bottom:.22}},timeScale:{borderColor:'#2d3c52',timeVisible:['5M','15M','30M','1H','4H'].includes(tf)},crosshair:{mode:0}});
  const data=f.bars;const intraday=['5M','15M','30M','1H','4H'].includes(tf);const time=b=>intraday?b.ts:b.date;
  candles=chart.addSeries(CandlestickSeries,{upColor:'#5ed3ae',downColor:'#ff8891',borderVisible:false,wickUpColor:'#5ed3ae',wickDownColor:'#ff8891',priceFormat:{type:'price',precision:2,minMove:.01}});
  candles.setData(data.map(b=>({time:time(b),open:b.open,high:b.high,low:b.low,close:b.close})));
  volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume'});
  volume.priceScale().applyOptions({scaleMargins:{top:.84,bottom:0}});
  volume.setData(data.filter(b=>finite(b.volume)).map(b=>({time:time(b),value:b.volume,color:b.close>=b.open?'#244c48':'#53313c'})));
  const addLine=(v,color,title,style=2)=>{if(!finite(v))return;priceLines.push(candles.createPriceLine({price:v,color,lineWidth:1,lineStyle:style,axisLabelVisible:true,title}));};
  const addSeries=(values,color)=>{const s=chart.addSeries(LineSeries,{color,lineWidth:1,lastValueVisible:false,priceLineVisible:false});s.setData(values.map((v,i)=>finite(v)?{time:time(data[i]),value:v}:null).filter(Boolean));series.push(s);};
  if($('#overlay-levels').checked){addLine(f.structure?.support?.[0]?.price,'#5ed3ae','Support');addLine(f.structure?.resistance?.[0]?.price,'#ff8891','Resistance');}
  if($('#overlay-plan').checked&&plan&&tf==='1D'){addLine(plan.entry_zone.low,'#f1b95a','Entry low');addLine(plan.entry_zone.high,'#f1b95a','Entry high');addLine(plan.stop,'#ff8891','Stop');for(const t of plan.targets)addLine(t.price,'#81b6ff',t.name);}
  const t=($('#overlay-ema').checked||$('#overlay-vwap').checked)?technicals(data,tf):null;
  if($('#overlay-ema').checked){addSeries(t.series.ema[20],'#f1b95a');addSeries(t.series.ema[50],'#819ef0');}
  if($('#overlay-vwap').checked){addSeries(t.series.vwap,'#d0a0e7');const anchor=f.reversal?.avwap?.anchor_ts;const i=data.findIndex(b=>b.ts===anchor);if(i>=0)addSeries(anchoredVwap(data,i),'#ab85cf');}
  const marks=[];
  if($('#overlay-structure').checked){
    for(const p of f.pivots.filter(p=>p.quality>=65).slice(-16))marks.push({time:time(data[p.i]),position:p.type==='H'?'aboveBar':'belowBar',color:'#aebed2',shape:'circle',text:p.label,size:.35});
    for(const e of f.events.filter(e=>['BOS','CHoCH'].includes(e.type)).slice(-14))marks.push({time:time(data[e.i]),position:e.dir>0?'belowBar':'aboveBar',color:e.dir>0?'#5ed3ae':'#ff8891',shape:'circle',text:e.type,size:.4});
  }
  if($('#overlay-sweeps').checked)for(const e of f.events.filter(e=>e.type==='LIQUIDITY SWEEP').slice(-14))marks.push({time:time(data[e.i]),position:e.dir>0?'belowBar':'aboveBar',color:'#f1b95a',shape:e.dir>0?'arrowUp':'arrowDown',text:'Sweep proxy',size:.6});
  marks.sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0);markers=createSeriesMarkers(candles,marks);
  chart.timeScale().setVisibleLogicalRange({from:Math.max(0,data.length-140),to:data.length+4});
  $('#chart-note').textContent=`${state.symbol} · ${tf} · ${data.length.toLocaleString()} completed bars · ${f.provenance.native?'Native provider bars':'Resampled OHLCV'} · Last close ${when(data.at(-1).end_ts)}. Pivot markers become known ${f.timeframe==='1D'?'3 daily bars':'3 bars'} after their candle.`;
  $('#chart').setAttribute('data-symbol',state.symbol);$('#chart').setAttribute('data-bars',String(data.length));
}
function readLocalLedger(){try{return JSON.parse(localStorage.getItem('stocktruth-ledger-v5')||'[]');}catch{return[];}}
function rememberSetups(){
  if(!state?.health.tradeable)return;
  const ledger=readLocalLedger();for(const item of Object.values(state.setups)){const s=item.setup;if(!s)continue;const id=setupIdentity(s);if(!ledger.some(x=>x.id===id))ledger.push({id,issued_at:new Date().toISOString(),setup:structuredClone(s)});}
  try{localStorage.setItem('stocktruth-ledger-v5',JSON.stringify(ledger));}catch{$('#load-status').textContent+=' Local setup history could not be saved.';}
}
function render(){
  if(!state)return;const {tf,key,mode,horizon}=choice(),d=state.frames['1D'],f=state.frames[tf],plan=state.setups[key]?.setup,v=state.validation[mode+'_SWING'];
  $('#identity').innerHTML=`<div><h1>${esc(state.symbol)}</h1><span class="muted">${esc(state.name)}</span></div><span class="price">${money(state.quote?.price)}</span><span class="${state.quote?.change>=0?'up':'down'}">${finite(state.quote?.change)?fmt(state.quote.change)+' / '+fmt(state.quote.change_pct)+'%':''}</span><div class="source">${pill(state.market?.state||'UNAVAILABLE')}${pill(state.health.status)}<div class="mini">${esc(state.quote?.provider||'Quote unavailable')} · ${when(state.quote?.as_of)}<br>Snapshot · provider latency unspecified · model ${esc(state.model_version)}</div></div>`;
  const action=plan?.current_action||state.thesis.best_action;
  $('#decision').innerHTML=`<div><h2>${esc(horizon)} DECISION · ${esc(mode.toUpperCase())}</h2><div class="action ${cls(action)}">${esc(action)}</div>${pill(plan?.grade||'NO EDGE')}${pill(plan?.confidence||v?.status||'INSUFFICIENT DATA')}<p class="note">${esc(plan?.confirmation||state.setups[key]?.reason||'Price history is not sufficient to build a plan.')}</p></div><div><div class="metrics">${metric('Entry zone',plan?money(plan.entry_zone.low)+'–'+money(plan.entry_zone.high):'—',plan?.kind||'No invented entry')}${metric('Stop / invalidation',money(plan?.stop),'Fixed at setup issuance')}${metric('TP1',money(plan?.targets[0]?.price),plan?'R:R '+fmt(plan.targets[0]?.risk_reward)+'×':'Structural objective required')}${metric('TP2',money(plan?.targets[1]?.price),plan?.targets[1]?.basis||'Unavailable without justification')}${metric('TP3',money(plan?.targets[2]?.price),plan?.targets[2]?.basis||'Unavailable without justification')}${metric('Evidence',plan?plan.score+'/100':'—','Grade / score ≠ probability')}${metric('Holding period',horizon==='SWING'?'≤21 sessions':'≤63 sessions','After a qualifying entry')}${metric('Daily bias',esc(d.technicals?.intermediate_trend||'UNAVAILABLE'),'Completed bars')}</div><p class="note">${esc(plan?.wait_reason||'A valid trend is not automatically a valid trade. Wait for a structural setup.')}</p></div>`;
  const thesis=state.thesis;$('#thesis').innerHTML=`<h2>Price action thesis</h2><div><h3>CURRENT STATE</h3><p>${esc(thesis.current)}</p></div><div><h3>BULL CASE</h3><p>${esc(thesis.bull)}</p></div><div><h3>BASE CASE</h3><p>${esc(thesis.base)}</p></div><div><h3>BEAR CASE</h3><p>${esc(thesis.bear)}</p></div><div class="best"><h3>BEST ACTION</h3><p>${esc(action)}</p></div><p class="mini">Conditional price/volume interpretation. Hidden institutional transactions are unavailable.</p>`;
  $('#mtf').innerHTML=`<h2>Multi-timeframe matrix</h2><div class="alignments">${Object.entries(state.alignment).map(([k,a])=>`<span>${esc(k.toUpperCase())} ${pill(a.label)} <small>${a.available}/${a.requested} available</small></span>`).join('')}</div><div class="table-wrap"><table><thead><tr><th>TIMEFRAME</th><th>TREND</th><th>STRUCTURE</th><th>MOMENTUM / RSI</th><th>VOLATILITY</th><th>KEY SUPPORT / RESISTANCE</th><th>REVERSAL</th><th>DATA</th></tr></thead><tbody>${Object.values(state.frames).map(z=>`<tr class="mtf-row" data-tf="${z.timeframe}"><td>${z.timeframe}</td><td class="${cls(z.technicals?.intermediate_trend||'')}">${esc(z.technicals?.intermediate_trend||'UNAVAILABLE')}</td><td>${esc(z.structure?.pattern||'—')}</td><td>${fmt(z.technicals?.rsi,1)}</td><td>${esc(z.technicals?.volatility_regime||'—')}</td><td>${money(z.structure?.support?.[0]?.price)} / ${money(z.structure?.resistance?.[0]?.price)}</td><td>${esc(z.reversal?.stage||'—')}</td><td>${pill(z.status)}</td></tr>`).join('')}</tbody></table></div><p class="note">Swing decisions use daily structure and completed weekly context. Intraday direction never silently overrides weekly conflict.</p>`;
  for(const row of $('#mtf').querySelectorAll('[data-tf]'))row.onclick=()=>{$('#timeframe').value=row.dataset.tf;render();};
  const rev=f?.reversal;$('#reversal').innerHTML=`<h2>Reversal & participation · ${tf}</h2>${pill(rev?.stage||'UNAVAILABLE')}<p class="note">All absorption, distribution, capitulation and liquidity interpretations are price/volume proxies.</p>${['absorption','distribution','capitulation','buying_climax'].map(k=>`<div class="evidence">${esc(k.replaceAll('_',' ').toUpperCase())} ${pill(!rev?'UNAVAILABLE':rev.proxies[k]?'DETECTED':'NOT DETECTED',rev?.proxies[k]?'amber':'')}<small>${k==='absorption'?'High relative volume, lower-wick rejection and defence of the prior low.':k==='distribution'?'High relative volume, upper-wick rejection and failure near the prior high.':'Extreme relative volume and range expansion with rejection; confirmation is still required.'}</small></div>`).join('')}<details><summary>Show reversal evidence</summary>${rev?.evidence?.map(e=>`<div class="evidence">${esc(e.name)} ${pill(e.classification)}<small>${esc(e.detail||'')}</small></div>`).join('')||'<p class="note">No qualifying evidence.</p>'}</details>`;
  $('#validation').innerHTML=`<h2>Model validation · ${mode} swing</h2>${pill(v?.status||'INSUFFICIENT DATA')}<p class="note">${esc(v?.validation_kind||'No sufficient historical replay is available.')}</p><div class="metrics">${metric('Effective samples',String(v?.n??0),'Non-overlapping entered setups')}${metric('TP1 frequency',pct(v?.metrics[0]?.frequency),'Historical TP1 before stop')}${metric('TP2 frequency',pct(v?.metrics[1]?.frequency),'Historical TP2 before stop')}${metric('TP1 95% interval',v?.metrics[0]?.n?pct(v.metrics[0].ci95.low)+'–'+pct(v.metrics[0].ci95.high):'—','Wilson interval')}${metric('Mean net TP1 result',finite(v?.metrics[0]?.mean_net_r)?fmt(v.metrics[0].mean_net_r)+'R':'—','Assumes 10 bps per side')}${metric('Direction probability','Unavailable','No calibrated model')}${metric('Coverage',pct(v?.coverage),'Signals / eligible observations')}${metric('Stop/target collisions',String(v?.ambiguous_stop_count??0),'Counted conservatively')}</div><details><summary>Method and limitations</summary><p class="note">${esc(v?.methodology||'Insufficient history.')}</p><p class="note">${esc(v?.collision_policy||'')}</p><p class="note">Brier score / skill: unavailable because no calibrated probability model is published. A+ grades are evidence scores, not win rates. No verified-edge claim is made from this replay.</p>${v?.folds?.map(x=>line('Chronological fold '+x.fold,x.n+' samples · '+pct(x.t1_frequency))).join('')||''}</details>`;
  renderTechnicals(f,tf);renderFundamentals();renderHealth();renderLedger();chartData();
}
function renderTechnicals(f,tf){
  const t=f?.technicals;$('#technicals').innerHTML=`<h2>Technical evidence · ${tf}</h2>`;
  if(!t){$('#technicals').innerHTML+='<p class="note">Technicals unavailable for this timeframe.</p>';return;}
  const group=(title,rows)=>`<div class="tech-group"><h3>${title}</h3>${rows.map(([k,v])=>line(k,v)).join('')}</div>`;
  $('#technicals').innerHTML+=`<div class="tech-grid">${group('TREND',[["Short / intermediate",esc(t.short_trend)+' / '+esc(t.intermediate_trend)],...[9,20,50,100,150,200].map(p=>['EMA '+p,money(t.ema[p])]),['SMA 50 / 200',money(t.sma[50])+' / '+money(t.sma[200])]])}${group('MOMENTUM',[['RSI 14',fmt(t.rsi,1)],['MACD / signal',fmt(t.macd,3)+' / '+fmt(t.macd_signal,3)],['MACD histogram',fmt(t.macd_hist,3)],['ROC 10',fmt(t.roc)+'%'],['Stochastic K / D',fmt(t.stochastic,1)+' / '+fmt(t.stochastic_d,1)],['Williams %R',fmt(t.williams,1)],['CCI 20',fmt(t.cci,1)],['ADX / +DI / −DI',fmt(t.adx,1)+' / '+fmt(t.plus_di,1)+' / '+fmt(t.minus_di,1)]])}${group('VOLATILITY',[['ATR 14',money(t.atr)],['ATR %',fmt(t.atr_pct)+'%'],['Realized vol / bar',pct(t.realized_volatility)],['Bollinger upper',money(t.bb_upper)],['Bollinger lower',money(t.bb_lower)],['Bollinger width',pct(t.bb_width)],['Regime',esc(t.volatility_regime)],['Donchian high / low',money(t.donchian_high)+' / '+money(t.donchian_low)]])}${group('PARTICIPATION',[['RVOL vs prior 20 bars',finite(t.rvol)?fmt(t.rvol)+'×':'—'],['Same-session-slot RVOL',finite(t.same_slot_rvol)?fmt(t.same_slot_rvol)+'×':'Unavailable'],['Same-slot samples',String(t.same_slot_samples)],['MFI 14',fmt(t.mfi,1)],['CMF 20',fmt(t.cmf,3)],['OBV',fmt(t.obv,0)],['Session VWAP proxy',money(t.vwap)],['Anchored VWAP proxy',money(f.reversal?.avwap?.value)]])}</div><details><summary>Channels, slopes and long-term context</summary><div class="tech-grid">${group('CHANNELS',[['Supertrend (10, 3)',money(t.supertrend)],['Ichimoku tenkan / kijun',money(t.tenkan)+' / '+money(t.kijun)],['Current cloud A / B',money(t.cloud_a)+' / '+money(t.cloud_b)]])}${group('EMA SLOPE / BAR',Object.entries(t.ema_slopes).map(([p,x])=>['EMA '+p,fmt(x,3)]))}${group('CONTEXT',[['Long-term trend',esc(t.long_trend)],['MA context',esc(t.golden_death_context)],['New cross',esc(t.cross_event||'None')]])}</div></details><p class="note">Indicators are deterministic calculations on sourced completed bars. OHLCV-weighted VWAP is a proxy for transaction VWAP. Missing warmup values remain unavailable.</p>`;
}
function renderFundamentals(){
  const f=state.fundamentals;$('#fundamentals').innerHTML='<h2>Reported fundamentals</h2>';
  if(!f?.metrics){$('#fundamentals').innerHTML+=`<p class="note">FUNDAMENTALS UNAVAILABLE<br>${esc(f?.reason||f?.error||'No filing facts returned for this ticker.')}</p>`;return;}
  $('#fundamentals').innerHTML+=`<p class="note">${esc(f.provider)} · fetched ${when(f.fetched_at)}</p><div class="table-wrap"><table><thead><tr><th>METRIC</th><th>VALUE</th><th>PERIOD END</th><th>FILED</th></tr></thead><tbody>${Object.entries(f.metrics).map(([k,z])=>{const r=z.latest;return `<tr><td>${esc(k.replaceAll('_',' '))}</td><td>${r?.unit==='ratio'?pct(r.value):fmt(r?.value, r?.unit==='USD/shares'?2:0)} ${esc(r?.unit==='ratio'?'':r?.unit||'')}</td><td>${esc(r?.period_end||'—')}</td><td>${esc(r?.filed||'—')}</td></tr>`;}).join('')}</tbody></table></div><p class="note">Each fact keeps its reporting and filing dates. Annual EPS is not labeled TTM. Missing capex, debt components, or tax rates are not imputed.</p>`;
}
function renderHealth(){
  const f=state.frames['1D']?.provenance||{};$('#health').innerHTML=`<h2>Source & data health</h2>${pill(state.health.status)}<div class="health-line"><b>Retrieval:</b> ${esc(raw.retrieval||'GitHub Actions snapshot')}</div><div class="health-line"><b>History:</b> ${esc(f.provider||'Unavailable')}</div><div class="health-line"><b>Fetched:</b> ${when(f.fetched_at)}<br><b>Last completed bar:</b> ${when(f.last_completed_bar)}</div><div class="health-line"><b>Adjustment:</b> ${esc(f.adjustment||'Unavailable')}</div><div class="health-line"><b>Latency:</b> ${esc(f.delay||'Unspecified')}</div>${f.source_url?`<a href="${esc(f.source_url)}" target="_blank" rel="noreferrer">Open price-history source ↗</a>`:''}<details><summary>Component availability & market context</summary>${Object.values(state.frames).map(z=>line(z.timeframe,esc(z.status)+' · '+z.bars.length+' bars')).join('')}${state.market_context.map(z=>line(z.symbol+' trend',esc(z.trend||z.status))).join('')}${state.market_context.map(z=>line('RS vs '+z.symbol+' / 63 sessions',pct(z.relative_strength_63))).join('')}<p class="note">${state.provider_errors.map(e=>esc(e.provider+': '+(e.error||''))).join('<br>')||'No provider error reported.'}</p></details><p class="note">Public browser endpoints have no uptime guarantee. A cached supplement never proves a live quote. Stale data suppresses entry actions.</p>`;
}
function renderLedger(){
  const rows=readLocalLedger().filter(r=>r.setup.symbol===state.symbol).slice(-20).reverse(),b=state.frames['1D'].bars;
  $('#ledger').innerHTML=`<h2>Immutable setup history · this browser</h2><p class="note">Issued plans preserve entry, stop, targets, model version and data timestamp. Updated market structure creates a new setup ID. Clearing browser storage removes this local history; scheduled plans are preserved separately in GitHub.</p>`;
  if(!rows.length){$('#ledger').innerHTML+='<p class="note">No qualifying setup has been issued for this ticker in this browser.</p>';return;}
  $('#ledger').innerHTML+=`<div class="table-wrap"><table><thead><tr><th>ISSUED</th><th>MODE / DIRECTION</th><th>ENTRY</th><th>STOP</th><th>TP1</th><th>TP2</th><th>STATE</th></tr></thead><tbody>${rows.map(r=>{const s=r.setup,i=b.findIndex(b=>b.end_ts===s.signal_ts);let outcome=i>=0?resolveSetup(b,s,i):{state:'HISTORY UNAVAILABLE'};return `<tr><td>${when(r.issued_at)}</td><td>${esc(s.mode)} / ${s.direction}</td><td>${money(s.entry_zone.low)}–${money(s.entry_zone.high)}</td><td>${money(s.stop)}</td><td>${money(s.targets[0]?.price)}</td><td>${money(s.targets[1]?.price)}</td><td>${esc(outcome.state)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
async function load(symbol){
  symbol=String(symbol||'').trim().toUpperCase();const id=++requestId;
  controller?.abort();worker?.terminate();controller=new AbortController();$('#ticker').value=symbol;emptyPanels(symbol,'Retrieving this ticker’s source data…');
  $('#load-status').textContent=`${symbol} · Retrieving public price/history and optional data supplements…`;
  try{
    if(!calendar)throw new Error('Exchange calendar is not available.');
    const result=await retrieveTicker(symbol,calendar,controller.signal,{snapshotBase:'../data/raw/'});if(id!==requestId)return;raw=result;
    $('#load-status').textContent=`${symbol} · Source data received. Calculating completed-bar technicals and structure…`;
    worker=new Worker('./worker.mjs',{type:'module'});
    worker.onmessage=event=>{if(event.data.id!==requestId)return;if(event.data.error){$('#load-status').textContent=event.data.error;return;}
      state=event.data.analysis;rememberSetups();render();$('#load-status').textContent=`${symbol} · ${raw.retrieval||'Sourced snapshot'} · calculated ${when(state.generated_at)} · confirmed signals use completed bars.`;
      for(const b of $('#watchlist').querySelectorAll('button'))b.classList.toggle('active',b.textContent===symbol);
      const url=new URL(location.href);url.searchParams.set('ticker',symbol);history.replaceState(null,'',url);
    };
    worker.onerror=e=>{if(id===requestId)$('#load-status').textContent='Analysis failed: '+e.message;};
    worker.postMessage({id,raw,benchmarks});
  }catch(error){if(id!==requestId||error.name==='AbortError')return;emptyPanels(symbol,'DATA UNAVAILABLE');$('#load-status').innerHTML=`<span class="error">${esc(error.message)}</span>`;}
}
$('#ticker-form').addEventListener('submit',e=>{e.preventDefault();load($('#ticker').value);});$('#refresh').onclick=()=>load($('#ticker').value);
for(const id of ['mode','horizon','timeframe'])$('#'+id).onchange=render;
for(const checkbox of document.querySelectorAll('.overlays input'))checkbox.onchange=chartData;
async function boot(){
  try{
    const results=await Promise.allSettled([fetch('../data/calendar.json').then(r=>{if(!r.ok)throw Error('Calendar HTTP '+r.status);return r.json();}),fetch('../config/watchlist.json').then(r=>r.json()),fetch('../build.json').then(r=>r.json())]);
    if(results[0].status!=='fulfilled')throw new Error('Exchange calendar failed to load.');calendar=results[0].value;config=results[1].status==='fulfilled'?results[1].value:{symbols:[]};build=results[2].status==='fulfilled'?results[2].value:null;
    $('#build').textContent=build?`v${build.model_version} · ${build.commit.slice(0,8)}`:'Build metadata unavailable';
    $('#watchlist').innerHTML=config.symbols.slice(0,16).map(s=>`<button type="button">${esc(s)}</button>`).join('');
    for(const b of $('#watchlist').querySelectorAll('button'))b.onclick=()=>load(b.textContent);
    for(const symbol of ['SPY','QQQ'])fetch('../data/raw/'+symbol+'.json').then(r=>r.ok?r.json():null).then(r=>{if(r?.symbol===symbol)benchmarks[symbol]=r;}).catch(()=>{});
    fetch('../data/index.json').then(r=>r.json()).then(j=>{$('#ranking').innerHTML=`<h2>Scheduled swing scan</h2><p class="note">${when(j.generated_at)} · Watchlist scanning is independent of arbitrary ticker analysis.</p><div class="table-wrap"><table><thead><tr><th>TICKER</th><th>STATE</th><th>GRADE</th><th>SCORE</th><th>ENTRY</th><th>STOP</th><th>TP1</th><th>DATA</th></tr></thead><tbody>${(j.symbols||[]).sort((a,b)=>(b.score||0)-(a.score||0)).map(x=>`<tr><td><a href="?ticker=${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a></td><td>${esc(x.action)}</td><td>${esc(x.grade||'—')}</td><td>${fmt(x.score,0)}</td><td>${x.entry?money(x.entry.low)+'–'+money(x.entry.high):'—'}</td><td>${money(x.stop)}</td><td>${money(x.tp1)}</td><td>${esc(x.health)}</td></tr>`).join('')}</tbody></table></div>`;}).catch(()=>{$('#ranking').innerHTML='<h2>Scheduled scan</h2><p class="note">Scheduled scan unavailable. Any-ticker entry remains available.</p>';});
    await load(new URLSearchParams(location.search).get('ticker')||'NVDA');
  }catch(e){$('#load-status').textContent=e.message;}
}
boot();
