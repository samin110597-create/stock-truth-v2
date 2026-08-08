(()=>{
  const PERIODS=[9,21,50,100,150,200];
  const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
  const fmt=x=>finite(x)?Number(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sma(v,n){if(v.length<n)return null;let s=0;for(let i=v.length-n;i<v.length;i++)s+=Number(v[i]);return s/n;}
  function ema(v,n){if(v.length<n)return null;const k=2/(n+1);let e=v.slice(0,n).reduce((a,b)=>a+Number(b),0)/n;for(let i=n;i<v.length;i++)e=Number(v[i])*k+e*(1-k);return e;}
  function weekKey(date){const d=new Date(date+'T00:00:00Z');const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day);return d.toISOString().slice(0,10);}
  function resample(bars,mode){
    const m=new Map();
    for(const b of bars){const k=mode==='week'?weekKey(b.date):b.date.slice(0,7);m.set(k,Number(b.close));}
    const a=[...m.entries()].sort((x,y)=>x[0].localeCompare(y[0]));
    if(a.length)a.pop(); // conservative: use only fully completed week/month
    return a.map(x=>x[1]).filter(Number.isFinite);
  }
  function state(px,v){if(!finite(v))return'—';return px>v?'ABOVE':px<v?'BELOW':'AT';}
  function tfRows(label,closes,px){
    return PERIODS.map(n=>{const s=sma(closes,n),e=ema(closes,n);return `<tr><td>${label}</td><td>${n}</td><td>${fmt(s)}</td><td class="${state(px,s)==='ABOVE'?'up':state(px,s)==='BELOW'?'down':''}">${state(px,s)}</td><td>${fmt(e)}</td><td class="${state(px,e)==='ABOVE'?'up':state(px,e)==='BELOW'?'down':''}">${state(px,e)}</td></tr>`;}).join('');
  }
  function revisionText(D){
    const r=(D?.context?.revisions||[]).find(x=>x.period==='0q')||(D?.context?.revisions||[])[0];
    if(!r)return'Unavailable';
    const c=Number(r.epsTrendCurrent),p=Number(r.epsTrend30dAgo);
    if(!Number.isFinite(c)||!Number.isFinite(p))return'Available, but no comparable 30-day EPS estimate';
    const d=c-p;return `${d>0?'RISING':d<0?'FALLING':'FLAT'} · current ${fmt(c)} vs 30d ago ${fmt(p)}`;
  }
  function render(D){
    const app=document.querySelector('#app');if(!app||!D||D.load_error)return;
    let host=document.querySelector('#v2truth');
    if(!host){host=document.createElement('div');host.id='v2truth';host.className='panel';app.parentNode.insertBefore(host,app.nextSibling);}
    const bars=D.daily?.bars||D.candles?.bars||[];if(bars.length<20){host.innerHTML='<h2>V2 multi-timeframe truth layer</h2><p class="note">Not enough closed-bar history to calculate multi-timeframe structure.</p>';return;}
    const daily=bars.map(b=>Number(b.close)).filter(Number.isFinite),weekly=resample(bars,'week'),monthly=resample(bars,'month'),px=Number(bars.at(-1)?.close);
    const next=(D.context?.earnings?.nextDates||D.earnings?.next_dates||[])[0];
    host.innerHTML=`<h2>V2 multi-timeframe truth layer <span class="tag">COMPLETED BARS ONLY</span></h2>
      <div class="stats">
        <div class="st"><div class="l">Daily history</div><div class="v">${daily.length}</div><div class="s">closed sessions</div></div>
        <div class="st"><div class="l">Weekly history</div><div class="v">${weekly.length}</div><div class="s">completed weeks</div></div>
        <div class="st"><div class="l">Monthly history</div><div class="v">${monthly.length}</div><div class="s">completed months</div></div>
        <div class="st"><div class="l">Next earnings</div><div class="v">${next?esc(new Date(next).toLocaleDateString()):'—'}</div><div class="s">current calendar context</div></div>
      </div>
      <h3>MA / EMA structure</h3>
      <div style="overflow:auto"><table><tr><th>Timeframe</th><th>Period</th><th>SMA</th><th>Price vs SMA</th><th>EMA</th><th>Price vs EMA</th></tr>
        ${tfRows('Daily',daily,px)}${tfRows('Weekly',weekly,px)}${tfRows('Monthly',monthly,px)}
      </table></div>
      <h3>Current revision context</h3><p class="note" style="margin-top:0">${esc(revisionText(D))}</p>
      <p class="note"><b>Truth rule:</b> these daily/weekly/monthly structures are displayed now, but they do not get extra weight in the original Verdict merely because more indicators were added. They must improve out-of-sample balanced accuracy/Brier skill in an ablation test before they are promoted into the prediction score. Current earnings/revision/fundamental snapshots are also excluded from historical win-rate claims unless the value has a genuine point-in-time date.</p>`;
  }
  window.addEventListener('stocktruth:v2data',e=>render(e.detail));
  if(window.V2DATA)render(window.V2DATA);
})();