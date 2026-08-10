(()=>{'use strict';
function mark351(){const b=document.querySelector('#buildTag');if(b)b.textContent='build v3.5.1 · clean priority chart · no S/R overlay ✓';const badge=document.querySelector('#v31badge');if(badge)badge.textContent='V3.5.1 ACTIVE';const h=document.querySelector('.v34-panel h2');if(h)h.childNodes[0]&&(h.childNodes[0].textContent='Priority setup workspace · V3.5.1 ');}
function install(){if(window.__ST_V351)return;window.__ST_V351=true;try{const br=render;render=function(){br();requestAnimationFrame(mark351);};}catch{}requestAnimationFrame(mark351);let q=false;new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;mark351();});}).observe(document.body,{childList:true,subtree:true});}
install();
})();