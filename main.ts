const MASSIVE = Deno.env.get("MASSIVE_KEY") || Deno.env.get("POLYGON_KEY") || "";
const FMP = Deno.env.get("FMP_API_KEY") || Deno.env.get("FMP_KEY") || "";
const FINNHUB = Deno.env.get("FINNHUB_API_KEY") || Deno.env.get("FINNHUB_KEY") || "";
const ALPHA = Deno.env.get("ALPHA_VANTAGE_KEY") || Deno.env.get("ALPHAVANTAGE_KEY") || "";
const LAYA_SERVICE_URL = Deno.env.get("LAYA_SERVICE_URL") || "";
const LAYA_SERVICE_TOKEN = Deno.env.get("LAYA_SERVICE_TOKEN") || "";
const ALLOWED = new Set([
  "https://samin110597-create.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

const FUTURES: Record<string,string> = {
  GOLD:"GC=F",GC:"GC=F",XAU:"GC=F",XAUUSD:"GC=F",
  SILVER:"SI=F",SI:"SI=F",XAG:"SI=F",XAGUSD:"SI=F",
  OIL:"CL=F",WTI:"CL=F",CRUDE:"CL=F",CL:"CL=F",
  NATGAS:"NG=F",NATURALGAS:"NG=F",NG:"NG=F",
  COPPER:"HG=F",HG:"HG=F",PLATINUM:"PL=F",PL:"PL=F",
  PALLADIUM:"PA=F",PA:"PA=F",
};

type Bar = {
  ts:number; end_ts:number; date:string; session:string;
  open:number; high:number; low:number; close:number; volume:number|null; complete:true;
  component_bars?:number;
};
type Frame = {status:string;provider:string;fetched_at:string;bars:Bar[]};
type Trace = {source:string;status:string;bars?:number;last?:string;reason?:string};

const nowIso=()=>new Date().toISOString();
const clean=(s:string)=>String(s||"").trim().toUpperCase().replace(/\s+/g,"");
const finite=(v:unknown)=>Number.isFinite(Number(v));
const num=(v:unknown)=>finite(v)?Number(v):null;

function cors(origin:string|null){
  const allow = origin && ALLOWED.has(origin) ? origin : "https://samin110597-create.github.io";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type",
    "access-control-max-age":"86400",
    "vary":"Origin",
  };
}
function json(data:unknown,status=200,origin:string|null=null){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...cors(origin)}});
}
function toDate(ts:number){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ts*1000));
}
function minuteOfDayNY(ts:number){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour12:false,hour:"2-digit",minute:"2-digit"}).formatToParts(new Date(ts*1000));
  const h=Number(parts.find(x=>x.type==="hour")?.value||0),m=Number(parts.find(x=>x.type==="minute")?.value||0);
  return h*60+m;
}
function bar(ts:number,o:unknown,h:unknown,l:unknown,c:unknown,v:unknown,end:number):Bar|null{
  const O=num(o),H=num(h),L=num(l),C=num(c),V=num(v);
  if([O,H,L,C].some(x=>x===null||x!<=0)) return null;
  if(H! < Math.max(O!,L!,C!) || L! > Math.min(O!,H!,C!)) return null;
  const date=toDate(ts);
  return {ts,end_ts:end,date,session:date,open:O!,high:H!,low:L!,close:C!,volume:V!==null&&V>=0?V:null,complete:true};
}
function completed(rows:(Bar|null)[]){
  const cutoff=Math.floor(Date.now()/1000)-45;
  return rows.filter((x):x is Bar=>!!x&&x.end_ts<cutoff);
}
function regular(rows:Bar[]){
  return rows.filter(x=>{const m=minuteOfDayNY(x.ts);return m>=570&&m<960;}).sort((a,b)=>a.ts-b.ts);
}
function resample(rows:Bar[],minutes:number,regularSession=true){
  const source=regularSession?regular(rows):[...rows].sort((a,b)=>a.ts-b.ts);
  const groups=new Map<string,Bar[]>();
  for(const b of source){
    const key=regularSession
      ? b.session+":"+Math.floor((minuteOfDayNY(b.ts)-570)/minutes)
      : String(Math.floor(b.ts/(minutes*60)));
    const g=groups.get(key)||[];g.push(b);groups.set(key,g);
  }
  const out:Bar[]=[];
  for(const g of groups.values()){
    g.sort((a,b)=>a.ts-b.ts);const first=g[0],last=g.at(-1)!;
    out.push({ts:first.ts,end_ts:last.end_ts,date:last.date,session:last.session,open:first.open,
      high:Math.max(...g.map(x=>x.high)),low:Math.min(...g.map(x=>x.low)),close:last.close,
      volume:g.every(x=>x.volume!==null)?g.reduce((s,x)=>s+(x.volume||0),0):null,complete:true,component_bars:g.length});
  }
  return out.sort((a,b)=>a.ts-b.ts);
}
function current(tf:string,rows:Bar[]){
  if(!rows.length)return false;
  const age=(Date.now()/1000-rows.at(-1)!.end_ts)/60;
  return age <= (tf==="1D"?60*24*7:60*24*4);
}
async function getJson(url:string,params:Record<string,string>={}){
  const u=new URL(url);for(const [k,v] of Object.entries(params))if(v)u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{"user-agent":"QState-Deno/1.0","accept":"application/json"}});
  if(!r.ok) throw new Error("HTTP "+r.status);
  return await r.json();
}
async function massive(symbol:string,intraday:boolean){
  if(!MASSIVE)throw new Error("key missing");
  const end=new Date(),start=new Date(end.getTime()-(intraday?180:3655)*86400000);
  const a=start.toISOString().slice(0,10),b=end.toISOString().slice(0,10);
  const url=`https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${intraday?"15/minute":"1/day"}/${a}/${b}`;
  const j:any=await getJson(url,{adjusted:"true",sort:"asc",limit:"50000",apiKey:MASSIVE});
  const sec=intraday?900:86400;
  let rows=completed((j.results||[]).map((x:any)=>bar(Math.floor(x.t/1000),x.o,x.h,x.l,x.c,x.v,Math.floor(x.t/1000)+sec)));
  if(intraday)rows=regular(rows);
  if(rows.length<(intraday?300:180))throw new Error("too shallow");
  return {provider:"Massive",bars:rows};
}
async function yahoo(symbol:string,interval:string,range:string,seconds:number,intraday=false,regularSession=true){
  const j:any=await getJson("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol),{
    interval,range,includePrePost:"false",includeAdjustedClose:"false",events:"splits"
  });
  const r=j?.chart?.result?.[0];if(!r)throw new Error("Yahoo unavailable");
  const q=r?.indicators?.quote?.[0]||{},ts=r.timestamp||[];const rows:(Bar|null)[]=[];
  for(let i=0;i<ts.length;i++)rows.push(bar(ts[i],q.open?.[i],q.high?.[i],q.low?.[i],q.close?.[i],q.volume?.[i],ts[i]+seconds));
  let out=completed(rows);if(intraday&&regularSession)out=regular(out);
  if(out.length<80)throw new Error("Yahoo too shallow");
  return {provider:"Yahoo server fallback",bars:out};
}
async function fmp(symbol:string,intraday:boolean){
  if(!FMP)throw new Error("key missing");
  const end=new Date(),start=new Date(end.getTime()-(intraday?180:3655)*86400000);
  const url=intraday?"https://financialmodelingprep.com/stable/historical-chart/15min":"https://financialmodelingprep.com/stable/historical-price-eod/full";
  const j:any=await getJson(url,{symbol,from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),apikey:FMP});
  const rows=Array.isArray(j)?j:(j?.historical||[]);const out:(Bar|null)[]=[];
  for(const x of rows){
    const ds=String(x.date||"");if(!ds)continue;
    const dt=intraday?new Date(ds.replace(" ","T")+"-04:00"):new Date(ds.slice(0,10)+"T09:30:00-04:00");
    const ts=Math.floor(dt.getTime()/1000),sec=intraday?900:23400;
    out.push(bar(ts,x.open,x.high,x.low,x.close,x.volume,ts+sec));
  }
  let cleanRows=completed(out);if(intraday)cleanRows=regular(cleanRows);cleanRows.sort((a,b)=>a.ts-b.ts);
  if(cleanRows.length<(intraday?300:180))throw new Error("too shallow");
  return {provider:"FMP",bars:cleanRows};
}
async function finnhub(symbol:string,intraday:boolean){
  if(!FINNHUB)throw new Error("key missing");
  const to=Math.floor(Date.now()/1000),from=to-(intraday?180:3655)*86400;
  const j:any=await getJson("https://finnhub.io/api/v1/stock/candle",{symbol,resolution:intraday?"15":"D",from:String(from),to:String(to),token:FINNHUB});
  if(j?.s!=="ok")throw new Error("unavailable");
  const sec=intraday?900:86400;
  let rows=completed((j.t||[]).map((t:number,i:number)=>bar(t,j.o?.[i],j.h?.[i],j.l?.[i],j.c?.[i],j.v?.[i],t+sec)));
  if(intraday)rows=regular(rows);
  if(rows.length<(intraday?300:180))throw new Error("too shallow");
  return {provider:"Finnhub",bars:rows};
}
async function alphaDaily(symbol:string){
  if(!ALPHA)throw new Error("key missing");
  const j:any=await getJson("https://www.alphavantage.co/query",{function:"TIME_SERIES_DAILY",symbol,outputsize:"full",apikey:ALPHA});
  const s=j?.["Time Series (Daily)"];if(!s||typeof s!=="object")throw new Error(j?.Note||j?.Information||"unavailable");
  const out:(Bar|null)[]=[];
  for(const [d,x] of Object.entries<any>(s)){
    const dt=new Date(d+"T09:30:00-04:00"),ts=Math.floor(dt.getTime()/1000);
    out.push(bar(ts,x["1. open"],x["2. high"],x["3. low"],x["4. close"],x["5. volume"],ts+23400));
  }
  const rows=completed(out).sort((a,b)=>a.ts-b.ts);if(rows.length<180)throw new Error("too shallow");
  return {provider:"Alpha Vantage",bars:rows};
}
async function attempt<T extends {provider:string;bars:Bar[]}>(name:string,fn:()=>Promise<T>,trace:Trace[]){
  try{const x=await fn();trace.push({source:name,status:"OK",bars:x.bars.length,last:x.bars.at(-1)?.date});return x;}
  catch(e){trace.push({source:name,status:"FAILED",reason:String((e as Error)?.message||e).slice(0,160)});return null;}
}
function pick(candidates:any[],tf:string){
  for(const x of candidates)if(x&&x.bars?.length>=80&&current(tf,x.bars))return x;
  return null;
}
async function equityBundle(symbol:string){
  const trace:Trace[]=[];
  const mi=await attempt("Massive intraday",()=>massive(symbol,true),trace);
  const fi=mi?null:await attempt("FMP intraday",()=>fmp(symbol,true),trace);
  const ni=(mi||fi)?null:await attempt("Finnhub intraday",()=>finnhub(symbol,true),trace);
  const yi=await attempt("Yahoo intraday",()=>yahoo(symbol,"15m","60d",900,true,true),trace);
  const md=await attempt("Massive daily",()=>massive(symbol,false),trace);
  const fd=md?null:await attempt("FMP daily",()=>fmp(symbol,false),trace);
  const nd=(md||fd)?null:await attempt("Finnhub daily",()=>finnhub(symbol,false),trace);
  const ad=(md||fd||nd)?null:await attempt("Alpha Vantage daily",()=>alphaDaily(symbol),trace);
  const yd=await attempt("Yahoo daily",()=>yahoo(symbol,"1d","10y",86400,false,false),trace);
  const yh=await attempt("Yahoo hourly",()=>yahoo(symbol,"60m","2y",3600,true,true),trace);
  const intr=pick([mi,fi,ni,yi],"15M"),daily=pick([md,fd,nd,ad,yd],"1D");
  if(!intr&&!daily)throw new Error("No current provider data");
  const frames:Record<string,Frame>={};
  if(intr){
    frames["15M"]={status:"COMPLETED BAR",provider:intr.provider,bars:intr.bars,fetched_at:nowIso()};
    const h1=resample(intr.bars,60,true),h4=resample(intr.bars,240,true);
    if(h1.length>=80)frames["1H"]={status:"COMPLETED BAR",provider:intr.provider+" · 15M→1H",bars:h1,fetched_at:nowIso()};
    if(h4.length>=80)frames["4H"]={status:"COMPLETED BAR",provider:intr.provider+" · 15M→4H",bars:h4,fetched_at:nowIso()};
  }
  if(yh&&!frames["1H"])frames["1H"]={status:"COMPLETED BAR",provider:yh.provider,bars:yh.bars,fetched_at:nowIso()};
  if(yh&&!frames["4H"]){const h4=resample(yh.bars,240,true);if(h4.length>=80)frames["4H"]={status:"COMPLETED BAR",provider:yh.provider+" · 1H→4H",bars:h4,fetched_at:nowIso()};}
  if(daily)frames["1D"]={status:"COMPLETED BAR",provider:daily.provider,bars:daily.bars,fetched_at:nowIso()};
  return {schema_version:1,symbol,asset:"STOCK_OR_ETF",fetched_at:nowIso(),timeframes:frames,provider_trace:trace,
    credential_policy:"Provider keys remain Deno Deploy secrets and are never returned to the browser."};
}
async function futureBundle(requested:string,source:string){
  const trace:Trace[]=[];
  const m15=await attempt("Yahoo futures 15M",()=>yahoo(source,"15m","60d",900,true,false),trace);
  const h1=await attempt("Yahoo futures 1H",()=>yahoo(source,"60m","2y",3600,true,false),trace);
  const d1=await attempt("Yahoo futures 1D",()=>yahoo(source,"1d","10y",86400,false,false),trace);
  if(!m15&&!h1&&!d1)throw new Error("No futures data");
  const frames:Record<string,Frame>={};
  if(m15)frames["15M"]={status:"COMPLETED BAR",provider:m15.provider,bars:m15.bars,fetched_at:nowIso()};
  if(h1){
    frames["1H"]={status:"COMPLETED BAR",provider:h1.provider,bars:h1.bars,fetched_at:nowIso()};
    const h4=resample(h1.bars,240,false);if(h4.length>=80)frames["4H"]={status:"COMPLETED BAR",provider:h1.provider+" · 1H→4H",bars:h4,fetched_at:nowIso()};
  }
  if(d1)frames["1D"]={status:"COMPLETED BAR",provider:d1.provider,bars:d1.bars,fetched_at:nowIso()};
  return {schema_version:1,symbol:requested,source_symbol:source,asset:"FUTURE",fetched_at:nowIso(),timeframes:frames,provider_trace:trace,
    credential_policy:"Market-data credentials remain Deno Deploy secrets."};
}
const cache=new Map<string,{at:number,data:any}>();
async function bundle(symbol:string){
  const key=clean(symbol),cached=cache.get(key);if(cached&&Date.now()-cached.at<120000)return cached.data;
  const data=FUTURES[key]?await futureBundle(key,FUTURES[key]):await equityBundle(key);
  cache.set(key,{at:Date.now(),data});return data;
}

