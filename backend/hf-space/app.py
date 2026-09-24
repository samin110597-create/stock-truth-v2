import os, math, time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

NY=ZoneInfo("America/New_York")
NOW=lambda: datetime.now(timezone.utc)
UA={"User-Agent":"QState/3.0","Accept":"application/json"}
ALLOWED=[x.strip() for x in os.getenv("ALLOWED_ORIGIN","https://samin110597-create.github.io").split(",") if x.strip()]
MASSIVE=os.getenv("MASSIVE_KEY") or os.getenv("POLYGON_KEY")
FMP=os.getenv("FMP_API_KEY") or os.getenv("FMP_KEY")
FINNHUB=os.getenv("FINNHUB_API_KEY") or os.getenv("FINNHUB_KEY")
ALPHA=os.getenv("ALPHA_VANTAGE_KEY") or os.getenv("ALPHAVANTAGE_KEY")

app=FastAPI(title="Q-State Market API",version="3.0")
app.add_middleware(CORSMiddleware,allow_origins=ALLOWED,allow_credentials=False,allow_methods=["GET","OPTIONS"],allow_headers=["*"])

FUTURES={
 "GOLD":"GC=F","GC":"GC=F","XAU":"GC=F","XAUUSD":"GC=F",
 "SILVER":"SI=F","SI":"SI=F","XAG":"SI=F","XAGUSD":"SI=F",
 "OIL":"CL=F","WTI":"CL=F","CRUDE":"CL=F","CL":"CL=F",
 "NATGAS":"NG=F","NATURALGAS":"NG=F","NG":"NG=F",
 "COPPER":"HG=F","HG":"HG=F","PLATINUM":"PL=F","PL":"PL=F"
}
CACHE:dict[str,tuple[float,dict[str,Any]]]={}

def clean_symbol(s:str)->str:
    return "".join(str(s or "").strip().upper().split())

