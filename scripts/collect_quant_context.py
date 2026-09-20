"""Sanitized multi-provider context for Q-State.
Uses GitHub Actions secrets only. Never writes credentials to output.
Provider calls are throttled by the timestamps in data/quant/context.json.
"""
import json, os, math, urllib.parse, urllib.request
from pathlib import Path
from datetime import datetime, timezone, timedelta

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'data'/'quant'/'context.json'
NOW=datetime.now(timezone.utc)
UA='Q-State-Context/1.0 (+https://github.com/samin110597-create/stock-truth-v2)'

def iso(dt=None): return (dt or NOW).isoformat()
def num(x):
    try:
        v=float(x); return v if math.isfinite(v) else None
    except: return None
def key(*names):
    return next((os.environ.get(n) for n in names if os.environ.get(n)),None)
def req(url):
    r=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/json'})
    with urllib.request.urlopen(r,timeout=25) as h:return json.load(h)
def old():
    try:return json.loads(OUT.read_text())
    except:return {}
def fresh(block,hours):
    try:return block and (NOW-datetime.fromisoformat(block['fetched_at'])).total_seconds()<hours*3600
    except:return False
def unavailable(provider,reason):
    return {'provider':provider,'status':'UNAVAILABLE','fetched_at':iso(),'reason':str(reason)[:220]}

def finnhub(existing):
    if fresh(existing,0.25): return existing
    k=key('FINNHUB_API_KEY','FINNHUB_KEY')
    if not k:return unavailable('Finnhub','KEY NOT CONFIGURED')
    try:
        j=req('https://finnhub.io/api/v1/quote?'+urllib.parse.urlencode({'symbol':'SPY','token':k}))
        p=num(j.get('c')); ts=num(j.get('t'))
        if not p: raise RuntimeError('No SPY quote returned')
        return {'provider':'Finnhub','status':'OK','instrument':'SPY','price':p,'source_timestamp':int(ts) if ts else None,'fetched_at':iso()}
    except Exception as e:return unavailable('Finnhub',e)

def fmp(existing):
    if fresh(existing,0.25): return existing
    k=key('FMP_API_KEY','FMP_KEY')
    if not k:return unavailable('FMP','KEY NOT CONFIGURED')
    try:
        j=req('https://financialmodelingprep.com/stable/quote?'+urllib.parse.urlencode({'symbol':'SPY','apikey':k}))
        row=(j[0] if isinstance(j,list) and j else j) or {}
        p=num(row.get('price'))
        if not p: raise RuntimeError(row.get('Error Message') or row.get('message') or 'No SPY quote returned')
        return {'provider':'FMP','status':'OK','instrument':'SPY','price':p,'source_timestamp':row.get('timestamp'),'fetched_at':iso()}
    except Exception as e:return unavailable('FMP',e)

def alpha(existing):
    if fresh(existing,6): return existing
    k=key('ALPHA_VANTAGE_KEY','ALPHAVANTAGE_KEY')
    if not k:return unavailable('Alpha Vantage','KEY NOT CONFIGURED')
    try:
        j=req('https://www.alphavantage.co/query?'+urllib.parse.urlencode({'function':'GLOBAL_QUOTE','symbol':'SPY','apikey':k}))
        if j.get('Note') or j.get('Information') or j.get('Error Message'): raise RuntimeError(j.get('Note') or j.get('Information') or j.get('Error Message'))
        q=j.get('Global Quote') or {};p=num(q.get('05. price'))
        if not p: raise RuntimeError('No SPY quote returned')
        return {'provider':'Alpha Vantage','status':'OK','instrument':'SPY','price':p,'trading_day':q.get('07. latest trading day'),'fetched_at':iso()}
    except Exception as e:return unavailable('Alpha Vantage',e)

def fred(existing):
    if fresh(existing,24): return existing
    k=key('FRED_API_KEY','FRED_KEY')
    if not k:return unavailable('FRED','KEY NOT CONFIGURED')
    series={'DGS10':'10Y nominal Treasury','DFII10':'10Y real Treasury','T10YIE':'10Y breakeven inflation','DTWEXBGS':'Trade-weighted USD'}
    values={}
    try:
        for sid,label in series.items():
            params={'series_id':sid,'api_key':k,'file_type':'json','sort_order':'desc','limit':10}
            j=req('https://api.stlouisfed.org/fred/series/observations?'+urllib.parse.urlencode(params))
            obs=next((x for x in j.get('observations',[]) if num(x.get('value')) is not None),None)
            values[sid]={'label':label,'value':num(obs.get('value')) if obs else None,'date':obs.get('date') if obs else None}
        if not any(v['value'] is not None for v in values.values()):raise RuntimeError('No macro observations returned')
        return {'provider':'FRED','status':'OK','fetched_at':iso(),'series':values}
    except Exception as e:return unavailable('FRED',e)

def main():
    prev=old();providers=prev.get('providers',{})
    out={
      'schema_version':1,'generated_at':iso(),
      'providers':{
        'finnhub':finnhub(providers.get('finnhub')),
        'fmp':fmp(providers.get('fmp')),
        'alpha_vantage':alpha(providers.get('alpha_vantage')),
        'fred':fred(providers.get('fred')),
      },
      'purpose':'Independent cross-source and macro context. These observations do not silently alter the Q-State trade score.',
      'credential_policy':'All credentials are GitHub Actions secrets; no credential is written to this file.'
    }
    prices=[p['price'] for p in out['providers'].values() if isinstance(p,dict) and p.get('status')=='OK' and num(p.get('price'))]
    if prices:
        lo,hi=min(prices),max(prices);mid=sum(prices)/len(prices)
        out['spy_cross_source']={'sources':len(prices),'min':lo,'max':hi,'dispersion_pct':(hi-lo)/mid*100 if mid else None,
                                 'status':'PASS' if len(prices)>=2 and (hi-lo)/mid<0.005 else 'REVIEW' if len(prices)>=2 else 'SINGLE SOURCE'}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(out,separators=(',',':'),allow_nan=False))
    print('quant context:',', '.join(f"{k}={v.get('status')}" for k,v in out['providers'].items()))

if __name__=='__main__': main()
