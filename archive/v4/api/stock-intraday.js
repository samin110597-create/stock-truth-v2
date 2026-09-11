const UA='Mozilla/5.0 StockTruthV2/6.0 research-dashboard';

function send(res,status,obj){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control',status===200?'s-maxage=60, stale-while-revalidate=180':'no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(obj));
}
function cleanSymbol(raw){
  const s=String(raw||'').trim().toUpperCase();
  return /^[A-Z0-9.^=-]{1,20}$/.test(s)?s:null;
}
const TF={
  '1h':{interval:'60m',range:'2y',seconds:3600},
  '30min':{interval:'30m',range:'60d',seconds:1800},
  '15min':{interval:'15m',range:'60d',seconds:900},
  '5min':{interval:'5m',range:'60d',seconds:300}
};
function cleanTf(raw){const s=String(raw||'').trim();return TF[s]?s:null;}
async function getJson(url){
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json'}});
  if(!r.ok)throw new Error(`provider returned HTTP ${r.status}`);
  return r.json();
}
function makeBars(result,seconds){
  const ts=result.timestamp||[],q=result.indicators?.quote?.[0]||{},out=[];
  for(let i=0;i<ts.length;i++){
    const o=Number(q.open?.[i]),h=Number(q.high?.[i]),l=Number(q.low?.[i]),c=Number(q.close?.[i]),v=Number(q.volume?.[i]);
    if(![o,h,l,c].every(Number.isFinite)||c<=0)continue;
    out.push({date:new Date(Number(ts[i])*1000).toISOString(),open:o,high:h,low:l,close:c,volume:Number.isFinite(v)?v:null,ts:Number(ts[i])});
  }
  if(out.length){
    const last=out[out.length-1],now=Math.floor(Date.now()/1000);
    if(Number.isFinite(last.ts)&&now<last.ts+seconds+45)out.pop();
  }
  return out.map(({ts,...b})=>b);
}

module.exports=async function handler(req,res){
  if(req.method==='OPTIONS')return send(res,200,{ok:true});
  if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const symbol=cleanSymbol(req.query?.symbol),tf=cleanTf(req.query?.tf);
  if(!symbol)return send(res,400,{error:'Enter a valid ticker symbol.'});
  if(!tf)return send(res,400,{error:'Supported timeframes: 1h, 30min, 15min, 5min.'});
  const cfg=TF[tf];
  try{
    const u=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
    u.searchParams.set('range',cfg.range);
    u.searchParams.set('interval',cfg.interval);
    u.searchParams.set('includeAdjustedClose','false');
    u.searchParams.set('events','div,splits');
    const j=await getJson(u),r=j?.chart?.result?.[0];
    if(!r)throw new Error(j?.chart?.error?.description||'ticker not found');
    const bars=makeBars(r,cfg.seconds);
    if(bars.length<60)return send(res,422,{symbol,tf,error:`Only ${bars.length} usable closed ${tf} bars were found.`});
    const meta=r.meta||{};
    return send(res,200,{schema_version:1,symbol,generated_at:new Date().toISOString(),timeframe:tf,candles:{source:'yahoo-chart-server',fetched_at:new Date().toISOString(),bars,n:bars.length,interval:tf,latest:bars.at(-1)?.date||null,closed_bars_only:true,confidence:'MEDIUM'},quote:{source:'yahoo-chart-server',fetched_at:new Date().toISOString(),current:Number.isFinite(Number(meta.regularMarketPrice))?Number(meta.regularMarketPrice):bars.at(-1)?.close||null,currency:meta.currency||null},data_quality:{range_requested:cfg.range,interval_requested:cfg.interval,bars_returned:bars.length,forming_bar_excluded:true}});
  }catch(e){return send(res,502,{symbol,tf,error:String(e?.message||e)});}
};