def safe(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None

def canon(ts,op,hi,lo,cl,vol=None,end_ts=None):
    vals=[safe(op),safe(hi),safe(lo),safe(cl)]
    if not all(v is not None and v>0 for v in vals): return None
    op,hi,lo,cl=vals
    if hi<max(op,lo,cl) or lo>min(op,hi,cl): return None
    ts=int(ts); end_ts=int(end_ts or ts)
    d=datetime.fromtimestamp(ts,timezone.utc).astimezone(NY)
    vv=safe(vol)
    return {"ts":ts,"end_ts":end_ts,"date":d.date().isoformat(),"session":d.date().isoformat(),
            "open":op,"high":hi,"low":lo,"close":cl,"volume":vv if vv is not None and vv>=0 else None,"complete":True}

def completed(rows):
    cutoff=time.time()-45
    return [b for b in rows if b and int(b.get("end_ts") or b["ts"])<cutoff]

def regular(rows):
    out=[]
    for b in rows:
        d=datetime.fromtimestamp(b["ts"],timezone.utc).astimezone(NY)
        m=d.hour*60+d.minute
        if 570<=m<960: out.append(b)
    return sorted(out,key=lambda x:x["ts"])

def resample(rows,minutes,regular_session=True):
    rows=regular(rows) if regular_session else sorted(rows,key=lambda x:x["ts"])
    buckets={}
    for b in rows:
        d=datetime.fromtimestamp(b["ts"],timezone.utc).astimezone(NY)
        if regular_session:
            idx=(d.hour*60+d.minute-570)//minutes
            key=(d.date().isoformat(),idx)
        else:
            bucket=int(b["ts"]//(minutes*60))
            key=("all",bucket)
        buckets.setdefault(key,[]).append(b)
    out=[]
    for z in buckets.values():
        z=sorted(z,key=lambda x:x["ts"]); first,last=z[0],z[-1]
        out.append({"ts":first["ts"],"end_ts":last["end_ts"],"date":last["date"],"session":last["session"],
                    "open":first["open"],"high":max(x["high"] for x in z),"low":min(x["low"] for x in z),
                    "close":last["close"],"volume":sum(x["volume"] for x in z) if all(x["volume"] is not None for x in z) else None,
                    "complete":True,"component_bars":len(z)})
    return sorted(out,key=lambda x:x["ts"])

def current(tf,rows):
    if not rows:return False
    age=(time.time()-int(rows[-1].get("end_ts") or rows[-1]["ts"]))/60
    return age <= (60*24*7 if tf=="1D" else 60*24*4)

async def get_json(url,params=None,timeout=20):
    async with httpx.AsyncClient(timeout=timeout,headers=UA,follow_redirects=True) as c:
        r=await c.get(url,params=params)
        r.raise_for_status()
        return r.json()

async def massive(symbol,intraday):
    if not MASSIVE: raise RuntimeError("key missing")
    if intraday:
        start=(NOW()-timedelta(days=180)).date().isoformat(); end=NOW().date().isoformat()
        url=f"https://api.massive.com/v2/aggs/ticker/{symbol}/range/15/minute/{start}/{end}"
        sec=900
    else:
        start=(NOW()-timedelta(days=3655)).date().isoformat(); end=NOW().date().isoformat()
        url=f"https://api.massive.com/v2/aggs/ticker/{symbol}/range/1/day/{start}/{end}"
        sec=86400
    j=await get_json(url,{"adjusted":"true","sort":"asc","limit":50000,"apiKey":MASSIVE})
    rows=completed([canon(int(x.get("t",0))/1000,x.get("o"),x.get("h"),x.get("l"),x.get("c"),x.get("v"),int(x.get("t",0))/1000+sec) for x in j.get("results",[])])
    rows=regular(rows) if intraday else rows
    if len(rows)<(300 if intraday else 180): raise RuntimeError("too shallow")
    return {"provider":"Massive","bars":rows}

async def yahoo(symbol,interval,range_,seconds,intraday=False,regular_session=True):
    ys=symbol.replace(".","-") if not symbol.endswith("=F") else symbol
    j=await get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{ys}",{
        "interval":interval,"range":range_,"includePrePost":"false","includeAdjustedClose":"false","events":"splits"})
    r=(j.get("chart") or {}).get("result") or []
    if not r: raise RuntimeError("Yahoo unavailable")
    r=r[0]; q=((r.get("indicators") or {}).get("quote") or [{}])[0]; ts=r.get("timestamp") or []
    rows=[]
    for i,t in enumerate(ts):
        b=canon(t,(q.get("open") or [None]*len(ts))[i],(q.get("high") or [None]*len(ts))[i],
                (q.get("low") or [None]*len(ts))[i],(q.get("close") or [None]*len(ts))[i],
                (q.get("volume") or [None]*len(ts))[i],t+seconds)
        if b: rows.append(b)
    rows=completed(rows)
    if intraday and regular_session: rows=regular(rows)
    if len(rows)<80: raise RuntimeError("Yahoo too shallow")
    return {"provider":"Yahoo server fallback","bars":rows}

async def fmp(symbol,intraday):
    if not FMP: raise RuntimeError("key missing")
    if intraday:
        url="https://financialmodelingprep.com/stable/historical-chart/15min"
        params={"symbol":symbol,"from":(NOW()-timedelta(days=180)).date().isoformat(),"to":NOW().date().isoformat(),"apikey":FMP}
    else:
        url="https://financialmodelingprep.com/stable/historical-price-eod/full"
        params={"symbol":symbol,"from":(NOW()-timedelta(days=3655)).date().isoformat(),"to":NOW().date().isoformat(),"apikey":FMP}
    j=await get_json(url,params)
    rows=j.get("historical") if isinstance(j,dict) else j
    if not isinstance(rows,list): raise RuntimeError("unexpected response")
    out=[]
    for x in rows:
        ds=str(x.get("date") or "")
        if not ds: continue
        if intraday:
            dt=datetime.fromisoformat(ds.replace(" ","T")).replace(tzinfo=NY)
            sec=900
        else:
            dt=datetime.fromisoformat(ds[:10]).replace(hour=9,minute=30,tzinfo=NY)
            sec=23400
        out.append(canon(int(dt.timestamp()),x.get("open"),x.get("high"),x.get("low"),x.get("close"),x.get("volume"),int(dt.timestamp())+sec))
    out=completed([x for x in out if x]); out=regular(out) if intraday else sorted(out,key=lambda x:x["ts"])
    if len(out)<(300 if intraday else 180): raise RuntimeError("too shallow")
    return {"provider":"FMP","bars":out}

