// Bounded provider diagnostics. Never print request URLs, headers, keys, or raw errors.
const symbol=String(process.env.CHECK_SYMBOL||'NVDA').toUpperCase();
if(!/^[A-Z][A-Z0-9.-]{0,19}$/.test(symbol))throw Error('Invalid diagnostic symbol');
const now=Math.floor(Date.now()/1000),date=t=>new Date(t*1000).toISOString().slice(0,10);
const timestamp=t=>Number.isFinite(t)&&t>0?new Date(t*1000).toISOString():null;
async function probe(provider,url,init,read){
 try{const r=await fetch(url,{...init,signal:AbortSignal.timeout(12000)});if(!r.ok)return {provider,http:r.status};
 const j=await r.json();return {provider,http:r.status,...read(j)};
 }catch{return {provider,status:'NETWORK_OR_FORMAT_FAILURE'};}
}
const yahoo=j=>{const x=j.chart?.result?.[0],t=x?.timestamp||[];return {rows:t.length,lastBarStart:timestamp(Math.max(...t)),currency:x?.meta?.currency||null,error:!!j.chart?.error};};
const jobs=[probe('Yahoo hourly','https://query1.finance.yahoo.com/v8/finance/chart/'+symbol+'?interval=60m&range=3mo&includePrePost=false',{},yahoo),
 probe('Production gateway','https://stock-truth-data.samin110597.workers.dev/v1/history?symbol='+symbol+'&timeframe=1H',{},j=>{const t=j.format==='massive'?(j.payload?.results||[]).map(x=>x.t/1000):j.payload?.chart?.result?.[0]?.timestamp||[];return {selectedProvider:j.provider||null,rows:t.length,lastBarStart:timestamp(Math.max(...t))};})];
if(process.env.MASSIVE_KEY)jobs.push(probe('Massive intraday','https://api.massive.com/v2/aggs/ticker/'+symbol+'/range/30/minute/'+date(now-3*86400)+'/'+date(now)+'?adjusted=true&sort=desc&limit=50000',{headers:{Authorization:'Bearer '+process.env.MASSIVE_KEY}},j=>({rows:j.results?.length||0,lastBarStart:timestamp(Math.max(...(j.results||[]).map(x=>x.t/1000))),status:['OK','DELAYED','NOT_AUTHORIZED','ERROR'].includes(j.status)?j.status:'OTHER'})));
if(process.env.FMP_KEY)jobs.push(probe('FMP intraday','https://financialmodelingprep.com/stable/historical-chart/30min?'+new URLSearchParams({symbol,from:date(now-30*86400),to:date(now),apikey:process.env.FMP_KEY}),{},j=>({rows:Array.isArray(j)?j.length:0,lastProviderDate:Array.isArray(j)&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(j[0]?.date)?j[0].date:null,error:!Array.isArray(j)})));
if(process.env.FINNHUB_KEY)jobs.push(probe('Finnhub candles','https://finnhub.io/api/v1/stock/candle?'+new URLSearchParams({symbol,resolution:'60',from:String(now-3*86400),to:String(now)}),{headers:{'X-Finnhub-Token':process.env.FINNHUB_KEY}},j=>({rows:j.t?.length||0,lastBarStart:timestamp(Math.max(...(j.t||[]))),available:j.s==='ok'})));
if(process.env.ALPHA_VANTAGE_KEY)jobs.push(probe('Alpha Vantage intraday','https://www.alphavantage.co/query?'+new URLSearchParams({function:'TIME_SERIES_INTRADAY',symbol,interval:'30min',outputsize:'compact',apikey:process.env.ALPHA_VANTAGE_KEY}),{},j=>({rows:Object.keys(j['Time Series (30min)']||{}).length,providerNotice:!!(j.Information||j.Note||j['Error Message'])})));
console.log(JSON.stringify({symbol,checkedAt:new Date().toISOString(),results:await Promise.all(jobs)},null,2));
