import {finite} from './numeric.mjs';
const BASE='https://tgmcharts.com/api/v1',HOUR=3600000;
const unavailable=(symbol,errors=[])=>({symbol,status:'UNAVAILABLE',classification:'UNAVAILABLE',reason:'FUNDAMENTALS UNAVAILABLE: '+(errors.join('; ')||'No sourced financial values returned.'),errors});
const keyMap={revenue:'revenue',operatingIncome:'operating_income',netIncome:'net_income',epsDiluted:'eps_diluted',operatingCashFlow:'operating_cash_flow',capitalExpenditure:'capital_expenditure',cashAndCashEquivalents:'cash',longTermDebt:'long_term_debt',shortTermDebt:'short_term_debt',totalAssets:'assets',totalLiabilities:'liabilities',totalStockholdersEquity:'equity',commonSharesOutstanding:'shares_outstanding',grossProfit:'gross_profit',stockBasedCompensation:'stock_compensation'};
export function parseStatements(symbol,statements,now=new Date().toISOString()){
  const metrics={};
  for(const statement of statements){
    if(statement?.symbol!==symbol||!Array.isArray(statement.rows))continue;
    for(const concept of statement.concepts||[]){
      const name=keyMap[concept.key];if(!name)continue;
      const history=statement.rows.flatMap(row=>{
        const p=row.provenance?.[concept.key],value=row.metrics?.[concept.key];
        if(!finite(value)||!p?.filed||p.filed>now.slice(0,10)||row.periodEnd>now.slice(0,10))return [];
        return [{value,unit:concept.unit,period_start:row.periodStart,period_end:row.periodEnd,basis:statement.period,filed:p.filed,accession:p.accn,tag:p.tag,form:p.form,derived:p.derived||null,inputs:p.inputs||[],classification:p.derived?'CALCULATION':'SOURCE FACT'}];
      }).sort((a,b)=>b.period_end.localeCompare(a.period_end));
      if(history.length)metrics[name]={latest:history[0],history,classification:history[0].classification};
    }
  }
  const derive=(name,a,b,fn,unit)=>{
    const x=metrics[a]?.latest,y=metrics[b]?.latest;
    if(!x||!y||x.period_end!==y.period_end||x.period_start!==y.period_start)return;
    const value=fn(x.value,y.value);if(!finite(value))return;
    const latest={...x,value,unit,tag:a+' / '+b,filed:[x.filed,y.filed].sort().at(-1),classification:'CALCULATION',inputs:[x.accession,y.accession]};
    metrics[name]={latest,history:[],classification:'CALCULATION'};
  };
  derive('free_cash_flow','operating_cash_flow','capital_expenditure',(a,b)=>a-Math.abs(b),'USD');
  derive('operating_margin','operating_income','revenue',(a,b)=>b>0?a/b:null,'ratio');
  derive('net_margin','net_income','revenue',(a,b)=>b>0?a/b:null,'ratio');
  const rev=metrics.revenue?.history||[];
  if(rev.length>1&&rev[0].basis==='annual'){
    const prior=rev.find((v,i)=>i&&Date.parse(rev[0].period_end)-Date.parse(v.period_end)>=330*86400000&&Date.parse(rev[0].period_end)-Date.parse(v.period_end)<=380*86400000);
    if(prior?.value>0)metrics.revenue_growth={classification:'CALCULATION',history:[],latest:{...rev[0],value:rev[0].value/prior.value-1,unit:'ratio',classification:'CALCULATION',tag:'Annual revenue / prior annual revenue − 1',inputs:[rev[0].accession,prior.accession]}};
  }
  return metrics;
}
export function combineFundamentals(symbol,summary,statements,errors=[],now=new Date().toISOString()){
  if(summary?.symbol!==symbol)summary=null;
  const metrics=parseStatements(symbol,statements,now),hasFacts=Object.keys(metrics).length>0;
  if(!summary&&!hasFacts)return unavailable(symbol,errors);
  return {symbol,status:errors.length?'PARTIAL':'AVAILABLE',classification:'SOURCE FACT + PROVIDER CALCULATIONS',provider:'TGMCharts · SEC EDGAR statements and provider-computed ratios',source_url:'https://tgmcharts.com/stocks/'+encodeURIComponent(symbol)+'/financials',fetched_at:now,source_updated_at:summary?.asOf?.dataUpdatedAt||statements.map(s=>s.asOf).filter(Boolean).sort().at(-1)||null,
    summary,metrics,errors,statements:statements.map(s=>({statement:s.statement,period:s.period,status:s.status||'AVAILABLE',reason:s.reason||null,as_of:s.asOf,source:s.source,methodology:s.methodology})),
    note:'Annual flows are labeled annual, not TTM. Summary ratios use the provider’s stated basis. Per-share filing facts are not adjusted for subsequent splits. Present-day facts never enter historical price forecasts.'};
}
async function get(url,signal){const r=await fetch(url,{credentials:'omit',cache:'default',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();}
export async function retrieveFundamentals(symbol,signal,{snapshotBase='../data/fundamentals/',snapshot=null,storage=undefined}={}){
  if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol))return unavailable(symbol,['No compatible filing symbol.']);
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
  const key='stocktruth-fundamentals-v1:'+symbol;
  try{const c=JSON.parse(storage?.getItem(key)||'null'),age=Date.now()-Date.parse(c?.fetched_at);if(c?.symbol===symbol&&age>=0&&age<HOUR)return c;}catch{}
  const specs=[['summary',`${BASE}/summary/${symbol}`],['income-statement',`${BASE}/statements/${symbol}/income-statement?years=4`],['balance-sheet',`${BASE}/statements/${symbol}/balance-sheet?period=quarterly&years=1`],['cash-flow',`${BASE}/statements/${symbol}/cash-flow?years=4`]];
  const requests=specs.map(([,url])=>get(url,signal));
  requests.push(snapshot?Promise.resolve(snapshot):get(snapshotBase+encodeURIComponent(symbol)+'.json',signal));
  const results=await Promise.allSettled(requests);if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const errors=[],statements=[];let summary=null;
  specs.forEach(([kind],i)=>{const r=results[i];if(r.status!=='fulfilled'){errors.push(kind+': '+r.reason.message);return;}const x=r.value;if(x.symbol!==symbol){errors.push(kind+': ticker identity mismatch');return;}if(i===0)summary=x;else{statements.push(x);if(x.status)errors.push(kind+': '+x.status+' '+(x.reason||''));}});
  let out=combineFundamentals(symbol,summary,statements,errors);
  const cached=results[4].status==='fulfilled'?results[4].value:null;
  if(cached?.symbol===symbol&&(cached.metrics||cached.summary)){
    if(out.status==='UNAVAILABLE')out={...cached,status:'STALE',latest_attempt_error:out.reason,errors};
    else if(!Object.keys(out.metrics).length&&Object.keys(cached.metrics||{}).length)out={...out,metrics:cached.metrics,filing_fallback:{fetched_at:cached.fetched_at,status:'CACHED'},status:'PARTIAL'};
  }
  try{if(out.status!=='UNAVAILABLE'&&out.status!=='STALE')storage?.setItem(key,JSON.stringify(out));}catch{}
  return out;
}
