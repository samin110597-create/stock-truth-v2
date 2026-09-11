(()=>{
const QAPI='https://stock-truth-v2.vercel.app/api/quarterly-v1';
let qData=null,qSymbol=null,qError=null;
const qCache=new Map(), instCharts={};
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const escI=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtI=(x,d=1)=>finite(x)?Number(x).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pctI=(x,d=0)=>finite(x)?`${(Number(x)*100).toFixed(d)}%`:'—';
const bigI=x=>{if(!finite(x))return'—';const n=Number(x),a=Math.abs(n);if(a>=1e12)return`${(n/1e12).toFixed(2)}T`;if(a>=1e9)return`${(n/1e9).toFixed(2)}B`;if(a>=1e6)return`${(n/1e6).toFixed(2)}M`;if(a>=1e3)return`${(n/1e3).toFixed(1)}K`;return fmtI(n,0);};

const CATW={Trend:22,Momentum:14,Volume:10,Structure:12,Pattern:10,Business:10,"Balance sheet":6,Valuation:8,Execution:4,Analysts:1,Positioning:3};
function institutionalScore(rows){
  const cats={};let bull=0,bear=0,neutral=0;
  for(const x of (rows||[])){if(!x||!x.w)continue;(cats[x.cat]||(cats[x.cat]=[])).push(x);if(x.dir>0)bull+=x.w;else if(x.dir<0)bear+=x.w;else neutral+=x.w;}
  let num=0,den=0;const categories={};
  for(const [cat,cw] of Object.entries(CATW)){
    const a=cats[cat]||[];if(!a.length)continue;
    let s=0,w=0;for(const x of a){s+=x.w*clamp(Number(x.dir)||0,-1,1);w+=x.w;}
    if(!w)continue;const signal=s/w,pts=Math.round(50+50*signal);
    categories[cat]={signal,pts,weight:cw,n:a.length,itemWeight:w};num+=signal*cw;den+=cw;
  }
  const net=den?num/den:0,pts=den?Math.round(50+50*net):null,coverage=den/100;
  const active=Object.values(categories).filter(c=>Math.abs(c.signal)>=.12),sgn=Math.sign(net);
  const ad=active.reduce((s,c)=>s+c.weight,0),an=active.reduce((s,c)=>s+(Math.sign(c.signal)===sgn?c.weight:0),0);
  const agreement=ad?an/ad:null;
  const state=pts==null?'DATA LIMITED':pts>=72?'STRONG CONSTRUCTIVE':pts>=60?'CONSTRUCTIVE':pts>=45?'BALANCED / MIXED':pts>=33?'CAUTIOUS':'DEFENSIVE';
  const edge=Math.abs(net)<.15?'NO EDGE':net>.45?'STRONG BULL':net>.15?'LEAN BULL':net<-.45?'STRONG BEAR':'LEAN BEAR';
  return{bull,bear,neutral,tot:bull+bear+neutral,net,pts,coverage,agreement,categories,state,edge};
}
function cat(S,cat){
  const c=S.categories?.[cat];if(!c)return{label:'NO DATA',cls:'dim',pts:null,detail:'not counted; coverage reduced'};
  return{label:c.pts>=65?'SUPPORTIVE':c.pts<=35?'ADVERSE':'MIXED',cls:c.pts>=65?'up':c.pts<=35?'down':'amber',pts:c.pts,detail:`${c.n} measured input${c.n===1?'':'s'} · normalized as one family`};
}
function mtf(){
  if(typeof T==='undefined'||!T)return{label:'NO DATA',cls:'dim',detail:''};
  const a=['monthly','weekly','daily'].map(k=>T.trends?.[k]?.label||'NEUTRAL'),b=a.filter(x=>x==='BULLISH').length,r=a.filter(x=>x==='BEARISH').length;
  if(b===3)return{label:'FULL BULL ALIGNMENT',cls:'up',detail:a.join(' / ')};
  if(r===3)return{label:'FULL BEAR ALIGNMENT',cls:'down',detail:a.join(' / ')};
  if(b>=2&&!r)return{label:'CONSTRUCTIVE ALIGNMENT',cls:'up',detail:a.join(' / ')};
  if(r>=2&&!b)return{label:'DEFENSIVE ALIGNMENT',cls:'down',detail:a.join(' / ')};
  return{label:'MIXED TIMEFRAMES',cls:'amber',detail:a.join(' / ')};
}
function liquidity(){
  if(typeof T==='undefined'||!T)return{label:'NO DATA',cls:'dim',detail:''};
  const demand=(T.ob?.bullish?.length||0)+(T.fvg?.below?.length||0),supply=(T.ob?.bearish?.length||0)+(T.fvg?.above?.length||0);
  const sup=T.levels?.support?.[0],res=T.levels?.resistance?.[0],sd=sup?Math.abs(T.price-sup)/T.price:null,rd=res?Math.abs(res-T.price)/T.price:null;
  let label='BALANCED',cls='amber';
  if(demand>supply+1||(finite(sd)&&finite(rd)&&sd<rd*.65)){label='DEMAND CLOSER';cls='up';}
  else if(supply>demand+1||(finite(sd)&&finite(rd)&&rd<sd*.65)){label='SUPPLY CLOSER';cls='down';}
  return{label,cls,detail:`price-action proxy · demand zones ${demand}, supply zones ${supply}`};
}
function volRegime(){
  if(typeof T==='undefined'||!T)return{label:'NO DATA',cls:'dim',detail:''};
  const ap=T.price?T.atr/T.price:null;let label='NORMAL',cls='blue';
  if(finite(T.adx)&&T.adx>=25){label='TRENDING';cls='up';}
  if(finite(T.bbW)&&T.bbW<6){label='COMPRESSION';cls='amber';}
  if((finite(ap)&&ap>.06)||(finite(T.bbW)&&T.bbW>20)){label='ELEVATED';cls='amber';}
  return{label,cls,detail:`ATR ${pctI(ap,1)} · ADX ${fmtI(T.adx,1)} · BB width ${finite(T.bbW)?fmtI(T.bbW,1)+'%':'—'}`};
}
function btState(S){
  if(typeof BT==='undefined'||!BT||BT.error)return{label:'NOT ESTABLISHED',cls:'dim',detail:BT?.error||'backtest unavailable'};
  const key=S.net>=.15?'bull':S.net<=-.15?'bear':'neutral',row=BT.buckets?.[key],base=BT.baseline;
  if(!row?.n||!base?.n)return{label:'NOT ESTABLISHED',cls:'dim',detail:'insufficient bucket history'};
  const delta=row.avg21-base.avg21;
  if(!row.sufficient)return{label:'LOW SAMPLE',cls:'amber',detail:`n=${row.n} · ${fmtI(delta,2)} pts vs baseline`};
  const tail=key==='bull'?delta>0:key==='bear'?delta<0:Math.abs(delta)<.35;
  return{label:tail?'HISTORICAL TAILWIND':'NO TAILWIND PROVEN',cls:tail?'up':'amber',detail:`${fmtI(row.avg21,2)}% vs ${fmtI(base.avg21,2)}% baseline · n=${row.n}`};
}
function decisionStack(){
  if(typeof L==='undefined'||typeof T==='undefined'||!T)return'';
  const S=institutionalScore(L),trend=cat(S,'Trend'),mom=cat(S,'Momentum'),str=cat(S,'Structure'),volu=cat(S,'Volume'),pat=cat(S,'Pattern'),liq=liquidity(),vr=volRegime(),m=mtf(),bt=btState(S);
  const rows=[
    ['1','Trend',trend.label,trend.cls,trend.pts==null?'—':trend.pts+'/100',trend.detail],
    ['2','Momentum',mom.label,mom.cls,mom.pts==null?'—':mom.pts+'/100',mom.detail],
    ['3','Structure',str.label,str.cls,str.pts==null?'—':str.pts+'/100',str.detail],
    ['4','Liquidity map',liq.label,liq.cls,'proxy',liq.detail],
    ['5','Volume / participation',volu.label,volu.cls,volu.pts==null?'—':volu.pts+'/100',volu.detail],
    ['6','Volatility regime',vr.label,vr.cls,'context',vr.detail],
    ['7','Pattern confirmation',pat.label,pat.cls,pat.pts==null?'—':pat.pts+'/100',pat.detail],
    ['8','Multi-timeframe',m.label,m.cls,'3 frames',m.detail],
    ['9','Backtested edge',bt.label,bt.cls,'history',bt.detail]
  ];
  return`<div class="panel" style="border-color:rgba(122,155,196,.45)"><h2>Institutional decision stack <span class="tag">TREND → VALIDATION</span></h2>
  <table><tr><th>#</th><th>Layer</th><th>State</th><th>Score / role</th><th>Evidence</th></tr>${rows.map(r=>`<tr><td class="dim">${r[0]}</td><td>${r[1]}</td><td class="${r[3]}">${r[2]}</td><td class="mono">${r[4]}</td><td class="dim">${escI(r[5])}</td></tr>`).join('')}</table>
  <p class="note"><b>Truth rule:</b> the liquidity row is a price-action proxy from support/resistance, order blocks and fair-value gaps—not live order-book or dark-pool data. Volatility is regime context, not automatically bullish or bearish. Historical backtests are validation context, not a promise.</p></div>`;
}
function verdictPanel(){
  if(typeof L==='undefined'||typeof T==='undefined'||!T)return'';
  const S=institutionalScore(L),cls=S.pts>=60?'up':S.pts<45?'down':'amber';
  const cats=Object.entries(S.categories).sort((a,b)=>Math.abs(b[1].signal*b[1].weight)-Math.abs(a[1].signal*a[1].weight));
  const up=cats.filter(([,c])=>c.signal>.12).slice(0,3),dn=cats.filter(([,c])=>c.signal<-.12).slice(0,3);
  return`<div class="panel" style="border-color:rgba(232,163,61,.35)"><h2>Institutional verdict <span class="tag">CATEGORY-NORMALIZED · NO DOUBLE COUNTING</span></h2>
  <div class="stats"><div class="st"><div class="l">Evidence balance</div><div class="v ${cls}" style="font-size:25px">${S.pts??'—'}/100</div><div class="s">50 = genuinely balanced</div></div>
  <div class="st"><div class="l">State</div><div class="v ${cls}">${escI(S.state)}</div><div class="s">not a probability</div></div>
  <div class="st"><div class="l">Evidence coverage</div><div class="v">${pctI(S.coverage,0)}</div><div class="s">missing data lowers coverage, not direction</div></div>
  <div class="st"><div class="l">Directional agreement</div><div class="v">${S.agreement==null?'—':pctI(S.agreement,0)}</div><div class="s">agreement among active families</div></div></div>
  <div class="grid g2" style="margin-top:10px"><div><h3>Strongest support</h3>${up.length?up.map(([k,c])=>`<div class="ev"><div><b>${escI(k)}</b><div class="sub">${c.n} inputs normalized into one family</div></div><span class="up">${c.pts}/100</span></div>`).join(''):'<p class="note">No evidence family is clearly supportive.</p>'}</div>
  <div><h3>Primary risks</h3>${dn.length?dn.map(([k,c])=>`<div class="ev"><div><b>${escI(k)}</b><div class="sub">${c.n} inputs normalized into one family</div></div><span class="down">${c.pts}/100</span></div>`).join(''):'<p class="note">No evidence family is clearly adverse.</p>'}</div></div>
  <p class="note">This score is intentionally harder to distort: closely related indicators first collapse into their evidence family, neutral readings stay at the midpoint, and unavailable fundamentals/analyst data are never treated as bearish. A low score therefore requires actual adverse evidence.</p></div>`;
}
function techCommand(){
  if(typeof T==='undefined'||!T||typeof L==='undefined')return'';
  const S=institutionalScore(L),keys=['Trend','Momentum','Volume','Structure','Pattern'];let n=0,d=0;
  for(const k of keys){const c=S.categories[k];if(c){n+=c.signal*CATW[k];d+=CATW[k];}}
  const ts=d?Math.round(50+50*n/d):null,cls=ts>=60?'up':ts<45?'down':'amber',m=mtf(),vr=volRegime();
  return`<div class="panel" style="border-color:rgba(122,155,196,.45)"><h2>Institutional technical command center <span class="tag">INDEPENDENT FAMILIES</span></h2>
  <div class="stats"><div class="st"><div class="l">Technical confluence</div><div class="v ${cls}">${ts??'—'}/100</div><div class="s">directional evidence, not odds</div></div>
  <div class="st"><div class="l">Multi-timeframe</div><div class="v ${m.cls}">${escI(m.label)}</div><div class="s">${escI(m.detail)}</div></div>
  <div class="st"><div class="l">Regime</div><div class="v ${vr.cls}">${escI(vr.label)}</div><div class="s">${escI(vr.detail)}</div></div>
  <div class="st"><div class="l">Market structure</div><div class="v ${T.bos?.dir==='bullish'?'up':T.bos?.dir==='bearish'?'down':'amber'}">${escI(T.bos?.dir?.toUpperCase()||'NO CLEAN BOS')}</div><div class="s">${T.bos?`through $${fmtI(T.bos.price,2)} on ${escI(T.bos.date)}`:'structure remains mixed'}</div></div>
  <div class="st"><div class="l">Participation</div><div class="v ${T.obvSlope>0?'up':T.obvSlope<0?'down':''}">${finite(T.relVol)?fmtI(T.relVol,2)+'×':'—'}</div><div class="s">volume vs 20d · OBV ${T.obvSlope>0?'rising':'falling'}</div></div>
  <div class="st"><div class="l">Nearest levels</div><div class="v">${T.levels?.support?.[0]?'$'+fmtI(T.levels.support[0],2):'—'} / ${T.levels?.resistance?.[0]?'$'+fmtI(T.levels.resistance[0],2):'—'}</div><div class="s">support / resistance</div></div></div>
  <p class="note">The command score does not count RSI, MACD, moving averages and timeframe structure as separate independent votes when they describe the same underlying trend. That reduces false confidence from indicator duplication.</p></div>`;
}

async function loadQuarterly(sym){
  qSymbol=sym;qError=null;
  if(qCache.has(sym)){qData=qCache.get(sym);try{if(typeof render==='function')render();}catch{}return;}
  qData=null;try{const r=await fetch(`${QAPI}?symbol=${encodeURIComponent(sym)}`,{cache:'no-store'}),j=await r.json();if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);qCache.set(sym,j);qData=j;}catch(e){qError=String(e?.message||e);}
  try{if(typeof render==='function')render();}catch{}
}
function qPanel(){
  if(typeof D==='undefined'||!D?.symbol)return'';
  if(qSymbol!==D.symbol)return`<div class="panel"><h2>10-quarter fundamentals <span class="tag pulse">LOADING</span></h2><p class="note">Loading reported quarterly history.</p></div>`;
  if(qError)return`<div class="panel"><h2>10-quarter fundamentals <span class="tag bad">UNAVAILABLE</span></h2><p class="note">${escI(qError)}</p></div>`;
  if(!qData?.rows?.length)return`<div class="panel"><h2>10-quarter fundamentals <span class="tag">NO SERIES YET</span></h2><p class="note">No reported quarterly series returned for this security.</p></div>`;
  const n=qData.rows.length,cards=[['qRev','Revenue'],['qProfit','Profitability'],['qMargin','Margins'],['qEPS','Diluted EPS'],['qCashflow','Cash generation'],['qBalance','Balance sheet'],['qRatio','Liquidity / leverage'],['qShares','Share dilution'],['qInvest','R&D / stock compensation']];
  return`<div class="panel"><h2>Quarterly fundamental trendbook <span class="tag">${n} REPORTED QUARTERS</span></h2><p class="note" style="margin-top:0">Each chart uses reported quarterly fields from ${escI(qData.source||'server fundamentals')}. Missing values stay blank; no quarter is fabricated.</p></div><div class="grid g2">${cards.map(([id,t])=>`<div class="panel"><h2>${t} <span class="tag">QUARTERLY</span></h2><div style="height:230px"><canvas id="${id}"></canvas></div></div>`).join('')}</div>`;
}
function destroy(id){if(instCharts[id]){try{instCharts[id].destroy();}catch{}delete instCharts[id];}}
function chart(id,series,percent=false){
  const el=document.getElementById(id);if(!el||typeof Chart==='undefined'||!qData?.rows)return;destroy(id);
  const rows=qData.rows,labels=rows.map(r=>r.label||r.date),datasets=series.map(s=>({type:s.type||'line',label:s.label,data:rows.map(r=>finite(r[s.key])?(percent?Number(r[s.key])*100:Number(r[s.key])):null),borderWidth:1.7,pointRadius:2,spanGaps:false}));
  instCharts[id]=new Chart(el,{data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:'#8C909A',boxWidth:10,font:{size:9}}}},scales:{x:{ticks:{color:'#8C909A',font:{size:9}},grid:{color:'rgba(140,144,154,.08)'}},y:{ticks:{color:'#8C909A',font:{size:9},callback:v=>percent?v+'%':bigI(v)},grid:{color:'rgba(140,144,154,.08)'}}}}});
}
function drawQ(){
  if(!qData?.rows?.length)return;
  chart('qRev',[{key:'revenue',label:'Revenue',type:'bar'}]);
  chart('qProfit',[{key:'gross_profit',label:'Gross profit'},{key:'operating_income',label:'Operating income'},{key:'net_income',label:'Net income'}]);
  chart('qMargin',[{key:'gross_margin',label:'Gross margin'},{key:'op_margin',label:'Operating margin'},{key:'net_margin',label:'Net margin'},{key:'fcf_margin',label:'FCF margin'}],true);
  chart('qEPS',[{key:'eps',label:'Diluted EPS'}]);
  chart('qCashflow',[{key:'ocf',label:'Operating cash flow'},{key:'fcf',label:'Free cash flow'}]);
  chart('qBalance',[{key:'cash',label:'Cash'},{key:'total_debt',label:'Total debt'},{key:'equity',label:'Equity'}]);
  chart('qRatio',[{key:'current_ratio',label:'Current ratio'},{key:'debt_to_equity',label:'Debt / equity'}]);
  chart('qShares',[{key:'shares',label:'Diluted average shares'}]);
  chart('qInvest',[{key:'rd',label:'R&D'},{key:'sbc',label:'Stock-based compensation'}]);
}
function softenForecastLanguage(){
  const host=document.getElementById('v2truth');if(!host)return;
  const walk=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){if(n.nodeValue&&n.nodeValue.includes('NO VERIFIED EDGE'))n.nodeValue=n.nodeValue.replaceAll('NO VERIFIED EDGE','EDGE NOT YET VERIFIED');}
  host.querySelectorAll('.tag.bad').forEach(x=>{if(x.textContent.includes('EDGE NOT YET VERIFIED'))x.classList.remove('bad');});
}

