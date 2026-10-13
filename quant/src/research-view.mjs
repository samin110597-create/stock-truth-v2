const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=x=>String(x).replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/\by3\b/g,'3 years').replace(/\by5\b/g,'5 years').replace(/\by10\b/g,'10 years');
const value=x=>x===null||x===undefined?'Unavailable':typeof x==='number'?x.toLocaleString('en-US',{maximumFractionDigits:3}):String(x);
function rows(data,prefix=''){
 return Object.entries(data||{}).flatMap(([k,v])=>v&&typeof v==='object'&&!Array.isArray(v)?rows(v,prefix+label(k)+' · '):[[prefix+label(k),value(v)]]);
}
const table=items=>'<div class="table-scroll"><table class="facts-table"><tbody>'+items.map(([a,b])=>'<tr><th>'+esc(a)+'</th><td>'+esc(b)+'</td></tr>').join('')+'</tbody></table></div>';
const when=x=>x?new Date(x).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}):'Unavailable';
export function researchHTML(research,symbol,macro=[]){
 const f=research?.fundamentals||{},data=f.data||{},s=data.summary||{};
 const groups=[['Company & market value',{name:s.name,sector:s.sector,industry:s.industry,currency:s.currency,marketCapitalization:s.price?.marketCap,priceBasisDate:s.price?.lastCloseDate}],['Valuation',s.valuation],['Growth · annualized percentages',s.growthCagrPercent],['Profitability',s.profitability],['Debt & financial health',s.financialHealth],['Dividends',s.dividends]];
 let html='<h2>'+esc(symbol)+' · Company fundamentals</h2><p>'+esc(f.status||'UNAVAILABLE')+' · '+esc(f.provider||'No financial source available')+'</p><p class="scenario-note">Source updated: '+esc(when(s.asOf?.dataUpdatedAt))+' · Retrieved: '+esc(when(research?.fetched_at))+'. Financial reporting dates are shown below. These values can be older than the chart price.</p><div class="fund-grid">'+groups.map(([name,obj])=>'<article class="block"><h3>'+esc(name)+'</h3>'+table(Object.keys(obj||{}).length?rows(obj):[['Availability','Unavailable from source']])+'</article>').join('')+'</div>';
 for(const [key,name]of [['income','Income statement'],['balance','Balance sheet'],['cashflow','Cash-flow statement']]){
  const statement=data[key],concepts=statement?.concepts||[];
  const rs=(statement?.rows||[]).filter(r=>r.periodEnd&&r.periodEnd<=new Date().toISOString().slice(0,10)).slice(0,5);
  html+='<section class="block"><h3>'+name+'</h3><p class="scenario-note">'+esc(statement?.period||'Reporting basis unavailable')+' · Currency '+esc(statement?.currency||s.reportedCurrency||s.currency||'Unavailable')+'</p>';
  if(rs.length&&concepts.length){html+='<div class="table-scroll"><table class="facts-table"><thead><tr><th>Reported measure</th>'+rs.map(r=>'<th>'+esc(r.periodEnd)+'</th>').join('')+'</tr></thead><tbody>';
   html+=concepts.map(c=>'<tr><th>'+esc(c.label||label(c.key))+'<small> '+esc(c.unit||'Unit unspecified')+'</small></th>'+rs.map(r=>{const p=r.provenance?.[c.key],ok=p?.filed&&p.filed<=new Date().toISOString().slice(0,10);return '<td>'+esc(ok?value(r.metrics?.[c.key]):'Unavailable')+(ok?'<small>Filed '+esc(p.filed)+' · '+esc(p.form||'')+'</small>':'')+'</td>';}).join('')+'</tr>').join('');html+='</tbody></table></div>';
  }else html+='<p>Statement unavailable. Other financial sections remain usable.</p>';
  html+='</section>';
 }
 html+='<section class="block"><h3>What is still unavailable?</h3><p>'+esc((f.errors||[]).join(' · ')||'No component errors reported by the source.')+'</p><p>Intrinsic value, an earnings calendar, analyst revisions and ownership flows are not established by these statements. No fair-value price is invented. Forward P/E and PEG use provider estimates and are not promises of future growth.</p><p class="scenario-note">Percentage fields are reported as percentages; other ratios are multiples. Summary ratios follow the provider’s reporting basis. Filed per-share figures may precede later share splits. Research remains separate from the price forecast until tested historical evidence supports using it.</p></section>';
 if(macro.length)html+='<section class="block"><h3>Economic context</h3>'+table(macro)+'</section>';
 return html;
}
