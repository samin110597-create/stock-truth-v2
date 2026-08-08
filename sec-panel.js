(()=>{
  const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
  const compact=x=>{if(!finite(x))return'—';const n=Number(x),a=Math.abs(n);if(a>=1e12)return`${(n/1e12).toFixed(2)}T`;if(a>=1e9)return`${(n/1e9).toFixed(2)}B`;if(a>=1e6)return`${(n/1e6).toFixed(1)}M`;return n.toLocaleString('en-US',{maximumFractionDigits:2});};
  const pct=x=>finite(x)?`${(Number(x)*100).toFixed(1)}%`:'—';
  let last='';
  async function load(symbol){
    const host=document.querySelector('#secfundamentals');if(!host||!symbol||symbol===last)return;last=symbol;host.innerHTML='<p class="muted">Loading SEC filing-date facts…</p>';
    try{
      const r=await fetch(`/api/sec?symbol=${encodeURIComponent(symbol)}`,{cache:'no-store'}),j=await r.json();
      if(!r.ok){host.innerHTML=`<p class="muted">SEC filing-date facts unavailable for ${symbol}. This is normal for many non-U.S. securities.</p>`;return;}
      const m=j.metrics||{},items=[['Revenue',m.revenue],['Net income',m.netIncome],['Operating income',m.operatingIncome],['Operating cash flow',m.operatingCashflow],['Capital expenditure',m.capex],['Diluted EPS',m.dilutedEPS],['Assets',m.assets],['Liabilities',m.liabilities],['Equity',m.equity]];
      host.innerHTML=`<div class="mini-grid">${items.map(([name,x])=>{const a=x?.latest_first_reported;return `<div class="mini"><span>${name}</span><b>${compact(a?.val)}</b><span>${a?`Period ${a.end} · filed ${a.filed}`:'No comparable annual fact'}</span>${finite(x?.growth_first_reported)?`<span>First-reported YoY ${pct(x.growth_first_reported)}</span>`:''}</div>`;}).join('')}</div><p class="warning">SEC point-in-time rule: historical modeling may use a value only on or after its <b>filed</b> date. “First reported” is preserved separately from later restatements. These facts are visible now but are not promoted into the prediction until an ablation test proves they improve unseen-data performance.</p>`;
    }catch(e){host.innerHTML='<p class="muted">SEC filing-date source could not be reached. No value was substituted.</p>';}
  }
  function detect(){const t=document.querySelector('#title')?.textContent||'',m=t.match(/\(([^()]+)\)\s*$/);if(m)load(m[1]);}
  window.addEventListener('DOMContentLoaded',()=>{const title=document.querySelector('#title');if(title)new MutationObserver(detect).observe(title,{childList:true,subtree:true,characterData:true});detect();});
})();