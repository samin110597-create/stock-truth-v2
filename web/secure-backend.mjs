const TIMEFRAMES=['15M','1H','4H','1D'];
async function json(url,signal,timeout=15000){
  const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
  if(!r.ok){let body={};try{body=await r.json();}catch{}throw new Error(body.message||body.error||('HTTP '+r.status));}
  return r.json();
}
async function runtimeConfig(signal){
  try{return await json('../quant/runtime-config.json',signal,6000);}catch{return null;}
}
function normalizeFrame(frame,tf){
  if(!frame||!Array.isArray(frame.bars)||frame.bars.length<80)return null;
  return {
    classification:'SOURCE FACT',
    status:frame.status||'COMPLETED BAR',
    quality:'PASS',
    provider:frame.provider||'Deno secured provider',
    fetched_at:frame.fetched_at||new Date().toISOString(),
    interval:tf,
    native:true,
    bars:frame.bars,
    forming_bars:[],
    last_completed_bar:frame.bars.at(-1)?.end_ts??null,
    adjustment:'Provider OHLCV as returned by the secured Deno aggregation route. No browser API key is exposed.',
    source_url:null,
    limitations:'Server-side multi-provider route with provider fallback. Provider trace is retained separately.'
  };
}
export async function secureOverlay(raw,symbol,signal){
  const cfg=await runtimeConfig(signal),base=String(cfg?.apiBase||'').trim().replace(/\/$/,'');
  if(!/^https:\/\//.test(base))return {raw,used:false,reason:'Deno backend is not configured.'};
  const payload=await json(base+'/v1/market?'+new URLSearchParams({symbol,timeframe:'1D'}),signal,25000);
  if(payload?.symbol!==symbol)throw new Error('Deno ticker identity mismatch');
  const frames={...(raw.timeframes||{})};let replaced=0;
  for(const tf of TIMEFRAMES){
    const n=normalizeFrame(payload.timeframes?.[tf],tf);
    if(n){frames[tf]=n;replaced++;}
  }
  if(!replaced)throw new Error('Deno returned no usable completed-bar frames');
  const providerErrors=[...(raw.provider_errors||[])];
  for(const t of payload.provider_trace||[])if(t.status!=='OK')providerErrors.push({provider:t.source,error:t.reason||t.status});
  return {
    used:true,
    raw:{
      ...raw,
      timeframes:frames,
      fetched_at:payload.fetched_at||raw.fetched_at,
      retrieval:'SECURE DENO MULTI-PROVIDER + CLASSIC FALLBACK',
      provider_errors:providerErrors,
      secure_backend:{
        status:'ACTIVE',
        host:'Deno Deploy',
        provider_trace:payload.provider_trace||[],
        credential_policy:payload.credential_policy||'Secrets stay server-side.',
        fetched_at:payload.fetched_at||null
      }
    }
  };
}