try{
  if(typeof score==='function')score=institutionalScore;
  const baseVerdict=typeof tabVerdict==='function'?tabVerdict:null,baseTech=typeof tabTech==='function'?tabTech:null,baseFund=typeof tabFund==='function'?tabFund:null,baseRender=typeof render==='function'?render:null;
  if(baseVerdict)tabVerdict=function(){const S=institutionalScore(typeof L!=='undefined'?L:[]);let h=baseVerdict();h=h.replace('The read','Factor ledger').replace('Weighted evidence','Category-normalized evidence').replace('Bull against bear weight','Raw bullish / bearish weight');if(S.edge)h=h.replace(`>${S.edge}<`,`>${S.state}<`);return verdictPanel()+decisionStack()+h;};
  if(baseTech)tabTech=function(){return techCommand()+decisionStack()+baseTech();};
  if(baseFund)tabFund=function(){return qPanel()+baseFund();};
  if(baseRender)render=function(){const r=baseRender();queueMicrotask(()=>{try{if(typeof TAB!=='undefined'&&TAB==='fund')drawQ();softenForecastLanguage();}catch(e){console.warn('institutional post-render',e);}});return r;};
}catch(e){console.warn('Institutional v3 patch failed',e);}

const observer=new MutationObserver(()=>softenForecastLanguage());observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('stocktruth:v2data',e=>{const s=e?.detail?.symbol;if(s&&s!==qSymbol)loadQuarterly(s);setTimeout(softenForecastLanguage,0);});
try{const s=window.V2DATA?.symbol||(typeof D!=='undefined'&&D?.symbol);if(s)loadQuarterly(s);}catch{}
})();