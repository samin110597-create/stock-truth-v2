(()=>{'use strict';
const ROOT='https://raw.githubusercontent.com/samin110597-create/stock-truth-v2/main/';
const state={version:'V3.6',loaded:[],failed:[]};
window.__ST_V36_BOOT=state;
async function loadFile(file){
  const url=ROOT+file+'?v='+Date.now();
  const r=await fetch(url,{cache:'no-store'});
  if(!r.ok)throw new Error(file+' HTTP '+r.status);
  (0,eval)(await r.text());
}
async function safe(file,opts={}){
  try{
    if(opts.muteObserver){
      const NativeMO=window.MutationObserver;
      try{window.MutationObserver=class{observe(){}disconnect(){}takeRecords(){return[];}};await loadFile(file);}
      finally{window.MutationObserver=NativeMO;}
    }else await loadFile(file);
    state.loaded.push(file);return true;
  }catch(e){
    state.failed.push({file,error:String(e&&e.message||e)});
    console.error('Stock Truth V3.6 layer failed:',file,e);
    return false;
  }
}
function report(){
  if(!state.failed.length)return;
  const host=document.querySelector('main')||document.body;
  let p=document.getElementById('v36ModuleStatus');
  if(!p){p=document.createElement('div');p.id='v36ModuleStatus';p.className='panel';p.style.borderColor='rgba(224,82,82,.55)';host.prepend(p);}
  p.innerHTML='<h2>V3.6 MODULE STATUS <span class="tag bad">PARTIAL LOAD</span></h2><p class="note err">'+
    state.failed.map(x=>String(x.file)+' — '+String(x.error)).join('<br>')+
    '</p><p class="note">The dashboard is showing the layers that loaded successfully. Failed layers are not silently treated as active.</p>';
}
(async()=>{
  await safe('v3-upgrade-precision2.js');
  let n=0;
  await new Promise(resolve=>{const t=setInterval(()=>{n++;if(window.__ST_V31||n>240){clearInterval(t);resolve();}},25);});
  if(!window.__ST_V31)state.failed.push({file:'v3-upgrade-precision2.js',error:'precision layer did not initialize'});
  await safe('v3-split-price-layer.js');
  await safe('v3-hedge-layer.js');
  await safe('v3-ui-fix.js');
  await safe('v3-corporate-action-integrity.js');
  await safe('v3-structure-thesis.js');
  await safe('v3-priority-clean.js');
  await safe('v3-setup-validation.js');
  await safe('v3-351-polish.js');
  await safe('v3-transparency.js');
  await safe('v3-exact-validation.js',{muteObserver:true});
  // Identity is deliberately independent and always attempted last.
  await safe('v3-36-identity.js');
  report();
  window.dispatchEvent(new CustomEvent('stocktruth:v36ready',{detail:state}));
})();
})();