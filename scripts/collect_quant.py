"""Collect sanitized quant snapshots with API keys available only to GitHub Actions.
No API key is ever written to output.
"""
import json, os, math, time, urllib.parse, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime, timezone, timedelta

ROOT=Path(__file__).resolve().parents[1]
CFG=json.loads((ROOT/'config/quant_assets.json').read_text())
OUT=ROOT/'data'/'quant'
OUT.mkdir(parents=True,exist_ok=True)
KEY=os.environ.get('MASSIVE_KEY') or os.environ.get('POLYGON_KEY') or ''
FMP_KEY=os.environ.get('FMP_API_KEY') or os.environ.get('FMP_KEY') or ''
LAST_REQUEST=0
UA='StockTruth-Quant/1.1 (+https://github.com/samin110597-create/stock-truth-v2)'

def req(url):
    global LAST_REQUEST
    for attempt in range(4):
        time.sleep(max(0,0.45-(time.monotonic()-LAST_REQUEST)))
        LAST_REQUEST=time.monotonic()
        r=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'application/json'})
        try:
            with urllib.request.urlopen(r,timeout=30) as h:return json.load(h)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429,500,502,503,504) or attempt==3:
                raise RuntimeError(f'HTTP Error {exc.code}: {exc.reason}') from None
            time.sleep(2**(attempt+1))
    raise RuntimeError('Provider unavailable')

def clean_num(x):
    try:
        v=float(x); return v if math.isfinite(v) else None
    except: return None

def get_front(product):
    today=datetime.now(timezone.utc).date().isoformat()
    q=urllib.parse.urlencode({'date':today,'product_code':product,'active':'true','limit':100,'sort':'last_trade_date.asc','apiKey':KEY})
    j=req('https://api.massive.com/futures/v1/contracts?'+q)
    rows=[x for x in j.get('results',[]) if x.get('ticker') and (not x.get('last_trade_date') or x['last_trade_date']>=today)]
    if not rows: raise RuntimeError('No active contract returned for '+product)
    rows.sort(key=lambda x:(x.get('days_to_maturity') if x.get('days_to_maturity') is not None else 99999))
    return next((x['ticker'] for x in rows if (x.get('days_to_maturity') or 30)>5),rows[0]['ticker'])

def aggs(ticker,resolution,days):
    end=datetime.now(timezone.utc).date()
    start=end-timedelta(days=days)
    q=urllib.parse.urlencode({
        'resolution':resolution,
        'window_start.gte':start.isoformat(),
        'window_start.lte':end.isoformat(),
        'limit':5000,'sort':'window_start.asc','apiKey':KEY})
    j=req(f'https://api.massive.com/futures/v1/aggs/{urllib.parse.quote(ticker)}?'+q)
    rows=[]
    seconds={'15min':900,'1hour':3600,'1session':86400}[resolution]
    for x in j.get('results',[]):
        ns=clean_num(x.get('window_start')); o=clean_num(x.get('open')); h=clean_num(x.get('high')); l=clean_num(x.get('low')); c=clean_num(x.get('close')); v=clean_num(x.get('volume'))
        if None in (ns,o,h,l,c) or min(o,h,l,c)<=0 or h<max(o,l,c) or l>min(o,h,c): continue
        ts=int(ns/1_000_000_000) if ns>1e15 else int(ns/1000)
        date=x.get('session_end_date') or datetime.fromtimestamp(ts,timezone.utc).date().isoformat()
        rows.append({'ts':ts,'end_ts':ts+seconds,'date':date,'session':date,'open':o,'high':h,'low':l,'close':c,'volume':v,'complete':True})
    rows.sort(key=lambda z:z['ts'])
    return rows

