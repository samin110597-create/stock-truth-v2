const UA='StockTruthV2 research-dashboard https://github.com/samin110597-create/stock-truth-v2';
const ANNUAL_FORMS=new Set(['10-K','10-K/A','20-F','20-F/A','40-F','40-F/A']);
async function get(url){
  const r=await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json','Accept-Encoding':'gzip, deflate'}});
  if(!r.ok)throw new Error(`SEC returned HTTP ${r.status}`);
  return r.json();
}
function normTicker(s){return String(s||'').toUpperCase().replace(/\./g,'-');}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function ratio(a,b){return n(a)!=null&&n(b)!=null&&Number(b)!==0?Number(a)/Number(b):null;}
function days(a,b){if(!a||!b)return null;const x=Date.parse(a),y=Date.parse(b);return Number.isFinite(x)&&Number.isFinite(y)?Math.round((y-x)/86400000):null;}
function pickMetric(facts,tags,units){
  const taxonomies=['us-gaap','ifrs-full'];
  for(const taxonomy of taxonomies){
    for(const tag of tags){
      const f=facts?.facts?.[taxonomy]?.[tag];if(!f)continue;
      for(const unit of units){const rows=f.units?.[unit];if(Array.isArray(rows)&&rows.length)return{taxonomy,tag,label:f.label||tag,unit,rows};}
    }
  }
  return null;
}
function annual(metric,duration=true){
  if(!metric)return[];
  const rows=metric.rows.filter(r=>ANNUAL_FORMS.has(r.form)&&r.end&&r.filed&&n(r.val)!=null).filter(r=>{
    if(!duration||!r.start)return true;
    const d=days(r.start,r.end);return d==null||(d>=300&&d<=430);
  });
  const byYear=new Map();
  for(const r of rows){
    const year=Number(String(r.end).slice(0,4));if(!Number.isFinite(year))continue;
    const prev=byYear.get(year);
    const score=(String(r.fp||'').toUpperCase()==='FY'?4:0)+(r.frame?1:0)+(r.start?1:0);
    const ps=prev?.__score??-1;
    if(!prev||score>ps||(score===ps&&String(r.filed)>String(prev.filed)))byYear.set(year,{...r,val:Number(r.val),__score:score});
  }
  return [...byYear.values()].sort((a,b)=>String(a.end).localeCompare(String(b.end))).map(({__score,...r})=>r);
}
function latest(hist){return hist?.length?hist[hist.length-1]:null;}
function byYear(hist){return new Map((hist||[]).map(r=>[Number(String(r.end).slice(0,4)),r]));}
function cagr(end,start,years){return end>0&&start>0&&years>0?Math.pow(end/start,1/years)-1:null;}
function valueAt(hist,year){return byYear(hist).get(year)?.val??null;}
function metricHistory(facts,tags,units,duration=true){return annual(pickMetric(facts,tags,units),duration);}
async function secFundamentals(symbol){
  const map=await get('https://www.sec.gov/files/company_tickers.json');let hit=null;
  for(const v of Object.values(map||{})){if(normTicker(v?.ticker)===normTicker(symbol)){hit=v;break;}}
  if(!hit)return{source:'SEC EDGAR companyfacts',error:'Ticker is not mapped in the SEC company-ticker file. Non-U.S. securities and some funds may not have SEC company facts.'};
  const cik=String(hit.cik_str).padStart(10,'0');
  const facts=await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const H={
    revenue:metricHistory(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],['USD']),
    gross:metricHistory(facts,['GrossProfit'],['USD']),
    op:metricHistory(facts,['OperatingIncomeLoss'],['USD']),
    net:metricHistory(facts,['NetIncomeLoss','ProfitLoss'],['USD']),
    ocf:metricHistory(facts,['NetCashProvidedByUsedInOperatingActivities','NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],['USD']),
    capex:metricHistory(facts,['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForAdditionsToPropertyPlantAndEquipment'],['USD']),
    assets:metricHistory(facts,['Assets'],['USD'],false),
    liabilities:metricHistory(facts,['Liabilities'],['USD'],false),
    equity:metricHistory(facts,['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],['USD'],false),
    currentAssets:metricHistory(facts,['AssetsCurrent'],['USD'],false),
    currentLiabilities:metricHistory(facts,['LiabilitiesCurrent'],['USD'],false),
    inventory:metricHistory(facts,['InventoryNet'],['USD'],false),
    cash:metricHistory(facts,['CashAndCashEquivalentsAtCarryingValue','CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],['USD'],false),
    debt:metricHistory(facts,['LongTermDebtAndFinanceLeaseObligations','LongTermDebt','LongTermDebtNoncurrent'],['USD'],false),
    interest:metricHistory(facts,['InterestExpenseNonOperating','InterestExpense'],['USD']),
    pretax:metricHistory(facts,['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest','IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],['USD']),
    tax:metricHistory(facts,['IncomeTaxExpenseBenefit'],['USD']),
    eps:metricHistory(facts,['EarningsPerShareDiluted','EarningsPerShareBasicAndDiluted'],['USD/shares']),
    shares:metricHistory(facts,['WeightedAverageNumberOfDilutedSharesOutstanding','CommonStockSharesOutstanding'],['shares'])
  };
  const rev=latest(H.revenue);if(!rev)return{source:'SEC EDGAR companyfacts',cik,entityName:facts.entityName||hit.title||symbol,error:'SEC filing exists, but a usable annual revenue fact was not found.'};
  const year=Number(String(rev.end).slice(0,4));
  const years=H.revenue.map(r=>Number(String(r.end).slice(0,4))).filter(Number.isFinite);
  const annualRows=years.slice(-8).map(y=>{
    const revenue=valueAt(H.revenue,y),net=valueAt(H.net,y),ocf=valueAt(H.ocf,y),capex=Math.abs(valueAt(H.capex,y)||0),fcf=ocf!=null?ocf-capex:null;
    return{year:y,filed:byYear(H.revenue).get(y)?.filed||null,revenue,net_income:net,fcf,gross:ratio(valueAt(H.gross,y),revenue),op:ratio(valueAt(H.op,y),revenue),net:ratio(net,revenue),equity:valueAt(H.equity,y),assets:valueAt(H.assets,y),debt:valueAt(H.debt,y)};
  });
  const latestRow=annualRows[annualRows.length-1]||{},prior3=annualRows.length>=4?annualRows[annualRows.length-4]:null,prior5=annualRows.length>=6?annualRows[annualRows.length-6]:null;
  const revenue=latestRow.revenue,netIncome=latestRow.net_income,ocf=latestRow.fcf!=null&&valueAt(H.capex,year)!=null?latestRow.fcf+Math.abs(valueAt(H.capex,year)||0):valueAt(H.ocf,year),capex=Math.abs(valueAt(H.capex,year)||0),fcf=latestRow.fcf;
  const equity=valueAt(H.equity,year),assets=valueAt(H.assets,year),liabilities=valueAt(H.liabilities,year),cash=valueAt(H.cash,year),debt=valueAt(H.debt,year),shares=valueAt(H.shares,year),eps=valueAt(H.eps,year),opIncome=valueAt(H.op,year),gross=valueAt(H.gross,year);
  const ca=valueAt(H.currentAssets,year),cl=valueAt(H.currentLiabilities,year),inv=valueAt(H.inventory,year),interest=Math.abs(valueAt(H.interest,year)||0),pretax=valueAt(H.pretax,year),tax=valueAt(H.tax,year);
  const taxRate=pretax&&tax!=null?Math.min(0.5,Math.max(0,tax/pretax)):0.21,invested=(equity||0)+(debt||0)-(cash||0);
  const epsStart=prior3?valueAt(H.eps,prior3.year):null,fcfStart=prior3?.fcf;
  return{
    source:'SEC EDGAR companyfacts',fetched_at:new Date().toISOString(),cik,filing_date:rev.filed||null,period:year,years:annualRows.length,currency:'USD',is_etf:false,name:facts.entityName||hit.title||symbol,annual:annualRows,
    revenue,net_income:netIncome,eps_ttm:eps,bvps:shares&&equity?equity/shares:null,fcf_latest:fcf,fcf_base:annualRows.length>1&&annualRows.at(-2)?.fcf!=null?(fcf+annualRows.at(-2).fcf)/2:fcf,
    rev_cagr_3y:prior3?cagr(revenue,prior3.revenue,3):null,rev_cagr_5y:prior5?cagr(revenue,prior5.revenue,5):null,eps_cagr:prior3?cagr(eps,epsStart,3):null,fcf_cagr:prior3?cagr(fcf,fcfStart,3):null,
    gross_margin:ratio(gross,revenue),op_margin:ratio(opIncome,revenue),net_margin:ratio(netIncome,revenue),fcf_margin:ratio(fcf,revenue),roe:ratio(netIncome,equity),roa:ratio(netIncome,assets),roic:invested>0&&opIncome!=null?opIncome*(1-taxRate)/invested:null,
    debt_to_equity:ratio(debt,equity),net_cash:cash!=null&&debt!=null?cash-debt:null,total_debt:debt,cash,current_ratio:ratio(ca,cl),quick_ratio:ca!=null&&cl?((ca-(inv||0))/cl):null,interest_coverage:interest>0&&opIncome!=null?opIncome/interest:null,
    capex,ocf,tax_rate:taxRate,assets,liabilities,equity,shares,
    pe:null,forward_pe:null,pb:null,ps:null,peg:null,ev_ebitda:null,dividend_ps:null,buyback:null,
    attempts:[],note:'Official SEC EDGAR/XBRL filing facts. Values are filing-derived and carry a filing date; current market-price multiples are added separately when possible.'
  };
}
function withMarketPrice(f,price){
  if(!f||f.error)return f;const p=n(price);if(p==null||p<=0)return f;
  const out={...f};out.mcap=out.shares?p*out.shares:null;out.pe=out.eps_ttm>0?p/out.eps_ttm:null;out.pb=out.bvps>0?p/out.bvps:null;out.ps=out.mcap&&out.revenue?out.mcap/out.revenue:null;
  const growth=out.eps_cagr!=null?out.eps_cagr*100:null;out.peg=out.pe&&growth>0?out.pe/growth:null;return out;
}
module.exports={secFundamentals,withMarketPrice};