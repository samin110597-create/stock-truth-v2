import {retrieveTicker} from '../src/providers.mjs';
import {finite} from '../src/numeric.mjs';
import {setupIdentity} from '../src/setups.mjs';
import {resolveSetup} from '../src/validation.mjs';
import {positionSize} from '../src/risk.mjs';
import {$,esc,fmt,money,pct,compact,when,cls,pill,metric,line} from './ui.mjs';
import {clearChart,renderChart} from './chart.mjs';
import {retrieveFundamentals} from '../src/fundamentals.mjs';
import {renderFundamentals} from './fundamentals-panel.mjs';
import {renderWavePanels,renderForecast} from './research-panels.mjs';
import {renderTechnicals} from './technicals-panel.mjs';
let state=null,raw=null,calendar=null,config={symbols:[]},build=null,worker=null,controller=null,requestId=0,view='verdict';
const benchmarks={};
const panelIds=['wyckoff','elliott','forecast','decision','evidence','trade-matrix','thesis','mtf','reversal','patterns','technicals','levels','fundamentals','valuation','catalysts','horizons','validation','ledger','health'];
const selected=()=>({mode:$('#mode').value,horizon:$('#horizon').value,key:$('#mode').value+'_'+$('#horizon').value,tf:$('#timeframe').value});
const plan=()=>state?.setups?.[selected().key]?.setup;
const table=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const cell=(s,wrap=false)=>`<td${wrap?' class="wrap"':''}>${s}</td>`;
const row=(...cells)=>'<tr>'+cells.map(s=>cell(s)).join('')+'</tr>';
function selectView(next){
  view=next;
  for(const el of document.querySelectorAll('[data-views]'))el.hidden=!el.dataset.views.split(' ').includes(view);
  for(const b of $('#tabs').querySelectorAll('[data-view]')){b.setAttribute('aria-selected',String(b.dataset.view===view));b.tabIndex=b.dataset.view===view?0:-1;}
  if(state&&['verdict','technicals'].includes(view))requestAnimationFrame(()=>renderChart(state,selected().tf,plan()));
}
function clear(symbol,message){
  state=null;raw=null;$('#brief').disabled=true;
  $('#identity').innerHTML=`<h1>${esc(symbol)}</h1><p class="note">${esc(message)}</p>`;$('#identity').setAttribute('aria-busy','true');
  for(const id of panelIds)$('#'+id).innerHTML='';
  clearChart(message);$('#risk-result').textContent='A confirmed plan is required for position sizing.';
  document.title=`${symbol} · Stock Truth`;
}
function readLedger(){try{const r=JSON.parse(localStorage.getItem('stocktruth-ledger-v5')||'[]');return Array.isArray(r)?r:[];}catch{return[];}}
function remember(){
  if(!state?.health.tradeable)return;
  const rows=readLedger();for(const item of Object.values(state.setups)){const p=item.setup;
    if(!p||p.live_check?.stop_tested||p.live_check?.target_tested)continue;
    const id=setupIdentity(p);if(!rows.some(r=>r.id===id))rows.push({id,issued_at:new Date().toISOString(),setup:structuredClone(p)});
  }
  try{localStorage.setItem('stocktruth-ledger-v5',JSON.stringify(rows));}catch{}
}
function identity(){
  const q=state.quote||{},d=state.frames['1D'],last=d.bars.at(-1),previous=d.bars.at(-2);
  const price=finite(q.price)?q.price:last?.close,change=finite(q.change_pct)?q.change_pct:previous?(last.close/previous.close-1)*100:null;
  $('#identity').innerHTML=`<div class="identity-top"><div class="identity-name"><div><h1>${esc(state.symbol)}</h1><div class="sub">${esc(state.name||state.symbol)} ${q.exchange?'· '+esc(q.exchange):''}</div></div><div><div class="price">${money(price)}</div><span class="${change>=0?'up':'down'}">${finite(change)?(change>=0?'+':'')+fmt(change)+'%':''}</span> <span class="mini">${finite(q.price)?'sourced quote':'last completed close'}</span></div></div><div class="source">${pill(state.market?.state||'UNAVAILABLE')}${pill(state.health.status)}<div class="mini">${esc(finite(q.price)?q.provider:d.provenance?.provider)}<br>${when(finite(q.price)?q.as_of:last?.end_ts)} · provider latency unspecified</div></div></div><div class="market-strip">${metric('Session volume',compact(q.volume),'Quote source; may be delayed')}${metric('Session high / low',money(q.high)+' / '+money(q.low),q.session_date||'Unavailable')}${metric('ATR 14',money(d.technicals?.atr),'Completed daily bars')}${metric('Daily RVOL',finite(d.technicals?.rvol)?fmt(d.technicals.rvol)+'×':'—','Versus prior 20 bars')}${metric('Market cap',compact(state.fundamentals?.summary?.price?.marketCap||q.market_cap),state.fundamentals?.summary?.price?.lastCloseDate||'Unavailable without sourced cap')}${metric('History',compact(d.bars.length)+' bars','Last completed '+(last?.date||'unavailable'))}</div>`;
  $('#identity').setAttribute('aria-busy','false');
}
function verdict(){
  const p=plan(),read=state.read,key=selected().key,item=state.setups[key];
  const action=p?.current_action||(!state.health.tradeable?'WAIT — '+state.health.status:'WAIT — NO QUALIFYING SETUP');
  $('#decision').innerHTML=`<div><h2>The read <span class="tag">TECHNICAL STANCE</span></h2><div class="read ${cls(read.label)}">${esc(read.label)}</div>${pill(read.phase)}<div class="stance-meter"><i style="left:${Math.min(50,50+(read.signed_score||0)/2)}%;width:${Math.abs(read.signed_score||0)/2}%;background:${(read.signed_score||0)>=0?'var(--up)':'var(--down)'}"></i></div><p class="note">${esc(read.note||'No data available.')}</p><p class="mini">Evidence coverage ${read.coverage}/100 · five grouped families</p></div><div class="decision-detail"><h2>${esc(selected().mode)} ${esc(selected().horizon)} plan ${pill(p?.direction||'NO ACTIVE PLAN')}</h2><div class="action ${cls(action)}">${esc(action)}</div>${pill(p?.grade||'NO EDGE')}${pill(p?.confidence||state.validation[key]?.status||'INSUFFICIENT DATA')}<div class="metrics">${metric(p?.dir<0?'Short entry zone':'Buy / entry zone',p?money(p.entry_zone.low)+'–'+money(p.entry_zone.high):'—',p?.kind||'Confirmation required')}${metric('Fixed stop',money(p?.stop),p?'Signal '+when(p.signal_ts):'Structural invalidation required')}${metric('TP1',money(p?.targets[0]?.price),p?'R:R '+fmt(p.targets[0].risk_reward)+'×':'No fabricated target')}${metric('TP2 / TP3',money(p?.targets[1]?.price)+' / '+money(p?.targets[2]?.price),'Only justified structural levels')}</div><p class="note">${esc(p?.confirmation||item?.reason||'No current setup.')}</p>${p?`<p class="mini">${esc(p.invalidation)} ${esc(p.wait_reason)}</p>`:''}</div>`;
  const evidence=(title,list,color)=>`<div class="panel"><h2>${title}</h2>${list.length?list.map(e=>`<div class="evidence-row"><div><b class="${color}">${esc(e.name.toUpperCase())}</b><small>${esc(e.detail)}</small></div><span class="weight">${e.weight}% weight</span></div>`).join(''):'<p class="note">No directional evidence in this group.</p>'}</div>`;
  $('#evidence').innerHTML=evidence('What argues up',read.bull,'up')+evidence('What argues down',read.bear,'down');
  const t=state.thesis;$('#thesis').innerHTML=`<h2>Price action thesis</h2><div><h3>Current state</h3><p>${esc(t.current)}</p></div><div><h3>Bull case</h3><p>${esc(t.bull)}</p></div><div><h3>Base case</h3><p>${esc(t.base)}</p></div><div><h3>Bear case</h3><p>${esc(t.bear)}</p></div><div class="best"><h3>Best action ${p?'· '+esc(p.direction):''}</h3><p>${esc(action)}</p></div><p class="mini">Scenarios are conditional interpretations. A stance score is not a probability.</p>`;
}
function tradeMatrix(){
  $('#trade-matrix').innerHTML=`<h2>Trade matrix <span class="tag">STRICT + ADAPTIVE · FIXED PLANS</span></h2><div class="trade-cards">${['Adaptive_SWING','Strict_SWING','Adaptive_POSITION','Strict_POSITION'].map(key=>{const item=state.setups[key],p=item?.setup,v=state.validation[key];return `<article class="trade-card ${key===selected().key?'selected':''}"><h2>${esc(key.replace('_',' '))}</h2>${pill(p?.direction||'WAIT')}${pill(p?.grade||'NO EDGE')}<div class="action">${esc(p?.current_action||'WAIT FOR CONFIRMATION')}</div><div class="metrics">${metric('Entry',p?money(p.entry_zone.low)+'–'+money(p.entry_zone.high):'—')}${metric('Stop',money(p?.stop))}${metric('TP1',money(p?.targets[0]?.price),p?fmt(p.targets[0].risk_reward)+'R':'')}${metric('TP2',money(p?.targets[1]?.price))}${metric('TP3',money(p?.targets[2]?.price))}${metric('Evidence',p?p.score+'/100':'—','Not probability')}</div><p class="mini">${esc(v?.status||'INSUFFICIENT DATA')} · ${v?.n||0} effective samples</p><button data-plan="${key}" type="button">Use this view</button><p class="note">${esc(p?.kind||item?.reason||'No completed-bar setup.')}</p></article>`;}).join('')}</div>`;
  for(const button of $('#trade-matrix').querySelectorAll('[data-plan]'))button.onclick=()=>{const [mode,horizon]=button.dataset.plan.split('_');$('#mode').value=mode;$('#horizon').value=horizon;render();};
}
function risk(){
  const p=plan(),number=id=>$('#'+id).value.trim()?Number($('#'+id).value):null;
  if(!p){$('#risk-result').textContent='No confirmed plan to size. A technical BUY/SELL stance alone does not create an entry.';return;}
  const r=positionSize({capital:number('risk-capital'),riskPct:number('risk-pct'),maxAllocationPct:number('risk-allocation'),entry:p.entry_reference,stop:p.stop,dir:p.dir});
  if(r.status!=='CALCULATED'){$('#risk-result').textContent='Enter account value, risk %, and allocation %. This uses the selected '+p.direction+' plan’s conservative entry and fixed stop.';return;}
  $('#risk-result').innerHTML=`<div class="metrics">${metric('Whole shares',fmt(r.shares,0),p.direction+' · '+money(p.entry_reference))}${metric('Planned risk',money(r.planned_loss),'Budget '+money(r.risk_budget))}${metric('Notional',money(r.notional),pct(r.allocation_pct/100)+' allocation')}${metric('Current plan state',esc(p.current_action),'Sizing does not authorize entry')}</div><p class="note">${esc(r.note)}</p>`;
}
function mtf(){
  $('#mtf').innerHTML=`<h2>Multi-timeframe alignment</h2><div class="alignments">${Object.entries(state.alignment).map(([k,a])=>`<span>${esc(k.toUpperCase())} ${pill(a.label)} <span class="mini">${a.available}/${a.requested} usable</span></span>`).join('')}</div>${table(['Timeframe','Trend','Structure','RSI','Volatility','Support / resistance','Reversal','Data'],Object.values(state.frames).map(f=>row(`<button class="tf-button" data-tf="${f.timeframe}">${f.timeframe}</button>`,`<span class="${cls(f.technicals?.intermediate_trend||'')}">${esc(f.technicals?.intermediate_trend||'UNAVAILABLE')}</span>`,esc(f.structure?.pattern||'—'),fmt(f.technicals?.rsi,1),esc(f.technicals?.volatility_regime||'—'),money(f.structure?.support[0]?.price)+' / '+money(f.structure?.resistance[0]?.price),esc(f.reversal?.dir? (f.reversal.dir>0?'↑ ':'↓ ')+f.reversal.stage:f.reversal?.stage||'—'),pill(f.status))))}<p class="note">Stale or reviewed frames are excluded from alignment. The selected chart timeframe never changes the swing/position holding horizon.</p>`;
  for(const button of $('#mtf').querySelectorAll('[data-tf]'))button.onclick=()=>{$('#timeframe').value=button.dataset.tf;selectView('technicals');render();};
}
function technicalPanels(){
  const tf=selected().tf,f=state.frames[tf],r=f.reversal;
  const descriptions={absorption:'High relative volume and lower-wick rejection near the prior low.',distribution:'High relative volume and upper-wick rejection near the prior high.',capitulation:'Extreme relative volume and range into a falling-price low, followed by rejection.',buying_climax:'Extreme volume and range into a rising-price high, followed by rejection.'};
  $('#reversal').innerHTML=`<h2>Reversal & participation · ${tf}</h2>${pill(r?.dir?(r.dir>0?'BULLISH ':'BEARISH ')+r.stage:r?.stage||'UNAVAILABLE')}<div class="proxy-grid">${Object.entries(descriptions).map(([k,desc])=>`<div class="proxy"><b>${esc(k.replaceAll('_',' '))} proxy</b>${pill(r?.proxies?.[k]===true?'DETECTED':r?.proxies?.[k]===false?'NOT DETECTED':'UNAVAILABLE')}<p class="note">${desc}</p></div>`).join('')}</div><h3>What supports the reversal state?</h3>${r?.evidence?.length?r.evidence.map(e=>`<div class="evidence-row"><div>${esc(e.name)}<small>${esc(e.detail||'Completed-bar momentum confirmation.')}</small></div>${pill(e.classification)}</div>`).join(''):'<p class="note">No supported reversal evidence. Oversold or overbought alone is not a reversal.</p>'}<p class="note">Strict reversal requires a surviving sweep, divergence and later structural break. Breaching the sweep extreme retires that evidence. These are price/volume proxies, not observed institutional transactions.</p>`;
  $('#patterns').innerHTML=`<h2>Recent signals & candle context · ${tf}</h2>${table(['Signal','Known at','Level / rule'],(f.events||[]).slice(-10).reverse().map(e=>`<tr>${cell(esc(e.type))}${cell(when(e.confirmed_ts))}${cell(money(e.level))}</tr>`).concat((f.context?.patterns||[]).map(p=>`<tr>${cell(esc(p.name))}${cell(when(p.ts))}${cell(esc(p.rule),true)}</tr>`)))}<p class="note">Named candle formations are descriptive calculations; they do not independently validate a trade.</p>`;
  renderTechnicals(f,tf);
  renderWavePanels(f,tf);
  $('#levels').innerHTML=`<h2>Structural levels & imbalance proxies · ${tf}</h2><div class="grid-two"><div><h3>Support / demand reference</h3>${table(['Price','Quality','Reactions'],(f.structure?.support||[]).map(x=>row(money(x.price),x.quality+'/100',String(x.touches))))}</div><div><h3>Resistance / supply reference</h3>${table(['Price','Quality','Reactions'],(f.structure?.resistance||[]).map(x=>row(money(x.price),x.quality+'/100',String(x.touches))))}</div></div><h3>Unfilled three-candle gaps</h3>${f.context?.gaps?.length?table(['Direction','Zone','First observed','State'],f.context.gaps.map(g=>row(g.dir>0?'Bullish proxy':'Bearish proxy',money(g.low)+'–'+money(g.high),when(g.known_at),g.partially_tested?'Partially tested':'Untested'))):'<p class="note">No qualifying unfilled gap in the last 100 completed bars.</p>'}<p class="note">Gaps are visible OHLC geometry, not proof of an institutional order block. Swing quality weights ATR impulse, spacing, volume and displacement; pivot counts are not distinct institutional orders.</p>`;
}
function fundamentalPanels(){renderFundamentals(state);}
function modelPanels(){
  renderForecast(state);
  const v=state.validation[selected().key];
  $('#horizons').innerHTML=`<h2>Multi-horizon research <span class="tag">OBSERVED HISTORY · NOT FORECAST ODDS</span></h2><div class="horizon-cards">${(state.horizons||[]).map(h=>`<article class="trade-card"><h2>${h.label}</h2>${pill(h.status)}<div class="metrics">${metric('Samples',String(h.n))}${metric('Positive return frequency',pct(h.positive_frequency),'Descriptive, not probability')}${metric('Median return',pct(h.median))}${metric('20th–80th percentile',pct(h.p20)+' / '+pct(h.p80))}</div></article>`).join('')}</div><p class="note">${esc(state.horizons?.[0]?.method||'Insufficient data.')} These are close-to-close returns; target-before-stop frequencies below measure a different outcome.</p>`;
  $('#validation').innerHTML=`<h2>Setup validation · ${esc(selected().mode)} ${esc(selected().horizon)}</h2>${pill(v?.status||'INSUFFICIENT DATA')}<p class="note">${esc(v?.validation_kind||'Insufficient history.')}</p><div class="metrics">${metric('Effective entered samples',String(v?.n||0),'Non-overlapping setups')}${metric('TP1 frequency',pct(v?.metrics?.[0]?.frequency),'TP1 before stop')}${metric('TP2 frequency',pct(v?.metrics?.[1]?.frequency),'TP2 before stop')}${metric('TP1 95% Wilson interval',pct(v?.metrics?.[0]?.ci95?.low)+'–'+pct(v?.metrics?.[0]?.ci95?.high))}${metric('Mean net TP1 result',finite(v?.metrics?.[0]?.mean_net_r)?fmt(v.metrics[0].mean_net_r)+'R':'—','Assumed 10 bps per side')}${metric('Coverage',pct(v?.coverage),'Signals / eligible observations')}${metric('Stop/target collisions',String(v?.ambiguous_stop_count||0),'Stop wins uncertain ordering')}${metric('Calibrated direction probability','Unavailable','No verified probability model')}</div><details><summary>Method, chronological folds and limitations</summary><p class="note">${esc(v?.methodology||'Insufficient data.')} ${esc(v?.collision_policy||'')}</p>${(v?.folds||[]).map(f=>line('Fold '+f.fold,f.n+' samples · TP1 '+pct(f.t1_frequency))).join('')}<p class="note">Brier skill and balanced accuracy are unavailable. Fixed-rule retrospective replay is not untouched out-of-sample evidence. This release makes no higher-win-rate claim.</p></details>`;
  const b=state.frames['1D'].bars,rows=readLedger().filter(r=>r.setup?.symbol===state.symbol).slice(-30).reverse();
  $('#ledger').innerHTML=`<h2>Issued setup history · this browser</h2><p class="note">Entry, stop and targets are stored once under a versioned ID. Refreshes observe the same plan. Original model versions remain visible and are never silently rewritten.</p>${rows.length?table(['Signal','Model / mode','Direction','Entry','Stop','TP1 / TP2','Observed state'],rows.map(r=>{const p=r.setup,i=b.findIndex(x=>x.end_ts===p.signal_ts),result=i>=0?resolveSetup(b,p,i):{state:'HISTORY UNAVAILABLE'};return row(when(p.signal_ts),esc(p.model_version)+' / '+esc(p.mode),pill(p.direction),money(p.entry_zone.low)+'–'+money(p.entry_zone.high),money(p.stop),money(p.targets[0]?.price)+' / '+money(p.targets[1]?.price),esc(result.state));})):'<p class="note">No qualifying plan recorded for this ticker.</p>'}`;
}
function sources(){
  const d=state.frames['1D'].provenance||{};
  $('#health').innerHTML=`<h2>Sources & data integrity</h2>${pill(state.health.status)}<div class="health-line"><b>Retrieval:</b> ${esc(raw.retrieval)}<br><b>Model:</b> ${esc(state.model_version)}<br><b>Build:</b> ${esc(build?.commit||'Unavailable')}<br><b>Calculated:</b> ${when(state.generated_at)}<br><b>Daily history:</b> ${esc(d.provider||'Unavailable')}<br><b>Source fetched:</b> ${when(d.fetched_at)}<br><b>Last completed bar:</b> ${when(d.last_completed_bar)}<br><b>Adjustment:</b> ${esc(d.adjustment||'Unavailable')}</div>${d.source_url?`<a href="${esc(d.source_url)}" target="_blank" rel="noreferrer">Open price-history source ↗</a>`:''}${raw.cross_check?`<h3>Longer-history reconciliation</h3><p class="note">${esc(raw.cross_check.status)} · ${raw.cross_check.overlap||0} overlapping dates · largest OHLC difference ${pct(raw.cross_check.max_ohlc_difference)} · ${raw.cross_check.appended||0} recent bars appended. No price is rescaled. Per-bar source labels are preserved.</p>`:''}${table(['Component','Status','Bars','Last completed','Provider'],Object.values(state.frames).map(f=>row(f.timeframe,pill(f.status),fmt(f.bars.length,0),when(f.provenance?.last_completed_bar),esc(f.provenance?.provider||'Unavailable'))))}<h3>Market & sector context</h3>${table(['Benchmark','Trend','63-session relative strength','Status','As of'],state.market_context.map(c=>row(esc(c.symbol),esc(c.trend||'Unavailable'),pct(c.relative_strength_63),pill(c.status),when(c.as_of))))}<p class="note">Sector ETFs are explicit comparison proxies. Stale benchmark data is labeled and not used to override the stock's setup.</p><h3>Component errors</h3><p class="note">${state.provider_errors.map(e=>esc(e.provider+': '+e.error)).join('<br>')||'No direct provider error reported.'}</p><p class="note">Stock Analysis and Yahoo endpoints are unofficial and best effort. No private provider key is exposed. Unsupported data stays unavailable; watchlist membership never gates analysis.</p>`;
}
function render(){
  if(!state)return;
  const renderers=[identity,verdict,tradeMatrix,risk,mtf,technicalPanels,fundamentalPanels,modelPanels,sources];
  const errors=[];for(const fn of renderers)try{fn();}catch(e){errors.push(fn.name+': '+e.message);console.error(fn.name,e);}
  if(['verdict','technicals'].includes(view))renderChart(state,selected().tf,plan());
  selectVisibility();$('#brief').disabled=false;return errors;
}
function selectVisibility(){for(const el of document.querySelectorAll('[data-views]'))el.hidden=!el.dataset.views.split(' ').includes(view);}
async function load(symbol){
  symbol=String(symbol||'').trim().toUpperCase();const id=++requestId;
  controller?.abort();worker?.terminate();controller=new AbortController();$('#ticker').value=symbol;
  clear(symbol,'Retrieving data for this ticker…');$('#load-status').textContent=symbol+' · fetching public quote/history and optional supplements…';
  try{
    if(!calendar)throw Error('Exchange calendar is unavailable.');
    const fundamentalTask=retrieveFundamentals(symbol,controller.signal).catch(e=>({symbol,status:'UNAVAILABLE',reason:e.message}));
    const result=await retrieveTicker(symbol,calendar,controller.signal);if(id!==requestId)return;raw=result;
    if(!raw.fundamentals?.metrics)raw.fundamentals={...raw.fundamentals,status:'LOADING'};
    fundamentalTask.then(f=>{if(id!==requestId||!raw)return;
      if(f.status==='UNAVAILABLE'&&raw.fundamentals?.metrics)raw.fundamentals={...raw.fundamentals,status:'STALE',latest_attempt_error:f.reason,errors:[f.reason]};
      else raw.fundamentals=f;
      if(f.summary?.name)raw.name=f.summary.name;
      if(state?.symbol===symbol){state.fundamentals=raw.fundamentals;state.name=raw.name;identity();fundamentalPanels();}
    });
    $('#load-status').textContent=symbol+' · calculating technicals, confirmed structures and trade plans…';
    worker=new Worker('./worker.mjs',{type:'module'});
    worker.onmessage=event=>{if(event.data.id!==requestId)return;if(event.data.error){clear(symbol,'Analysis unavailable');$('#load-status').textContent=event.data.error;return;}
      state=event.data.analysis;state.fundamentals=raw.fundamentals;state.name=raw.name;remember();const errors=render();$('#load-status').textContent=errors.length?'Panel unavailable: '+errors.join('; '):`${symbol} · ${raw.retrieval} · calculated ${when(state.generated_at)} · completed-bar signals`;
      for(const b of $('#watchlist').querySelectorAll('button'))b.classList.toggle('active',b.textContent===symbol);
      const url=new URL(location.href);url.searchParams.set('ticker',symbol);history.replaceState(null,'',url);
    };
    worker.onerror=e=>{if(id===requestId){clear(symbol,'Analysis unavailable');$('#load-status').textContent='Analysis failed: '+e.message;}};
    // Benchmarks are supplementary; cached reads do not delay arbitrary ticker retrieval.
    const needed=['SPY','QQQ',config.sectorProxies?.[symbol]].filter(Boolean);
    worker.postMessage({id,raw,benchmarks:Object.fromEntries(needed.filter(s=>benchmarks[s]).map(s=>[s,benchmarks[s]]))});
  }catch(e){if(id!==requestId||e.name==='AbortError')return;clear(symbol,'DATA UNAVAILABLE');$('#identity').setAttribute('aria-busy','false');$('#load-status').textContent=e.message;}
}
async function scan(){
  try{const response=await fetch('../data/index.json',{cache:'no-cache'});if(!response.ok)throw Error('No scan');const j=await response.json();
    $('#ranking').innerHTML=`<h2>Watchlist ranked <span class="tag">${j.symbols.length} SCANNED</span></h2><p class="note">Scheduled snapshot ${when(j.generated_at)}. Open a ticker to recalculate from its latest available data. This list does not limit ticker search.</p>${table(['Ticker','Action','Direction','Grade','Score','Entry','Stop','TP1','Data'],j.symbols.sort((a,b)=>(b.score||0)-(a.score||0)).map(x=>row(`<button data-symbol="${esc(x.symbol)}" class="tf-button">${esc(x.symbol)}</button>`,esc(x.action),pill(x.direction||'UNAVAILABLE'),esc(x.grade||'—'),fmt(x.score,0),x.entry?money(x.entry.low)+'–'+money(x.entry.high):'—',money(x.stop),money(x.tp1),pill(x.health))))}`;
    for(const b of $('#ranking').querySelectorAll('[data-symbol]'))b.onclick=()=>{selectView('verdict');load(b.dataset.symbol);};
  }catch{$('#ranking').innerHTML='<h2>Watchlist ranked</h2><p class="note">Scheduled scan unavailable. Analyze any ticker using the input above.</p>';}
}
$('#ticker-form').onsubmit=e=>{e.preventDefault();load($('#ticker').value);};$('#refresh').onclick=()=>load($('#ticker').value);
for(const id of ['mode','horizon','timeframe'])$('#'+id).onchange=render;
for(const c of document.querySelectorAll('.overlays input'))c.onchange=()=>{if(state)renderChart(state,selected().tf,plan());};
for(const b of $('#tabs').querySelectorAll('[data-view]')){b.onclick=()=>selectView(b.dataset.view);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...$('#tabs').querySelectorAll('[data-view]')],i=tabs.indexOf(b),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].focus();selectView(tabs[next].dataset.view);};}
for(const id of ['risk-capital','risk-pct','risk-allocation'])$('#'+id).oninput=risk;
$('#brief').onclick=()=>{if(!state)return;const p=plan(),blob=new Blob([JSON.stringify({symbol:state.symbol,model:state.model_version,source_timestamp:state.source_data_timestamp,quote:state.quote,read:state.read,thesis:state.thesis,plan:p,validation:state.validation[selected().key],data_health:state.health,wyckoff:state.frames[selected().tf]?.wyckoff,elliott:state.frames[selected().tf]?.elliott,forecast:state.forecast,fundamentals:state.fundamentals},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=state.symbol+'-stock-truth-research.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function boot(){
  selectView('verdict');
  try{
    const results=await Promise.allSettled([fetch('../data/calendar.json').then(r=>{if(!r.ok)throw Error('Calendar missing');return r.json();}),fetch('../config/watchlist.json').then(r=>r.json()),fetch('../build.json',{cache:'no-cache'}).then(r=>r.json())]);
    if(results[0].status!=='fulfilled')throw Error('Exchange calendar failed to load.');calendar=results[0].value;
    if(results[1].status==='fulfilled')config=results[1].value;if(results[2].status==='fulfilled')build=results[2].value;
    $('#build').textContent=build?(build.research_version||build.model_version)+' · '+build.commit.slice(0,8):'Build unavailable';
    $('#watchlist').innerHTML=config.symbols.slice(0,20).map(s=>`<button type="button">${esc(s)}</button>`).join('');for(const b of $('#watchlist').querySelectorAll('button'))b.onclick=()=>load(b.textContent);
    for(const symbol of ['SPY','QQQ',...new Set(Object.values(config.sectorProxies||{}))])fetch('../data/raw/'+symbol+'.json').then(r=>r.ok?r.json():null).then(r=>{if(r?.symbol===symbol)benchmarks[symbol]=r;}).catch(()=>{});
    scan();await load(new URLSearchParams(location.search).get('ticker')||'NVDA');
  }catch(e){$('#load-status').textContent=e.message;}
}
boot();