def resample_4h(rows):
    out=[]; groups={}
    for b in rows:
        # Four sequential 1h bars within a futures session. We intentionally do not bridge different session_end_date values.
        g=groups.setdefault(b['session'],[])
        g.append(b)
    for _,g in sorted(groups.items()):
        for i in range(0,len(g)-3,4):
            z=g[i:i+4]
            if len(z)<4: continue
            out.append({'ts':z[0]['ts'],'end_ts':z[-1]['end_ts'],'date':z[-1]['date'],'session':z[-1]['session'],'open':z[0]['open'],'high':max(x['high'] for x in z),'low':min(x['low'] for x in z),'close':z[-1]['close'],'volume':sum(x['volume'] for x in z) if all(x['volume'] is not None for x in z) else None,'complete':True})
    return out

def parse_fmp_rows(rows,seconds):
    out=[]
    for x in rows or []:
        ds=x.get('date')
        if not ds: continue
        try:
            dt=datetime.fromisoformat(ds.replace('Z','+00:00'))
            if dt.tzinfo is None: dt=dt.replace(tzinfo=timezone.utc)
            ts=int(dt.timestamp())
        except Exception:
            continue
        o=clean_num(x.get('open')); h=clean_num(x.get('high')); l=clean_num(x.get('low')); c=clean_num(x.get('close')); v=clean_num(x.get('volume'))
        if None in (o,h,l,c) or min(o,h,l,c)<=0 or h<max(o,l,c) or l>min(o,h,c): continue
        date=dt.astimezone(timezone.utc).date().isoformat()
        out.append({'ts':ts,'end_ts':ts+seconds,'date':date,'session':date,'open':o,'high':h,'low':l,'close':c,'volume':v,'complete':True})
    out.sort(key=lambda z:z['ts'])
    return out

def fmp_intraday(symbol,interval,days):
    if not FMP_KEY: raise RuntimeError('FMP key not configured')
    end=datetime.now(timezone.utc).date()
    start=end-timedelta(days=days)
    q=urllib.parse.urlencode({'symbol':symbol,'from':start.isoformat(),'to':end.isoformat(),'apikey':FMP_KEY})
    rows=req(f'https://financialmodelingprep.com/stable/historical-chart/{interval}?'+q)
    seconds={'5min':300,'1hour':3600}[interval]
    return parse_fmp_rows(rows,seconds)

def fmp_eod(symbol,days):
    if not FMP_KEY: raise RuntimeError('FMP key not configured')
    end=datetime.now(timezone.utc).date()
    start=end-timedelta(days=days)
    q=urllib.parse.urlencode({'symbol':symbol,'from':start.isoformat(),'to':end.isoformat(),'apikey':FMP_KEY})
    rows=req('https://financialmodelingprep.com/stable/historical-price-eod/full?'+q)
    return parse_fmp_rows(rows,86400)

def resample_fixed(rows,count,seconds):
    out=[]; groups={}
    for b in rows:
        groups.setdefault(b['session'],[]).append(b)
    for _,g in sorted(groups.items()):
        g.sort(key=lambda x:x['ts'])
        for i in range(0,len(g)-count+1,count):
            z=g[i:i+count]
            if len(z)<count: continue
            # Require contiguous source bars so gaps are not fabricated.
            if any(z[j]['ts']-z[j-1]['ts']!=seconds for j in range(1,len(z))): continue
            out.append({'ts':z[0]['ts'],'end_ts':z[-1]['end_ts'],'date':z[-1]['date'],'session':z[-1]['session'],'open':z[0]['open'],'high':max(x['high'] for x in z),'low':min(x['low'] for x in z),'close':z[-1]['close'],'volume':sum(x['volume'] for x in z) if all(x['volume'] is not None for x in z) else None,'complete':True})
    return out

