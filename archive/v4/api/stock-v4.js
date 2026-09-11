const {secFundamentals,withMarketPrice}=require('../lib/sec-fundamentals');
const BASE='https://stock-truth-v2.vercel.app/api/stock';
function send(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control',status===200?'s-maxage=180, stale-while-revalidate=600':'no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(obj));}
function clean(raw){const s=String(raw||'').trim().toUpperCase();return /^[A-Z0-9.^=-]{1,20}$/.test(s)?s:null;}
function usable(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function mergeFundamentals(base,sec,price){
  const s=withMarketPrice(sec,price);if(!s||s.error)return base;
  const y=base&&!base.error?base:null;
  if(!y)return{...s,source:'SEC EDGAR companyfacts',attempts:[{source:'Yahoo quoteSummary',error:base?.error||'unavailable'},{source:'SEC EDGAR',result:'success'}]};
  const out={...s};
  const currentFields=['forward_pe','ev_ebitda','dividend_ps'];
  for(const k of currentFields)if(usable(y[k]))out[k]=y[k];
  if(usable(y.mcap))out.mcap=y.mcap;
  if(usable(y.pe))out.pe=y.pe;
  if(usable(y.pb))out.pb=y.pb;
  if(usable(y.ps))out.ps=y.ps;
  if(usable(y.peg))out.peg=y.peg;
  out.sector=y.sector||null;out.industry=y.industry||null;out.currency=y.currency||out.currency;
  out.source='SEC EDGAR filings + Yahoo market snapshot';
  out.fetched_at=new Date().toISOString();
  out.attempts=[{source:'SEC EDGAR',result:'filing facts loaded'},{source:'Yahoo quoteSummary',result:'current market ratios/context loaded'}];
  out.note='Core financial statements and historical growth come from filed SEC XBRL facts. Current market multiples are used from Yahoo only when returned. Missing values remain unavailable.';
  return out;
}
module.exports=async function handler(req,res){
  if(req.method==='OPTIONS')return send(res,200,{ok:true});if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const symbol=clean(req.query?.symbol);if(!symbol)return send(res,400,{error:'Enter a valid ticker symbol.'});
  try{
    const [br,sf]=await Promise.all([
      fetch(`${BASE}?symbol=${encodeURIComponent(symbol)}`,{headers:{'Accept':'application/json'}}),
      secFundamentals(symbol).catch(e=>({source:'SEC EDGAR companyfacts',error:String(e?.message||e)}))
    ]);
    const base=await br.json().catch(()=>({error:`Base provider HTTP ${br.status}`}));
    if(!br.ok)return send(res,br.status,base);
    const merged=mergeFundamentals(base.fundamentals,sf,base.quote?.current||base.candles?.bars?.at(-1)?.close);
    base.fundamentals=merged;
    base.profile=base.profile||{};
    if((!base.profile.name||base.profile.error)&&sf&&!sf.error){base.profile={source:'SEC EDGAR companyfacts',fetched_at:new Date().toISOString(),name:sf.name||symbol,industry:merged?.industry||null,sector:merged?.sector||null,exchange:base.quote?.exchange||null,mcap:merged?.mcap||null};}
    base.context=base.context||{};base.context.fundamentals=merged;
    base.context.fundamentals_source=merged?.source||'unavailable';
    base.context.filing_date=merged?.filing_date||null;
    base.context.backtest_policy='SEC filing facts may be used historically only on or after their filing date. Current Yahoo ratios, earnings and revisions remain context-only unless historical snapshots exist.';
    base.schema_version=4;
    base.warnings=[...(base.warnings||[]),'Fundamentals v4: official SEC EDGAR companyfacts are used for U.S. filing-based financials; current market ratios are blended only when available.'];
    return send(res,200,base);
  }catch(e){return send(res,502,{symbol,error:String(e?.message||e)});}
};