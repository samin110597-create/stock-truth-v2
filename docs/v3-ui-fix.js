(()=>{'use strict';
const STYLE_ID='st-v32-ui-fix';
function injectStyle(){
  if(document.getElementById(STYLE_ID))return;
  const s=document.createElement('style');s.id=STYLE_ID;s.textContent=`
#hf32chart{display:block!important;width:100%!important;height:650px!important;max-width:none!important}
.v32-workspace-panel{overflow:visible!important}
.v32-workspace-panel #hf32chart-wrap{width:100%!important;min-height:650px!important;overflow:hidden!important}
.v32-precision-details .stats{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))!important;gap:14px 18px!important;align-items:start!important}
.v32-precision-details .st{min-width:0!important;padding:6px 2px 10px!important}
.v32-precision-details .st .v{font-size:15px!important;line-height:1.35!important;white-space:normal!important;overflow-wrap:anywhere!important}
.v32-precision-details .st .s{font-size:10.5px!important;line-height:1.45!important;margin-top:4px!important;white-space:normal!important}
.v32-precision-details h2{margin-bottom:12px!important}
.v32-freshness{margin-top:14px!important}
@media(max-width:760px){#hf32chart{height:560px!important}.v32-workspace-panel #hf32chart-wrap{min-height:560px!important}.v32-precision-details .stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media(max-width:480px){.v32-precision-details .stats{grid-template-columns:1fr!important}}
`;
  document.head.appendChild(s);
}
function enforceClosedBars(){
  try{if(typeof FORM_ON!=='undefined'){FORM_ON=false;localStorage.setItem('form_on','0');}}catch{}
}
function panelTitle(p){return (p.querySelector('h2')?.textContent||'').replace(/\s+/g,' ').trim();}
function cleanup(){
  injectStyle();
  const panels=[...document.querySelectorAll('.panel')];
  for(const p of panels){
    const t=panelTitle(p);
    if(!t)continue;
    if(/^Institutional chart workspace · V3\.2/i.test(t)){
      p.classList.add('v32-workspace-panel');
      const cv=p.querySelector('#hf32chart');
      if(cv){const wrap=cv.parentElement;wrap.id='hf32chart-wrap';wrap.style.width='100%';cv.style.width='100%';cv.style.display='block';}
    }else if(/^Institutional chart workspace(?!.*V3\.2)/i.test(t)){
      p.style.display='none';p.dataset.v32Hidden='legacy-workspace';
    }
    if(/V3\.1 precision technical engine/i.test(t)){
      p.classList.add('v32-precision-details');
      const h=p.querySelector('h2');
      if(h&&h.firstChild&&h.firstChild.nodeType===3)h.firstChild.textContent='Precision indicator details · V3.2 ';
    }
    if(/HOW CURRENT IS THIS\?/i.test(t)){
      p.classList.add('v32-freshness');
      const closed=!!(D?.candles?.closed_bars_only||D?.__v32TechnicalQuality?.forming_bar_excluded||D?.candles?.source==='yahoo-split-adjusted-server');
      if(closed){
        for(const tag of p.querySelectorAll('.tag'))if(/LIVE BAR INCLUDED|FORMING BAR|LIVE BAR/i.test(tag.textContent||'')){
          tag.textContent='COMPLETED BARS ONLY';tag.classList.remove('bad','amber');tag.classList.add('good');
        }
        const txt=p.innerHTML;
        if(/live bar included|today.?s forming bar|forming-bar policy/i.test(txt)){
          p.innerHTML=txt
            .replace(/LIVE BAR INCLUDED/gi,'COMPLETED BARS ONLY')
            .replace(/live bar included/gi,'completed bars only')
            .replace(/Included — live quote spliced into indicators/gi,'Excluded — incomplete bar is not used in indicators')
            .replace(/Included/gi,'Excluded');
        }
      }
    }
  }
  const b=document.querySelector('#buildTag');if(b&&/v3\.2/i.test(b.textContent||''))b.textContent='build v3.2 · UI fixed · precision + hedge-fund context ✓';
  const badge=document.querySelector('#v31badge');if(badge)badge.textContent='V3.2 ACTIVE';
}
function install(){
  injectStyle();enforceClosedBars();
  if(typeof render==='function'&&!window.__ST_V32_UI_RENDER){
    window.__ST_V32_UI_RENDER=true;
    const baseRender=render;
    render=function(){baseRender();requestAnimationFrame(()=>{cleanup();});};
  }
  if(typeof compute==='function'&&typeof D!=='undefined'&&D){
    try{compute();render();}catch(e){console.warn('V3.2 UI recompute',e);}
  }else cleanup();
  let queued=false;
  const mo=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;cleanup();});});
  mo.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('resize',()=>{try{render();}catch{cleanup();}},{passive:true});
  window.__ST_V32_UI_FIXED=true;
}
install();
})();