def collect_fmp_commodity(item):
    symbol=item.get('fmp_symbol')
    if not symbol: raise RuntimeError('No FMP commodity fallback symbol configured')
    fetched=datetime.now(timezone.utc).isoformat()
    five=fmp_intraday(symbol,'5min',45)
    hour=fmp_intraday(symbol,'1hour',365)
    daily=fmp_eod(symbol,3650)
    m15=resample_fixed(five,3,300)
    h4=resample_fixed(hour,4,3600)
    frames={
      '15M':{'classification':'CALCULATION','status':'COMPLETED BAR' if len(m15)>=60 else 'UNAVAILABLE','provider':'FMP commodity via GitHub Actions','source_symbol':symbol,'interval':'15M','resampled_from':'5min','fetched_at':fetched,'bars':m15},
      '1H':{'classification':'SOURCE FACT','status':'COMPLETED BAR' if len(hour)>=60 else 'UNAVAILABLE','provider':'FMP commodity via GitHub Actions','source_symbol':symbol,'interval':'1hour','fetched_at':fetched,'bars':hour},
      '4H':{'classification':'CALCULATION','status':'COMPLETED BAR' if len(h4)>=60 else 'UNAVAILABLE','provider':'FMP commodity via GitHub Actions','source_symbol':symbol,'interval':'4H','resampled_from':'1hour','fetched_at':fetched,'bars':h4},
      '1D':{'classification':'SOURCE FACT','status':'COMPLETED BAR' if len(daily)>=60 else 'UNAVAILABLE','provider':'FMP commodity via GitHub Actions','source_symbol':symbol,'interval':'1D','fetched_at':fetched,'bars':daily}
    }
    if len(daily)<60: raise RuntimeError(f'FMP {symbol} returned insufficient daily history')
    return {'schema_version':1,'symbol':item['symbol'],'name':item['name'],'asset':'FUTURE','source_symbol':symbol,'provider':'FMP commodity via GitHub Actions','fetched_at':fetched,'timeframes':frames,'instrument_basis':'continuous commodity series fallback; not a dated futures contract','credential_policy':'API credential used only inside GitHub Actions; no credential is present in this file.'}

def collect_future(item):
    ticker=get_front(item['product_code'])
    frames={}
    for tf,res,days in [('15M','15min',45),('1H','1hour',220),('1D','1session',1800)]:
        bars=aggs(ticker,res,days)
        frames[tf]={'classification':'SOURCE FACT','status':'COMPLETED BAR' if len(bars)>=60 else 'UNAVAILABLE','provider':'Massive Futures via GitHub Actions','source_symbol':ticker,'interval':res,'fetched_at':datetime.now(timezone.utc).isoformat(),'bars':bars}
        time.sleep(.15)
    h4=resample_4h(frames['1H']['bars'])
    frames['4H']={'classification':'CALCULATION','status':'COMPLETED BAR' if len(h4)>=60 else 'UNAVAILABLE','provider':'Massive Futures via GitHub Actions','source_symbol':ticker,'interval':'4H','resampled_from':'1hour','fetched_at':datetime.now(timezone.utc).isoformat(),'bars':h4}
    return {'schema_version':1,'symbol':item['symbol'],'name':item['name'],'asset':'FUTURE','source_symbol':ticker,'provider':'Massive Futures via GitHub Actions','fetched_at':datetime.now(timezone.utc).isoformat(),'timeframes':frames,'credential_policy':'API credential used only inside GitHub Actions; no credential is present in this file.'}

def main():
    if not KEY and not FMP_KEY:
        print('No Massive/Polygon or FMP key configured; commodity snapshots skipped.')
        return
    for item in CFG.get('futures',[]):
        data=None; errors=[]
        if KEY:
            try:
                data=collect_future(item)
            except Exception as e:
                errors.append('Massive: '+str(e)[:160])
        if data is None and item.get('fmp_symbol') and FMP_KEY:
            try:
                data=collect_fmp_commodity(item)
            except Exception as e:
                errors.append('FMP: '+str(e)[:160])
        if data is not None:
            (OUT/f"{item['symbol']}.json").write_text(json.dumps(data,separators=(',',':'),allow_nan=False))
            print('quant commodity',item['symbol'],'->',data['source_symbol'],'via',data['provider'])
        else:
            print('quant commodity failed',item['symbol'],' | '.join(errors)[:360])

if __name__=='__main__': main()
