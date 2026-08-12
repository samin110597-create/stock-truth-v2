(()=>{'use strict';
window.__ST_V4_PATCH_CODE=function(code){
  if(!window.__ST_V4_LOCAL_BUILD)throw new Error('V4 local builder is unavailable');
  const needle="const r=await fetch(`${HAPI}?symbol=${encodeURIComponent(sym)}`,{cache:'no-store'}),j=await r.json();if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);HM=j;";
  const replacement="const j=window.__ST_V4_LOCAL_BUILD(sym);HM=j;";
  if(!String(code).includes(needle))throw new Error('V4 local model hook point not found in horizon loader');
  return String(code).replace(needle,replacement);
};
window.__ST_V4_LOCAL_HOOK=true;
})();