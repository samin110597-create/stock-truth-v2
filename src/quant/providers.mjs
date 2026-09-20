import {retrieveTicker} from '../providers.mjs';

const PRODUCTS={GOLD:'GC',XAU:'GC',GC:'GC',SILVER:'SI',XAG:'SI',SI:'SI',OIL:'CL',WTI:'CL',CRUDE:'CL',CL:'CL',NATGAS:'NG',NATURALGAS:'NG',NG:'NG',COPPER:'HG',HG:'HG',CORN:'ZC',ZC:'ZC',WHEAT:'ZW',ZW:'ZW',SOYBEANS:'ZS',SOY:'ZS',ZS:'ZS',PLATINUM:'PL',PL:'PL',PALLADIUM:'PA',PA:'PA'};
export const commodityProducts=PRODUCTS;
const FUTURE_CONTRACT=/^[A-Z]{1,3}[FGHJKMNQUVXZ]\d{1,2}$/;
const clean=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
export function detectAsset(symbol,choice='AUTO'){if(choice&&choice!=='AUTO')return choice;const s=clean(symbol);return PRODUCTS[s]||FUTURE_CONTRACT.test(s)?'FUTURE':'STOCK';}
async function getJson(url,signal,timeout=10000){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
function usable(block){return Array.isArray(block?.bars)&&block.bars.length>=60;}
async function secureFutureSnapshot(input,timeframe,signal){
  const requested=clean(input),product=PRODUCTS[requested]||requested.replace(/[FGHJKMNQUVXZ]\d{1,2}$/,'');
  let snap;
  try{snap=await getJson('../../data/quant/'+encodeURIComponent(product)+'.json',signal);}catch{throw new Error(product+' secure futures snapshot is not available yet. Add MASSIVE_KEY/POLYGON_KEY in GitHub Actions secrets and run the Stock Truth workflow.');}
  const block=snap?.timeframes?.[timeframe];
  if(!usable(block))throw new Error(product+' '+timeframe+' snapshot is unavailable or too shallow. GitHub Actions must refresh it with an entitled futures API key.');
  return {symbol:requested,sourceSymbol:block.source_symbol||snap.source_symbol||product,asset:'FUTURE',timeframe,bars:block.bars,provider:block.provider||snap.provider||'GitHub-secured futures snapshot',fetchedAt:block.fetched_at||snap.fetched_at,credentialPolicy:'GitHub Actions secret; browser receives sanitized OHLCV only.'};
}
export async function loadQuantData({symbol,asset='AUTO',timeframe='1D',calendar,signal}){
  const s=clean(symbol),kind=detectAsset(s,asset);
  if(kind==='FUTURE')return secureFutureSnapshot(s,timeframe,signal);
  const raw=await retrieveTicker(s,calendar,signal,{snapshotBase:'../../data/raw/'});
  const block=raw.timeframes?.[timeframe];
  if(!usable(block)){
    const source=raw.retrieval==='DIRECT BROWSER'?'Public daily source':'GitHub scheduled snapshot';
    throw new Error('No usable '+timeframe+' data for '+s+'. '+source+' does not currently provide enough completed bars for this timeframe.');
  }
  return {symbol:s,sourceSymbol:s,asset:raw.security_type||'STOCK',timeframe,bars:block.bars,provider:block.provider||raw.quote?.provider||'Stock Truth data router',fetchedAt:block.fetched_at||raw.fetched_at,credentialPolicy:raw.retrieval==='DIRECT BROWSER'?'Public endpoint; no secret required.':'Sanitized GitHub Actions snapshot; repository secrets are not exposed to the browser.'};
}
