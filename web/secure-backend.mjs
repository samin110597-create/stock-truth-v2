import {completedDailyPeriods} from '../src/bars.mjs';

const SECURE_TFS=['15M','1H','4H','1D'];
const unavailable=reason=>({classification:'UNAVAILABLE',status:'UNAVAILABLE',quality:'UNAVAILABLE',reason,bars:[],forming_bars:[]});

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
function periodFrame(daily,tf){
  if(!daily?.bars?.length)return unavailable('Daily source unavailable for '+tf+' resampling.');
  const bars=completedDailyPeriods(daily.bars,tf);
  return {
    ...daily,
    classification:'CALCULATION',
    provider:(daily.provider||'Deno secured provider')+' · completed daily → '+tf,
    interval:tf,
    native:false,
    resampled_from:'1D',
    bars,
    forming_bars:[],
    last_completed_bar:bars.at(-1)?.end_ts??null,
    status:bars.length?'COMPLETED BAR':'UNAVAILABLE',
    quality:bars.length?'PASS':'UNAVAILABLE'
  };
}
function secureRaw(payload,symbol){
  const frames={
    '5M':unavailable('Deno secured route does not provide native 5M history.'),
    '15M':unavailable('15M unavailable from secured providers.'),
    '30M':unavailable('Deno secured route does not provide native 30M history.'),
    '1H':unavailable('1H unavailable from secured providers.'),
    '4H':unavailable('4H unavailable from secured providers.'),
    '1D':unavailable('1D unavailable from secured providers.'),
    '1W':unavailable('1W unavailable until daily history is available.'),
    '1M':unavailable('1M unavailable until daily history is available.')
  };
  for(const tf of SECURE_TFS){
    const frame=normalizeFrame(payload.timeframes?.[tf],tf);
    if(frame)frames[tf]=frame;
  }
  if(frames['1D']?.bars?.length){
    frames['1W']=periodFrame(frames['1D'],'1W');
    frames['1M']=periodFrame(frames['1D'],'1M');
  }
  const last=frames['1D']?.bars?.at(-1);
  return {
    schema_version:5,
    symbol,
    name:symbol,
    fetched_at:payload.fetched_at||new Date().toISOString(),
    timeframes:frames,
    quote:{classification:'UNAVAILABLE',price:null,status:'UNAVAILABLE',provider:'No secured quote endpoint; last completed close is used.'},
    market:{classification:'CALCULATION',state:'UNKNOWN',expected_completed_daily:last?.date||null,as_of:Date.now()/1000,provider:'Deno completed-bar context'},
    fundamentals:{classification:'UNAVAILABLE',status:'UNAVAILABLE',reason:'Loaded separately by Stock Truth fundamentals service.'},
    provider_errors:[],
    retrieval:'SECURE DENO MULTI-PROVIDER',
    secure_backend:{
      status:'ACTIVE',
      host:'Deno Deploy',
      provider_trace:payload.provider_trace||[],
      credential_policy:payload.credential_policy||'Provider keys remain server-side.',
      fetched_at:payload.fetched_at||null
    }
  };
}
export async function secureRetrieve(symbol,signal){
  const cfg=await runtimeConfig(signal),base=String(cfg?.apiBase||'').trim().replace(/\/$/,'');
  if(!/^https:\/\//.test(base))throw new Error('Deno backend is not configured.');
  const payload=await json(base+'/v1/market?'+new URLSearchParams({symbol,timeframe:'1D'}),signal,25000);
  if(payload?.symbol!==symbol)throw new Error('Deno ticker identity mismatch');
  const raw=secureRaw(payload,symbol);
  if(!raw.timeframes['1D']?.bars?.length)throw new Error('Deno returned no usable daily completed bars');
  return raw;
}
export function mergeSecure(classic,secured){
  if(!classic)return secured;
  const frames={...(classic.timeframes||{})};
  for(const tf of Object.keys(secured.timeframes||{})){
    const frame=secured.timeframes[tf];
    if(Array.isArray(frame?.bars)&&frame.bars.length)frames[tf]=frame;
  }
  const providerErrors=[...(classic.provider_errors||[])];
  for(const t of secured.secure_backend?.provider_trace||[])if(t.status!=='OK')providerErrors.push({provider:t.source,error:t.reason||t.status});
  return {
    ...classic,
    timeframes:frames,
    fetched_at:secured.fetched_at||classic.fetched_at,
    retrieval:'SECURE DENO MULTI-PROVIDER + CLASSIC FALLBACK',
    provider_errors:providerErrors,
    secure_backend:secured.secure_backend
  };
}
