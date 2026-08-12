(()=>{'use strict';
const ROOT='https://raw.githubusercontent.com/samin110597-create/stock-truth-v2/main/';
const failures=[];
async function load(name,required=false){try{const r=await fetch(ROOT+name+'?v='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error(name+' HTTP '+r.status);(0,eval)(await r.text());return true;}catch(e){failures.push({name,error:String(e?.message||e),required});console.warn('V4 layer failed',name,e);return false;}}
function warning(){let x=document.getElementById('stV4LoadWarning');if(!failures.length){x?.remove();return;}if(!x){x=document.createElement('div');x.id='stV4LoadWarning';const h=document.querySelector('h1');(h||document.body).insertAdjacentElement(h?'afterend':'afterbegin',x);}const critical=failures.some(f=>f.required);x.innerHTML=`<b>${critical?'V4 PARTIAL/CRITICAL LOAD FAILURE':'V4 PARTIAL LOAD'}</b><br>${failures.map(f=>`${f.name}: ${f.error}`).join('<br>')}<br>No older predictive model is substituted.`;}
(async()=>{
  await load('v4-identity-lock.js',true);
  const precision=await load('v3-upgrade-precision2.js',true);
  if(precision){let n=0;await new Promise(resolve=>{const t=setInterval(()=>{n++;if(window.__ST_V31||n>240){clearInterval(t);resolve();}},25);});if(!window.__ST_V31)failures.push({name:'v3-upgrade-precision2.js',error:'precision layer did not initialize',required:true});}
  for(const name of['v3-split-price-layer.js','v3-hedge-layer.js','v3-ui-fix.js','v3-corporate-action-integrity.js','v3-structure-thesis.js','v3-priority-clean.js','v3-precision-overlay.js'])await load(name,false);
  await load('v4-trade-matrix-ui.js',true);
  try{if(typeof render==='function'&&typeof D!=='undefined'&&D)render();}catch(e){failures.push({name:'render',error:String(e?.message||e),required:false});}
  warning();
  window.__ST_V4_BOOT={version:'4.0',failures:[...failures],ready:!failures.some(f=>f.required)};
  try{const b=document.getElementById('stV4Identity');if(b&&!window.__ST_V4_BOOT.ready){b.classList.add('bad');b.textContent='V4 PARTIAL LOAD · CHECK WARNING';}}catch{}
})();
})();