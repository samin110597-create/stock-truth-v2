const UA='Mozilla/5.0 StockTruthV3.3 corporate-action-safe-technicals';
function send(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control',status===200?'s-maxage=120, stale-while-revalidate=300':'no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(obj));}
const clean=s=>{s=String(s||'').trim().toUpperCase();return /^[A-Z0-9.^=-]{1,20}$/.test(s)?s:null;};
const TF={
  '1day':{interval:'1d',range:'max',seconds:86400,daily:true},
  '1h':{interval:'60m',range:'2y',seconds:3600},
  '30min':{interval:'30m',range:'60d',seconds:1800},
  '15min':{interval:'15m',range:'60d',seconds:900},
  '5min':{interval:'5m',range:'60d',seconds:300}
};
async function chart(symbol,cfg){
  const u=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set('range',cfg.range);u.searchParams.set('interval',cfg.interval);
  u.searchParams.set('includeAdjustedClose','false');u.searchParams.set('includePrePost','false');
  u.searchParams.set('events','splits');
  const r=await fetch(u,{headers:{'User-Agent':UA,'Accept':'application/json'},cache:'no-store'});
  if(!r.ok)throw new Error(`Yahoo chart ${cfg.interval} HTTP ${r.status}`);
  const j=await r.json(),x=j?.chart?.result?.[0];if(!x)throw new Error(j?.chart?.error?.description||'ticker not found');return x;
}
function nyDate(sec){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(sec*1000));const m=Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;}
function splitEvents(x){
  return Object.values(x?.events?.splits||{}).map(z=>{
    let ratio=Number(z.numerator)/Number(z.denominator);
    if(!Number.isFinite(ratio)||ratio<=0){const m=String(z.splitRatio||'').match(/([0-9.]+)\s*:\s*([0-9.]+)/);ratio=m&&Number(m[2])?Number(m[1])/Number(m[2]):1;}
    return{ts:Number(z.date),date:nyDate(Number(z.date)),ratio,display:String(z.splitRatio||`${Number(z.numerator)||'?'}:${Number(z.denominator)||'?'}`)};
  }).filter(z=>Number.isFinite(z.ts)&&Number.isFinite(z.ratio)&&z.ratio>0&&Math.abs(z.ratio-1)>1e-9).sort((a,b)=>a.ts-b.ts);
}
function providerBars(x,cfg){
  const ts=x.timestamp||[],q=x.indicators?.quote?.[0]||{},out=[];
  for(let i=0;i<ts.length;i++){
    const o=Number(q.open?.[i]),h=Number(q.high?.[i]),l=Number(q.low?.[i]),c=Number(q.close?.[i]),v=Number(q.volume?.[i]),t=Number(ts[i]);
    if(![o,h,l,c,t].every(Number.isFinite)||c<=0)continue;
    /* Yahoo historical OHLC is already split-adjusted. Do NOT apply split ratios here again. */
    out.push({date:cfg.daily?nyDate(t):new Date(t*1000).toISOString(),open:o,high:h,low:l,close:c,volume:Number.isFinite(v)&&v>=0?v:null,ts:t});
  }
  if(out.length){const now=Math.floor(Date.now()/1000),last=out.at(-1),reg=x?.meta?.currentTradingPeriod?.regular||{};
    if(cfg.daily){if(reg.start&&reg.end&&now>=Number(reg.start)&&now<Number(reg.end)+900&&last.date===nyDate(now))out.pop();}
    else if(now<last.ts+cfg.seconds+45)out.pop();}
  return out;
}
function nearestBefore(rows,ts){for(let i=rows.length-1;i>=0;i--)if(rows[i].ts<ts)return rows[i];return null;}
function nearestAfter(rows,ts){for(const r of rows)if(r.ts>=ts)return r;return null;}
function normalizeIfNeeded(rows,events){
  const audit=[];let adjusted=false;
  for(const e of events){
    let pre=nearestBefore(rows,e.ts),post=nearestAfter(rows,e.ts);if(!pre||!post||!pre.close||!post.open){audit.push({...e,status:'NO_OVERLAP'});continue;}
    let observed=post.open/pre.close,mechanical=1/e.ratio;
    const mechanicalDistance=Math.abs(Math.log(observed/mechanical));
    const continuityDistance=Math.abs(Math.log(observed));
    const looksUnadjusted=mechanicalDistance<0.22&&mechanicalDistance+0.55<continuityDistance;
    if(looksUnadjusted){
      /* Only normalize when the provider actually exposes the mechanical split jump. */
      for(const r of rows)if(r.ts<e.ts){r.open/=e.ratio;r.high/=e.ratio;r.low/=e.ratio;r.close/=e.ratio;if(Number.isFinite(r.volume))r.volume*=e.ratio;}
      adjusted=true;pre=nearestBefore(rows,e.ts);post=nearestAfter(rows,e.ts);observed=post.open/pre.close;
    }
    const residual=Math.abs(Math.log(observed));
    audit.push({...e,observed_open_vs_prior_close:observed-1,provider_series_was_unadjusted:looksUnadjusted,normalized_by_stock_truth:looksUnadjusted,status:residual<0.55?'CONTINUOUS':'LARGE_REAL_MOVE_OR_DATA_ISSUE'});
  }
  return{rows,audit,adjusted};
}
function buildBars(x,cfg){
  const raw=providerBars(x,cfg),events=splitEvents(x),norm=normalizeIfNeeded(raw,events);
  return{bars:norm.rows.map(({ts,...z})=>z),splitAudit:norm.audit,normalized:norm.adjusted,events};
}
module.exports=async function handler(req,res){
  if(req.method==='OPTIONS')return send(res,200,{ok:true});if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const symbol=clean(req.query?.symbol),tf=String(req.query?.tf||'1day');if(!symbol)return send(res,400,{error:'Enter a valid ticker.'});if(!TF[tf])return send(res,400,{error:'Supported timeframes: 1day, 1h, 30min, 15min, 5min.'});
  try{
    const cfg=TF[tf],[selR,dayR]=await Promise.all([chart(symbol,cfg),cfg.daily?Promise.resolve(null):chart(symbol,TF['1day'])]);
    const sel=buildBars(selR,cfg),day=cfg.daily?sel:buildBars(dayR,TF['1day']),selected=sel.bars,daily=day.bars;
    if(selected.length<60)return send(res,422,{symbol,tf,error:`Only ${selected.length} completed ${tf} bars available.`});
    if(daily.length<120)return send(res,422,{symbol,tf,error:`Only ${daily.length} completed daily bars available.`});
    const splitIssues=[...sel.splitAudit,...day.splitAudit].filter(x=>x.status==='LARGE_REAL_MOVE_OR_DATA_ISSUE');
    return send(res,200,{schema_version:2,symbol,timeframe:tf,generated_at:new Date().toISOString(),
      selected:{source:'yahoo-provider-split-adjusted-server',bars:selected,n:selected.length,latest:selected.at(-1)?.date||null},
      daily:{source:'yahoo-provider-split-adjusted-server',bars:daily,n:daily.length,latest:daily.at(-1)?.date||null},
      corporate_actions:{splits:day.events,audit:day.splitAudit,integrity:splitIssues.length?'REVIEW':'OK'},
      data_quality:{forming_bar_excluded:true,price_adjustment:'provider split-adjusted OHLC; Stock Truth never double-adjusts. Mechanical split normalization is applied only if an unadjusted discontinuity is detected.',volume_adjustment:'provider historical volume used as returned; adjusted only if the integrity audit proves the provider exposed an unadjusted split.',corporate_action_audit:true,stock_truth_normalized_selected:sel.normalized,stock_truth_normalized_daily:day.normalized,purpose:'technical price levels and indicators; total-return comparisons use the separate adjusted-return context endpoint'}});
  }catch(e){return send(res,502,{symbol,tf,error:String(e?.message||e)});}
};