async def finnhub(symbol,intraday):
    if not FINNHUB: raise RuntimeError("key missing")
    to=int(time.time()); frm=to-(180 if intraday else 3655)*86400
    j=await get_json("https://finnhub.io/api/v1/stock/candle",{"symbol":symbol,"resolution":"15" if intraday else "D","from":frm,"to":to,"token":FINNHUB})
    if j.get("s")!="ok": raise RuntimeError("unavailable")
    sec=900 if intraday else 86400
    out=[canon(t,j["o"][i],j["h"][i],j["l"][i],j["c"][i],j["v"][i],t+sec) for i,t in enumerate(j.get("t") or [])]
    out=completed([x for x in out if x]); out=regular(out) if intraday else sorted(out,key=lambda x:x["ts"])
    if len(out)<(300 if intraday else 180): raise RuntimeError("too shallow")
    return {"provider":"Finnhub","bars":out}

async def alpha_daily(symbol):
    if not ALPHA: raise RuntimeError("key missing")
    j=await get_json("https://www.alphavantage.co/query",{"function":"TIME_SERIES_DAILY","symbol":symbol,"outputsize":"full","apikey":ALPHA})
    s=j.get("Time Series (Daily)")
    if not isinstance(s,dict): raise RuntimeError(j.get("Note") or j.get("Information") or "unavailable")
    out=[]
    for d,x in s.items():
        dt=datetime.fromisoformat(d).replace(hour=9,minute=30,tzinfo=NY)
        out.append(canon(int(dt.timestamp()),x.get("1. open"),x.get("2. high"),x.get("3. low"),x.get("4. close"),x.get("5. volume"),int(dt.timestamp())+23400))
    out=sorted(completed([x for x in out if x]),key=lambda x:x["ts"])
    if len(out)<180: raise RuntimeError("too shallow")
    return {"provider":"Alpha Vantage","bars":out}

async def attempt(name,fn,trace):
    try:
        x=await fn(); trace.append({"source":name,"status":"OK","bars":len(x["bars"]),"last":x["bars"][-1]["date"]}); return x
    except Exception as e:
        trace.append({"source":name,"status":"FAILED","reason":str(e)[:160]}); return None

def pick(candidates,tf):
    for x in candidates:
        if x and len(x["bars"])>=80 and current(tf,x["bars"]): return x
    return None

async def equity_bundle(symbol):
    trace=[]
    mi=await attempt("Massive intraday",lambda:massive(symbol,True),trace)
    fi=await attempt("FMP intraday",lambda:fmp(symbol,True),trace) if not mi else None
    ni=await attempt("Finnhub intraday",lambda:finnhub(symbol,True),trace) if not (mi or fi) else None
    yi=await attempt("Yahoo intraday",lambda:yahoo(symbol,"15m","60d",900,True,True),trace)
    md=await attempt("Massive daily",lambda:massive(symbol,False),trace)
    fd=await attempt("FMP daily",lambda:fmp(symbol,False),trace) if not md else None
    nd=await attempt("Finnhub daily",lambda:finnhub(symbol,False),trace) if not (md or fd) else None
    ad=await attempt("Alpha Vantage daily",lambda:alpha_daily(symbol),trace) if not (md or fd or nd) else None
    yd=await attempt("Yahoo daily",lambda:yahoo(symbol,"1d","10y",86400,False,False),trace)
    yh=await attempt("Yahoo hourly",lambda:yahoo(symbol,"60m","2y",3600,True,True),trace)
    intr=pick([mi,fi,ni,yi],"15M"); daily=pick([md,fd,nd,ad,yd],"1D")
    if not intr and not daily: raise RuntimeError("No current provider data")
    tf={}
    if intr:
        tf["15M"]={"status":"COMPLETED BAR","provider":intr["provider"],"bars":intr["bars"],"fetched_at":NOW().isoformat()}
        h1=resample(intr["bars"],60,True); h4=resample(intr["bars"],240,True)
        if len(h1)>=80: tf["1H"]={"status":"COMPLETED BAR","provider":intr["provider"]+" · 15M→1H","bars":h1,"fetched_at":NOW().isoformat()}
        if len(h4)>=80: tf["4H"]={"status":"COMPLETED BAR","provider":intr["provider"]+" · 15M→4H","bars":h4,"fetched_at":NOW().isoformat()}
    if yh and "1H" not in tf: tf["1H"]={"status":"COMPLETED BAR","provider":yh["provider"],"bars":yh["bars"],"fetched_at":NOW().isoformat()}
    if yh and "4H" not in tf:
        h4=resample(yh["bars"],240,True)
        if len(h4)>=80: tf["4H"]={"status":"COMPLETED BAR","provider":yh["provider"]+" · 1H→4H","bars":h4,"fetched_at":NOW().isoformat()}
    if daily: tf["1D"]={"status":"COMPLETED BAR","provider":daily["provider"],"bars":daily["bars"],"fetched_at":NOW().isoformat()}
    return {"schema_version":1,"symbol":symbol,"asset":"STOCK_OR_ETF","fetched_at":NOW().isoformat(),"timeframes":tf,"provider_trace":trace,
            "credential_policy":"Provider keys remain Hugging Face Space secrets and are never returned to the browser."}

