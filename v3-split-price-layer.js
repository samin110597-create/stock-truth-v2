(()=>{'use strict';
const API='https://stock-truth-v2.vercel.app/api/technical-bars-v1',cache=new Map();let busy='';
async function apply(sym,tf){
  if(!sym||!tf)return;const key=sym+'|'+tf;
  if(D?.__v32SplitKey===key&&String(D?.candles?.source||'').includes('split-adjusted-server'))return;
  if(busy===key)return;busy=key;
  try{
    let j=cache.get(key);if(!j){const r=await fetch(`${API}?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}`,{cache:'no-store'});j=await r.json();if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);cache.set(key,j);}
    if(!D||D.symbol!==sym||String(typeof TF!=='undefined'?TF:D.timeframe)!==tf)return;
    const integrity=j.corporate_actions?.integrity||'OK';
    D.candles={...(D.candles||{}),source:j.selected.source,fetched_at:j.generated_at,bars:j.selected.bars,n:j.selected.n,interval:tf,latest:j.selected.latest,closed_bars_only:true,confidence:integrity==='OK'?'HIGH':'LOW',adjustment:'provider split-adjusted + audited',corporate_actions:j.corporate_actions||null};
    D.daily={...(D.daily||{}),source:j.daily.source,fetched_at:j.generated_at,bars:j.daily.bars,n:j.daily.n,latest:j.daily.latest,closed_bars_only:true,adjustment:'provider split-adjusted + audited',corporate_actions:j.corporate_actions||null};
    D.__v32SplitKey=key;D.__v32TechnicalQuality=j.data_quality;D.__v33CorporateActions=j.corporate_actions||null;
    window.__ST_V32_PRICE_ERR=null;window.__ST_V33_CORP_ACTION_WARN=integrity==='OK'?null:'Corporate-action continuity needs review';
    try{compute();render();}catch(e){console.warn('V3.3 split-price recompute',e);}
  }catch(e){window.__ST_V32_PRICE_ERR=String(e?.message||e);console.warn('V3.3 split-price feed',e);}finally{busy='';}
}
function kick(){try{const sym=D?.symbol,tf=String(typeof TF!=='undefined'?TF:(D?.timeframe||'1day'));if(sym)apply(sym,tf);}catch{}}
window.addEventListener('stocktruth:v2data',e=>{const sym=e?.detail?.symbol||D?.symbol,tf=String(typeof TF!=='undefined'?TF:(e?.detail?.timeframe||'1day'));if(sym)apply(sym,tf);});
let n=0,t=setInterval(()=>{n++;if(window.__ST_V31&&typeof D!=='undefined'){clearInterval(t);kick();}else if(n>240)clearInterval(t);},25);
window.__ST_V32_PRICE={apply,kick};
})();