Deno.serve(async (req)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
  const u=new URL(req.url);
  if(u.pathname==="/health")return json({status:"OK",service:"Q-State Market API",version:"5.0",host:"Deno Deploy",
    providers:{massive:!!MASSIVE,fmp:!!FMP,finnhub:!!FINNHUB,alpha_vantage:!!ALPHA},
    decision_service:{stock_laya:!!LAYA_SERVICE_URL}},200,origin);
  if(u.pathname==="/v1/decision"&&req.method==="POST"){
    if(!LAYA_SERVICE_URL)return json({error:"STOCK_LAYA_UNAVAILABLE",message:"Stock-Laya service is not configured or not yet promoted."},503,origin);
    try{
      const body=await req.json();
      if(!body||typeof body.state!=="object"||!body.questions||typeof body.questions!=="object")return json({error:"INVALID_DECISION_REQUEST"},400,origin);
      const headers:Record<string,string>={"content-type":"application/json","accept":"application/json"};
      if(LAYA_SERVICE_TOKEN)headers.authorization="Bearer "+LAYA_SERVICE_TOKEN;
      const upstream=await fetch(LAYA_SERVICE_URL,{method:"POST",headers,body:JSON.stringify({state:body.state,questions:body.questions}),signal:AbortSignal.timeout(45000)});
      const text=await upstream.text();
      if(!upstream.ok)return json({error:"STOCK_LAYA_UPSTREAM",status:upstream.status,message:text.slice(0,500)},502,origin);
      let parsed;try{parsed=JSON.parse(text);}catch{return json({error:"STOCK_LAYA_INVALID_RESPONSE"},502,origin);}
      return json(parsed,200,origin);
    }catch(e){return json({error:"STOCK_LAYA_UNAVAILABLE",message:String((e as Error)?.message||e)},503,origin);}
  }
  if(u.pathname==="/v1/market"){
    const symbol=clean(u.searchParams.get("symbol")||""),tf=clean(u.searchParams.get("timeframe")||"1D");
    if(!symbol||!/^[A-Z0-9.\-=^]{1,24}$/.test(symbol))return json({error:"INVALID_SYMBOL"},400,origin);
    if(!["15M","1H","4H","1D"].includes(tf))return json({error:"INVALID_TIMEFRAME"},400,origin);
    try{
      const data=await bundle(symbol),frame=data.timeframes?.[tf];
      if(!frame||!Array.isArray(frame.bars)||frame.bars.length<80)return json({error:"TIMEFRAME_UNAVAILABLE",symbol,timeframe:tf,provider_trace:data.provider_trace},404,origin);
      return json({...data,requested_timeframe:tf,primary:frame},200,origin);
    }catch(e){return json({error:"DATA_UNAVAILABLE",symbol,message:String((e as Error)?.message||e)},503,origin);}
  }
  return json({service:"Q-State Market API",status:"OK",routes:["/health","/v1/market?symbol=AAPL&timeframe=1D","POST /v1/decision"]},200,origin);
});