async def future_bundle(requested,source):
    trace=[]
    m15=await attempt("Yahoo futures 15M",lambda:yahoo(source,"15m","60d",900,True,False),trace)
    h1=await attempt("Yahoo futures 1H",lambda:yahoo(source,"60m","2y",3600,True,False),trace)
    d1=await attempt("Yahoo futures 1D",lambda:yahoo(source,"1d","10y",86400,False,False),trace)
    if not any([m15,h1,d1]): raise RuntimeError("No futures data")
    tf={}
    if m15: tf["15M"]={"status":"COMPLETED BAR","provider":m15["provider"],"bars":m15["bars"],"fetched_at":NOW().isoformat()}
    if h1:
        tf["1H"]={"status":"COMPLETED BAR","provider":h1["provider"],"bars":h1["bars"],"fetched_at":NOW().isoformat()}
        h4=resample(h1["bars"],240,False)
        if len(h4)>=80: tf["4H"]={"status":"COMPLETED BAR","provider":h1["provider"]+" · 1H→4H","bars":h4,"fetched_at":NOW().isoformat()}
    if d1: tf["1D"]={"status":"COMPLETED BAR","provider":d1["provider"],"bars":d1["bars"],"fetched_at":NOW().isoformat()}
    return {"schema_version":1,"symbol":requested,"source_symbol":source,"asset":"FUTURE","fetched_at":NOW().isoformat(),"timeframes":tf,"provider_trace":trace,
            "credential_policy":"Futures fallback is fetched server-side; no browser credential is used."}

async def bundle(symbol):
    key=clean_symbol(symbol)
    cached=CACHE.get(key)
    if cached and time.time()-cached[0]<120:return cached[1]
    data=await future_bundle(key,FUTURES[key]) if key in FUTURES else await equity_bundle(key)
    CACHE[key]=(time.time(),data)
    return data

@app.get("/health")
async def health():
    return {"status":"OK","service":"Q-State Market API","version":"3.0",
            "providers":{"massive":bool(MASSIVE),"fmp":bool(FMP),"finnhub":bool(FINNHUB),"alpha_vantage":bool(ALPHA)},
            "host":"Hugging Face Space"}

@app.get("/v1/market")
async def market(symbol:str=Query(...,min_length=1,max_length=24),timeframe:str=Query("1D")):
    s=clean_symbol(symbol); tf=timeframe.upper()
    if tf not in {"15M","1H","4H","1D"}: raise HTTPException(400,"INVALID_TIMEFRAME")
    if not s or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-=^" for ch in s): raise HTTPException(400,"INVALID_SYMBOL")
    try:data=await bundle(s)
    except Exception as e: raise HTTPException(503,{"error":"DATA_UNAVAILABLE","symbol":s,"message":str(e)})
    frame=(data.get("timeframes") or {}).get(tf)
    if not frame or len(frame.get("bars") or [])<80: raise HTTPException(404,{"error":"TIMEFRAME_UNAVAILABLE","symbol":s,"timeframe":tf,"provider_trace":data.get("provider_trace")})
    return {**data,"requested_timeframe":tf,"primary":frame}
