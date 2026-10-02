"""Private keys stay in Actions. Publish only whitelisted sourced quote fields.
Finnhub per-ticker primary; FMP fallback (at most four requests per run).
Alpha Vantage and FRED retain their separately cached market-context roles.
"""
import json, math, os, time, urllib.request, urllib.parse, urllib.error
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]

def number(v):
    return v if isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) else None

def fetch(base, params):
    # Never include URL, response body or exception message in public errors/logs.
    req=urllib.request.Request(base+'?'+urllib.parse.urlencode(params),headers={'User-Agent':'StockTruth/5.2','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=8) as r: return json.load(r)

def quote(symbol,provider,d):
    f=provider=='Finnhub'
    price=number(d.get('c' if f else 'price')); ts=number(d.get('t' if f else 'timestamp'))
    if not f and d.get('symbol')!=symbol: raise ValueError('identity')
    if not price or price<=0 or not ts or ts>time.time()+60: raise ValueError('invalid quote')
    return {'symbol':symbol,'classification':'SOURCE FACT','provider':provider+' secured API snapshot','price':price,'as_of':ts,'fetched_at':datetime.now(timezone.utc).isoformat(),'currency':'USD','session_date':datetime.fromtimestamp(ts,ZoneInfo('America/New_York')).date().isoformat(),'high':number(d.get('h' if f else 'dayHigh')),'low':number(d.get('l' if f else 'dayLow')),'open':number(d.get('o' if f else 'open')),'volume':number(d.get('volume')),'change':number(d.get('d' if f else 'change')),'change_pct':number(d.get('dp' if f else 'changePercentage')),'api_secret_used':True,'status':'SNAPSHOT','delay':'Provider entitlement/latency unspecified; scheduled snapshot, not a streaming feed'}

def main():
    keys={'Finnhub':os.getenv('FINNHUB_KEY'),'FMP':os.getenv('FMP_KEY')}
    fallbacks=0
    for symbol in json.loads((ROOT/'config/watchlist.json').read_text())['symbols']:
        path=ROOT/'data/raw'/f'{symbol}.json'
        if not path.exists(): continue
        raw=json.loads(path.read_text()); candidates=[]; attempts=[]
        for provider,key in keys.items():
            if not key: attempts.append({'provider':provider,'status':'NOT CONFIGURED'}); continue
            if provider=='FMP' and fallbacks>=4:
                attempts.append({'provider':provider,'status':'DEFERRED: fallback request budget'});continue
            try:
                if provider=='Finnhub': d=fetch('https://finnhub.io/api/v1/quote',{'symbol':symbol,'token':key})
                else:
                    fallbacks+=1
                    d=fetch('https://financialmodelingprep.com/stable/quote',{'symbol':symbol,'apikey':key})
                    d=d[0] if isinstance(d,list) and d else d
                q=quote(symbol,provider,d);candidates.append(q)
                attempts.append({'provider':provider,'status':'AVAILABLE','as_of':q['as_of']})
                # FMP is a fallback, not an unnecessary duplicate paid request.
                if time.time()-q['as_of']<900: break
            except urllib.error.HTTPError as e: attempts.append({'provider':provider,'status':'UNAVAILABLE: HTTP '+str(e.code)})
            except Exception: attempts.append({'provider':provider,'status':'UNAVAILABLE: no valid timestamped quote'})
            finally: time.sleep(1.1)
        old=raw.get('quote',{})
        usable=[q for q in [old,*candidates] if number(q.get('as_of')) and number(q.get('price')) and q['price']>0 and q['as_of']<=time.time()+60]
        if usable: raw['quote']=max(usable,key=lambda q:q['as_of'])
        raw['secured_quote_candidates']=candidates
        raw['secured_quote_attempts']=attempts
        path.write_text(json.dumps(raw,separators=(',',':')))
        print(symbol, '; '.join(a['provider']+' '+a['status'] for a in attempts),flush=True)
if __name__=='__main__': main()
