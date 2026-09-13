import {createChart,CandlestickSeries,LineSeries,HistogramSeries,createSeriesMarkers} from '../vendor/lightweight-charts.mjs';
import {technicals,anchoredVwap} from '../src/technicals.mjs';
import {finite} from '../src/numeric.mjs';
import {$,money,fmt,compact,when,esc} from './ui.mjs';
let chart=null,key=null;
export function clearChart(message='Loading…'){
  if(chart)chart.remove();chart=null;key=null;
  $('#chart').innerHTML=`<div class="empty">${esc(message)}</div>`;
  for(const k of ['data-symbol','data-bars','data-last-close','data-last-date'])$('#chart').removeAttribute(k);
  $('#chart-note').textContent='';$('#chart-detail').textContent='';
}
export function renderChart(state,tf,plan){
  const host=$('#chart'),f=state?.frames?.[tf],id=state?.symbol+':'+tf;
  const previous=chart&&key===id?chart.timeScale().getVisibleLogicalRange():null;
  clearChart();key=id;
  if(!f?.bars?.length){clearChart(tf+' UNAVAILABLE — other timeframes remain usable.');return;}
  host.innerHTML='';
  chart=createChart(host,{autoSize:true,layout:{background:{color:'#181b21'},textColor:'#a0a4af',fontSize:11,attributionLogo:true,panes:{separatorColor:'#30343d',separatorHoverColor:'#5e626c'}},grid:{vertLines:{color:'#22262d'},horzLines:{color:'#22262d'}},rightPriceScale:{borderColor:'#343944',scaleMargins:{top:.1,bottom:.22}},timeScale:{borderColor:'#343944',timeVisible:!['1D','1W','1M'].includes(tf)},crosshair:{mode:0}});
  const data=f.bars,intraday=!['1D','1W','1M'].includes(tf),time=b=>intraday?b.ts:b.date;
  const candles=chart.addSeries(CandlestickSeries,{upColor:'#66c595',downColor:'#ef8585',borderVisible:false,wickUpColor:'#66c595',wickDownColor:'#ef8585',priceFormat:{type:'price',precision:2,minMove:.01}});
  candles.setData(data.map(b=>({time:time(b),open:b.open,high:b.high,low:b.low,close:b.close})));
  const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume'});
  volume.priceScale().applyOptions({scaleMargins:{top:.85,bottom:0}});
  volume.setData(data.filter(b=>finite(b.volume)).map(b=>({time:time(b),value:b.volume,color:b.close>=b.open?'#2e5142':'#553739'})));
  const addLevel=(v,color,title)=>{if(finite(v))candles.createPriceLine({price:v,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title});};
  const addLine=(values,color,title,pane=0)=>{const s=chart.addSeries(LineSeries,{color,lineWidth:1,lastValueVisible:false,priceLineVisible:false,title},pane);s.setData(values.map((v,i)=>finite(v)?{time:time(data[i]),value:v}:null).filter(Boolean));return s;};
  const t=technicals(data,tf);
  if($('#overlay-levels').checked){addLevel(f.structure?.support[0]?.price,'#66c595','Support');addLevel(f.structure?.resistance[0]?.price,'#ef8585','Resistance');}
  if($('#overlay-ema').checked){addLine(t.series.ema[20],'#e8a33d','EMA20');addLine(t.series.ema[50],'#91aed2','EMA50');addLine(t.series.ema[200],'#b79ad5','EMA200');}
  if($('#overlay-vwap').checked){addLine(t.series.vwap,'#b79ad5','VWAP proxy');const i=data.findIndex(b=>b.ts===f.reversal?.avwap?.anchor_ts);if(i>=0)addLine(anchoredVwap(data,i),'#cd9fd5','AVWAP proxy');}
  if($('#overlay-plan').checked&&plan&&tf==='1D'){
    const suffix=plan.live_check?.stop_tested?' (invalidated)':'';
    addLevel(plan.entry_zone.low,'#e8a33d',plan.direction+' entry low'+suffix);addLevel(plan.entry_zone.high,'#e8a33d','Entry high');addLevel(plan.stop,'#ef8585','Fixed stop');for(const z of plan.targets)addLevel(z.price,'#91aed2',z.name);
  }
  let pane=1;
  if($('#overlay-rsi').checked){const r=addLine(t.series.rsi,'#b79ad5','RSI 14',pane++);for(const v of [30,70])r.createPriceLine({price:v,color:'#54525e',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:''});}
  if($('#overlay-macd').checked){const m=chart.addSeries(HistogramSeries,{priceFormat:{type:'price',precision:3,minMove:.001},priceLineVisible:false,lastValueVisible:false,title:'MACD hist'},pane);m.setData(t.series.hist.map((v,i)=>finite(v)?{time:time(data[i]),value:v,color:v>=0?'#46795f':'#975956'}:null).filter(Boolean));addLine(t.series.macd,'#91aed2','MACD',pane);addLine(t.series.signal,'#e8a33d','Signal',pane);pane++;}
  for(let i=1;i<chart.panes().length;i++)chart.panes()[i].setHeight(90);
  const marks=[],notes=new Map();
  const mark=(i,dir,text,detail,color,shape='circle')=>{if(!data[i])return;const tm=time(data[i]);marks.push({time:tm,position:dir>0?'belowBar':'aboveBar',color,shape,text,size:.5});notes.set(String(tm),[...(notes.get(String(tm))||[]),detail]);};
  if($('#overlay-structure').checked){
    for(const p of f.pivots.filter(p=>p.quality>=65).slice(-10))mark(p.i,p.type==='H'?-1:1,p.label,`${p.label}: ${money(p.price)}; quality ${p.quality}/100. Confirmed ${when(p.confirmed_ts)}, three bars after the pivot.`,'#a0a4af');
    for(const e of f.events.filter(e=>['BOS','CHoCH'].includes(e.type)).slice(-10))mark(e.i,e.dir,e.type,`${e.type}: completed ${e.dir>0?'break above':'break below'} ${money(e.level)}. Known at ${when(e.confirmed_ts)}.`,e.dir>0?'#66c595':'#ef8585');
  }
  if($('#overlay-sweeps').checked)for(const e of f.events.filter(e=>e.type==='LIQUIDITY SWEEP').slice(-8))mark(e.i,e.dir,'SWEEP',`Sweep proxy: crossed ${money(e.level)} then closed back through it. This does not prove hidden orders.`,'#e8a33d',e.dir>0?'arrowUp':'arrowDown');
  if($('#overlay-reversal').checked)for(const e of(f.reversal_events||[]).slice(-6))mark(e.i,e.dir,e.stage==='REVERSAL CONFIRMED'?'REV CONFIRMED':e.stage==='REVERSAL DEVELOPING'?'REV DEVELOPING':'REV WATCH',`${e.dir>0?'Bullish':'Bearish'} ${e.stage.toLowerCase()}: ${e.evidence.map(x=>x.name).join(', ')}. Proxy; not an entry by itself.`,e.dir>0?'#66c595':'#ef8585',e.dir>0?'arrowUp':'arrowDown');
  marks.sort((x,z)=>x.time<z.time?-1:x.time>z.time?1:0);createSeriesMarkers(candles,marks);
  const byTime=new Map(data.map(b=>[String(time(b)),b]));
  const timeKey=tm=>tm&&typeof tm==='object'?`${tm.year}-${String(tm.month).padStart(2,'0')}-${String(tm.day).padStart(2,'0')}`:String(tm);
  const show=param=>{const tm=timeKey(param.time),b=byTime.get(tm);if(!b)return;$('#chart-detail').textContent=`${state.symbol} · ${b.date} · O ${money(b.open)} H ${money(b.high)} L ${money(b.low)} C ${money(b.close)} · V ${compact(b.volume)}${notes.has(tm)?' · '+notes.get(tm).join(' | '):''}`;};
  chart.subscribeCrosshairMove(show);chart.subscribeClick(show);
  chart.timeScale().setVisibleLogicalRange(previous||{from:Math.max(0,data.length-130),to:data.length+4});
  $('#chart-detail').textContent='Hover or click a marked candle for the rule and confirmation time. RSI: purple · MACD: blue / amber.';
  $('#chart-note').textContent=`${state.symbol} · ${tf} · ${data.length.toLocaleString()} completed bars · ${f.status} · last close ${when(data.at(-1).end_ts)}. Major pivots appear at their candle; their confirmation is three bars later.`;
  host.dataset.symbol=state.symbol;host.dataset.bars=String(data.length);host.dataset.lastClose=String(data.at(-1).close);host.dataset.lastDate=data.at(-1).date;
}
