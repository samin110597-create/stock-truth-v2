const UA='StockTruthV2/2.0 research-project https://github.com/samin110597-create/stock-truth-v2';
function send(res,status,obj){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control',status===200?'s-maxage=21600, stale-while-revalidate=43200':'no-store');res.end(JSON.stringify(obj));}
async function get(url){const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json','Accept-Encoding':'gzip, deflate'}});if(!r.ok)throw new Error(`SEC returned HTTP ${r.status}`);return r.json();}
function clean(raw){const s=String(raw||'').trim().toUpperCase();return /^[A-Z][A-Z0-9.-]{0,14}$/.test(s)?s:null;}
function normTicker(s){return String(s||'').toUpperCase().replace(/\./g,'-');}
function rowsFor(facts,tags,units){
  for(const tag of tags){const f=facts?.facts?.['us-gaap']?.[tag];if(!f)continue;for(const u of units){const arr=f.units?.[u];if(Array.isArray(arr)&&arr.length)return{tag,label:f.label||tag,unit:u,rows:arr};}}
  return null;
}
function annualFirstReported(metric){
  if(!metric)return[];const ok=metric.rows.filter(r=>['10-K','10-K/A','20-F','20-F/A','40-F','40-F/A'].includes(r.form)&&r.end&&r.filed&&Number.isFinite(Number(r.val)));
  const byEnd=new Map();for(const r of ok){const prev=byEnd.get(r.end);if(!prev||String(r.filed)<String(prev.filed))byEnd.set(r.end,r);}
  return [...byEnd.values()].sort((a,b)=>String(a.end).localeCompare(String(b.end))).map(r=>({end:r.end,filed:r.filed,form:r.form,fy:r.fy??null,fp:r.fp??null,val:Number(r.val),accn:r.accn||null}));
}
function annualLatestRestated(metric){
  if(!metric)return[];const ok=metric.rows.filter(r=>['10-K','10-K/A','20-F','20-F/A','40-F','40-F/A'].includes(r.form)&&r.end&&r.filed&&Number.isFinite(Number(r.val)));
  const byEnd=new Map();for(const r of ok){const prev=byEnd.get(r.end);if(!prev||String(r.filed)>String(prev.filed))byEnd.set(r.end,r);}
  return [...byEnd.values()].sort((a,b)=>String(a.end).localeCompare(String(b.end))).map(r=>({end:r.end,filed:r.filed,form:r.form,fy:r.fy??null,fp:r.fp??null,val:Number(r.val),accn:r.accn||null}));
}
function summarize(metric){const first=annualFirstReported(metric),latest=annualLatestRestated(metric);const a=first[first.length-1]||null,b=first[first.length-2]||null;return{tag:metric?.tag||null,label:metric?.label||null,unit:metric?.unit||null,latest_first_reported:a,prior_first_reported:b,growth_first_reported:a&&b&&b.val!==0?a.val/b.val-1:null,history_first_reported:first.slice(-12),history_latest_restated:latest.slice(-12)};}
module.exports=async function handler(req,res){
  if(req.method==='OPTIONS')return send(res,200,{ok:true});if(req.method!=='GET')return send(res,405,{error:'GET only'});
  const symbol=clean(req.query?.symbol);if(!symbol)return send(res,400,{error:'Valid U.S. ticker required.'});
  try{
    const map=await get('https://www.sec.gov/files/company_tickers.json');let hit=null;
    for(const v of Object.values(map||{})){if(normTicker(v?.ticker)===normTicker(symbol)){hit=v;break;}}
    if(!hit)return send(res,404,{symbol,status:'NOT_SEC_MAPPED',error:'Ticker not found in SEC company ticker map. Non-U.S. securities may not have SEC company facts.'});
    const cik=String(hit.cik_str).padStart(10,'0');const facts=await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    const metrics={
      revenue:rowsFor(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],['USD']),
      netIncome:rowsFor(facts,['NetIncomeLoss','ProfitLoss'],['USD']),
      operatingIncome:rowsFor(facts,['OperatingIncomeLoss'],['USD']),
      operatingCashflow:rowsFor(facts,['NetCashProvidedByUsedInOperatingActivities'],['USD']),
      capex:rowsFor(facts,['PaymentsToAcquirePropertyPlantAndEquipment'],['USD']),
      assets:rowsFor(facts,['Assets'],['USD']),
      liabilities:rowsFor(facts,['Liabilities'],['USD']),
      equity:rowsFor(facts,['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],['USD']),
      dilutedEPS:rowsFor(facts,['EarningsPerShareDiluted'],['USD/shares']),
      shares:rowsFor(facts,['WeightedAverageNumberOfDilutedSharesOutstanding','CommonStockSharesOutstanding'],['shares'])
    };
    const out={};for(const [k,m] of Object.entries(metrics))out[k]=summarize(m);
    return send(res,200,{schema_version:1,symbol,cik,entityName:facts.entityName||hit.title||null,source:'SEC companyfacts',generated_at:new Date().toISOString(),filing_date_available:true,metrics:out,backtest_policy:'For historical tests use history_first_reported and only observations whose filed date is on or before the historical signal date. history_latest_restated is for current reference only and must never be leaked backward.'});
  }catch(e){return send(res,502,{symbol,error:String(e?.message||e)});}
};