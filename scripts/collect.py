"""GitHub Actions collector. No model values, credentials, or fabricated fallback bars.
Yahoo chart = unofficial, provider delay unspecified; SEC = filing facts.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo('America/New_York')
CAL = xcals.get_calendar('XNYS', start='1990-01-01', end='2028-12-31')
NOW = datetime.now(timezone.utc)
NOW_TS = int(NOW.timestamp())
UA = 'StockTruth/5.0 (+https://github.com/samin110597-create/stock-truth-v2)'
LAST_REQUEST = 0
SEC_MAP = None

def iso():
    return datetime.now(timezone.utc).isoformat()

def number(x):
    if x is None or isinstance(x, bool):
        return None
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None

def request(url, headers=None):
    global LAST_REQUEST
    for attempt in range(3):
        time.sleep(max(0, 0.65 - (time.monotonic()-LAST_REQUEST)))
        LAST_REQUEST = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept':'application/json', **(headers or {})})
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f'Provider HTTP {exc.code}') from None
            time.sleep(2 ** (attempt+1))
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                raise RuntimeError('Provider network timeout/unavailable') from None
    raise RuntimeError('Provider unavailable')

def session(date):
    label = pd.Timestamp(date)
    if not CAL.is_session(label):
        return None
    return int(CAL.session_open(label).timestamp()), int(CAL.session_close(label).timestamp())

def schedule_state():
    day = NOW.astimezone(NY).date().isoformat()
    bounds = session(day)
    state = 'CLOSED' if not bounds else ('PREMARKET' if NOW_TS < bounds[0] else 'OPEN' if NOW_TS < bounds[1] else 'CLOSED')
    completed = CAL.date_to_session(pd.Timestamp(day), direction='previous')
    if int(CAL.session_close(completed).timestamp()) + 900 > NOW_TS:
        completed = CAL.previous_session(completed)
    return {'classification':'CALCULATION', 'provider':'exchange_calendars XNYS regular session schedule',
            'state':state, 'as_of':iso(), 'session_open':bounds[0] if bounds else None,
            'session_close':bounds[1] if bounds else None,
            'expected_completed_daily':str(completed.date()), 'note':'Scheduled market state; unscheduled exchange halts are not known.'}

def unavailable(reason, provider=None):
    return {'classification':'UNAVAILABLE','status':'UNAVAILABLE','provider':provider,'attempted_at':iso(),'reason':reason,'bars':[]}

def save(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(',', ':'), allow_nan=False))

def canonical_yahoo(result, interval, source_url):
    meta = result.get('meta', {})
    if meta.get('exchangeTimezoneName') != 'America/New_York' or meta.get('currency') != 'USD':
        return unavailable('This release supports USD securities on U.S. equity calendars only.', 'Yahoo Finance chart')
    quotes = result.get('indicators', {}).get('quote', [{}])[0]
    seconds = 300 if interval == '5m' else 3600 if interval == '60m' else 86400
    completed, forming, rejected, duplicates = [], [], [], 0
    seen = set()
    for i, ts in enumerate(result.get('timestamp', [])):
        date = datetime.fromtimestamp(ts, NY).date().isoformat()
        bounds = session(date)
        if not bounds:
            rejected.append({'ts':ts,'reason':'Not a scheduled trading session'})
            continue
        op, cl = bounds
        if interval == '1d':
            ts, end = op, cl
        else:
            if ts < op or ts >= cl:
                continue
            end = min(ts+seconds, cl)
        values = {k:number((quotes.get(k, [])+[None]*len(result.get('timestamp', [])))[i]) for k in ['open','high','low','close','volume']}
        o,h,l,c = (values[k] for k in ['open','high','low','close'])
        if any(v is None or v <= 0 for v in [o,h,l,c]) or h < max(o,l,c) or l > min(o,h,c):
            rejected.append({'ts':ts,'reason':'Missing/invalid OHLC; not imputed'})
            continue
        if values['volume'] is not None and values['volume'] < 0:
            values['volume'] = None
        if ts in seen:
            duplicates += 1
            continue
        seen.add(ts)
        b = {'ts':ts,'end_ts':end,'date':date,'session':date, **values}
        # Daily provider revisions: 15-minute grace. Intraday: 60 seconds.
        b['complete'] = end+(900 if interval == '1d' else 60) <= NOW_TS
        (completed if b['complete'] else forming).append(b)
    completed.sort(key=lambda b:b['ts'])
    forming.sort(key=lambda b:b['ts'])
    splits = []
    for s in result.get('events',{}).get('splits',{}).values():
        den, num = number(s.get('denominator')), number(s.get('numerator'))
        splits.append({'ts':s.get('date'),'ratio':num/den if num and den else None,'reported_ratio':s.get('splitRatio')})
    audit = []
    for s in splits:
        before = [b for b in completed if b['ts'] < s['ts']]
        after = [b for b in completed if b['ts'] >= s['ts']]
        if before and after:
            jump = after[0]['open']/before[-1]['close']
            suspicious = abs(math.log(jump)) > 0.45
            audit.append({**s,'open_vs_prior_close':jump-1,'status':'REVIEW' if suspicious else 'CONTINUOUS'})
    # Never "repair" a real jump by guessing a split factor.
    large_gaps = [{'ts':b['ts'],'open_vs_prior_close':b['open']/completed[i-1]['close']-1} for i,b in enumerate(completed) if i and abs(math.log(b['open']/completed[i-1]['close']))>0.5]
    state = schedule_state()
    stale = not completed or (interval=='1d' and completed[-1]['date'] < state['expected_completed_daily'])
    review = bool(rejected or large_gaps or any(a['status']=='REVIEW' for a in audit))
    return {'classification':'SOURCE FACT','status':'STALE' if stale else 'REVIEW' if review else 'COMPLETED BAR',
            'provider':'Yahoo Finance chart (unofficial endpoint)', 'source_url':source_url,
            'fetched_at':iso(),'interval':interval,'native':True,'delay':'UNSPECIFIED BY PROVIDER',
            'adjustment':'Provider split-adjusted OHLC and volume; no dividend adjustment; no second split adjustment.',
            'bars':completed,'forming_bars':forming,'last_completed_bar':completed[-1]['end_ts'] if completed else None,
            'rejected':rejected,'duplicates_removed':duplicates,'splits':splits,'split_audit':audit,'large_gaps':large_gaps,
            'quality':'REVIEW' if review else 'PASS' if completed else 'UNAVAILABLE'}

def yahoo(symbol, interval):
    params = {'interval':interval,'range':'10y' if interval=='1d' else '2y' if interval=='60m' else '60d',
              'includePrePost':'false','includeAdjustedClose':'false','events':'splits'}
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol, safe="")}?'+urllib.parse.urlencode(params)
    data = request(url).get('chart',{})
    rows = data.get('result')
    if not rows:
        raise RuntimeError('No Yahoo history returned')
    r = rows[0]
    if str(r.get('meta',{}).get('symbol','')).upper().replace('.','-') != symbol.replace('.','-'):
        raise RuntimeError('Provider symbol does not match requested ticker')
    return canonical_yahoo(r,interval,url), r.get('meta',{})

def polygon_daily(symbol):
    key = os.environ.get('POLYGON_KEY')
    if not key:
        raise RuntimeError('POLYGON_KEY is not configured in this repository')
    start = (NOW-timedelta(days=3652)).date().isoformat()
    base = f'https://api.polygon.io/v2/aggs/ticker/{symbol}/range/1/day/{start}/{NOW.date().isoformat()}'
    rows = request(base+'?'+urllib.parse.urlencode({'adjusted':'true','sort':'asc','limit':50000,'apiKey':key})).get('results',[])
    if not rows:
        raise RuntimeError('Polygon returned no daily bars')
    # Adapter uses same calendar / integrity checks; URLs never include API keys in artifacts.
    r = {'meta':{'exchangeTimezoneName':'America/New_York','currency':'USD'},'timestamp':[x['t']//1000 for x in rows],
         'indicators':{'quote':[{k:[x.get(v) for x in rows] for k,v in [('open','o'),('high','h'),('low','l'),('close','c'),('volume','v')]}]}}
    p = canonical_yahoo(r,'1d',base+'?adjusted=true')
    p.update(provider='Polygon aggregates',fallback_used=True,fallback_from='Yahoo Finance chart',adjustment='Polygon split-adjusted aggregates; split-event audit unavailable')
    return p

TAGS = {
 'revenue':(['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'],'USD',True),
 'operating_income':(['OperatingIncomeLoss'],'USD',True), 'net_income':(['NetIncomeLoss','ProfitLoss'],'USD',True),
 'operating_cash_flow':(['NetCashProvidedByUsedInOperatingActivities'],'USD',True),
 'capex':(['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsForAdditionsToPropertyPlantAndEquipment'],'USD',True),
 'eps_diluted':(['EarningsPerShareDiluted'],'USD/shares',True),
 'cash':(['CashAndCashEquivalentsAtCarryingValue'],'USD',False),
 'long_term_debt':(['LongTermDebtCurrent','LongTermDebtNoncurrent','LongTermDebt'],'USD',False),
 'equity':(['StockholdersEquity'],'USD',False), 'assets':(['Assets'],'USD',False),
 'shares_outstanding':(['CommonStockSharesOutstanding'],'shares',False),
}

def sec_facts(symbol, cached):
    global SEC_MAP
    if symbol in ['SPY','QQQ','SMH','XLK','XLI','XLE','XLU']:
        return unavailable('ETF: issuer operating fundamentals do not apply.', 'SEC EDGAR')
    if cached and cached.get('fetched_at') and cached.get('classification') != 'UNAVAILABLE':
        try:
            if (NOW-datetime.fromisoformat(cached['fetched_at'])).total_seconds() < 86400:
                return cached
        except ValueError:
            pass
    headers = {'User-Agent':os.environ.get('SEC_USER_AGENT') or UA}
    if SEC_MAP is None:
        SEC_MAP = request('https://www.sec.gov/files/company_tickers.json',headers)
    hit = next((v for v in SEC_MAP.values() if v['ticker'].replace('.','-')==symbol.replace('.','-')),None)
    if not hit:
        return unavailable('Ticker is not mapped in SEC companyfacts.', 'SEC EDGAR')
    cik = str(hit['cik_str']).zfill(10)
    url = f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json'
    raw = request(url,headers)
    metrics = {}
    for name,(tags,unit,duration) in TAGS.items():
        candidates = []
        for tag in tags:
            for r in raw.get('facts',{}).get('us-gaap',{}).get(tag,{}).get('units',{}).get(unit,[]):
                if r.get('form') not in ['10-K','10-K/A','10-Q','10-Q/A'] or not r.get('end') or not r.get('filed') or r['filed']>NOW.date().isoformat() or number(r.get('val')) is None:
                    continue
                if duration:
                    if not r.get('start'):
                        continue
                    days = (datetime.fromisoformat(r['end'])-datetime.fromisoformat(r['start'])).days
                    if not 330 <= days <= 380 or r['form'] not in ['10-K','10-K/A']:
                        continue
                candidates.append({'value':number(r['val']),'period_start':r.get('start'),'period_end':r['end'],'filed':r['filed'],'accession':r.get('accn'),'form':r['form'],'tag':tag,'unit':unit,'classification':'SOURCE FACT'})
            # Debt components must not be renamed total debt or summed without reconciliation.
            if candidates:
                break
        candidates.sort(key=lambda r:(r['period_end'],r['filed']))
        unique = {}
        for c in candidates:
            unique[(c['period_start'],c['period_end'])]=c
        series = list(unique.values())[-10:]
        metrics[name]={'latest':series[-1] if series else None,'history':series,'classification':'SOURCE FACT' if series else 'UNAVAILABLE'}
    def derive(name, left, right, fn, same_start=True):
        a,b=metrics[left]['latest'],metrics[right]['latest']
        valid=a and b and a['period_end']==b['period_end'] and (not same_start or a['period_start']==b['period_start'])
        value=number(fn(a['value'],b['value'])) if valid else None
        metrics[name]={'classification':'CALCULATION' if value is not None else 'UNAVAILABLE','latest': {'value':value,'period_start':a['period_start'],'period_end':a['period_end'],'filed':max(a['filed'],b['filed']),'unit':'ratio' if 'margin' in name else 'USD','classification':'CALCULATION','inputs':[left,right]} if value is not None else None}
    derive('free_cash_flow','operating_cash_flow','capex',lambda a,b:a-abs(b))
    derive('operating_margin','operating_income','revenue',lambda a,b:a/b if b else None)
    derive('net_margin','net_income','revenue',lambda a,b:a/b if b else None)
    rev = metrics['revenue'].get('history',[])
    if len(rev)>=2 and rev[-2]['value']>0 and 330<=(datetime.fromisoformat(rev[-1]['period_end'])-datetime.fromisoformat(rev[-2]['period_end'])).days<=380:
        metrics['revenue_growth']={'classification':'CALCULATION','latest':{**rev[-1],'value':rev[-1]['value']/rev[-2]['value']-1,'unit':'ratio','classification':'CALCULATION'}}
    return {'classification':'SOURCE FACT','provider':'SEC EDGAR companyfacts','source_url':url,'fetched_at':iso(),'cik':cik,'name':raw.get('entityName'),'metrics':metrics,
            'note':'Annual flows and latest reported balance sheet facts. Each field carries its own period and filing date. Restated history is current knowledge and excluded from price-model backtests. Debt is the exact reported component, not total debt. No imputed tax rate or missing capex.'}

def resample(block, timeframe):
    if not block.get('bars'):
        return unavailable('Required lower timeframe is unavailable.',block.get('provider'))
    groups={}
    for b in block['bars']:
        if timeframe in ['15M','30M','4H']:
            secs={'15M':900,'30M':1800,'4H':14400}[timeframe]
            op,cl=session(b['session'])
            start=op+((b['ts']-op)//secs)*secs
            end=min(start+secs,cl)
            key=str(start)
            expected=None
        else:
            d=datetime.fromisoformat(b['date'])
            if timeframe=='1W':
                startday=(d-timedelta(days=d.weekday())).date()
                endday=startday+timedelta(days=6)
            else:
                startday=d.replace(day=1).date()
                endday=(d.replace(day=28)+timedelta(days=4)).replace(day=1).date()-timedelta(days=1)
            sessions=CAL.sessions_in_range(str(startday),str(endday))
            if len(sessions)==0:
                continue
            start=int(CAL.session_open(sessions[0]).timestamp())
            end=int(CAL.session_close(sessions[-1]).timestamp())
            expected=[str(s.date()) for s in sessions]
            key=str(start)
        group=groups.setdefault(key,{'start':start,'end':end,'expected':expected,'bars':[]})
        group['bars'].append(b)
    rows=[]; gaps=0
    for g in groups.values():
        z=g['bars']; end=g['end']
        if end+(900 if timeframe in ['1W','1M'] else 60)>NOW_TS:
            continue
        complete = ([b['date'] for b in z]==g['expected']) if g['expected'] is not None else (z[0]['ts']==g['start'] and z[-1]['end_ts']==end and all(z[i-1]['end_ts']==z[i]['ts'] for i in range(1,len(z))))
        if not complete:
            gaps+=1
            continue
        rows.append({'ts':g['start'],'end_ts':end,'date':z[0]['date'],'session':z[0]['date'],'open':z[0]['open'],'high':max(b['high'] for b in z),'low':min(b['low'] for b in z),'close':z[-1]['close'],'volume':sum(b['volume'] for b in z) if all(b['volume'] is not None for b in z) else None,'complete':True,'component_bars':len(z)})
    return {k:v for k,v in block.items() if k not in ['bars','forming_bars','interval','native','last_completed_bar']} | {
        'classification':'CALCULATION','native':False,'interval':timeframe,'resampled_from':block['interval'],
        'aggregation':'OHLCV, exchange sessions; no cross-session intraday buckets; final intraday bucket may be shorter.',
        'bars':rows,'forming_bars':[],'incomplete_groups_excluded':gaps,'last_completed_bar':rows[-1]['end_ts'] if rows else None,
        'status':('STALE' if block['status']=='STALE' else 'REVIEW' if block.get('quality')=='REVIEW' else 'COMPLETED BAR') if rows else 'UNAVAILABLE'}

def collect_symbol(symbol,out):
    global NOW, NOW_TS
    NOW=datetime.now(timezone.utc); NOW_TS=int(NOW.timestamp())
    old_path=out/'raw'/f'{symbol}.json'
    try: old=json.loads(old_path.read_text())
    except (OSError,json.JSONDecodeError): old={}
    frames={};meta={};errors=[]
    for interval,key in [('1d','1D'),('60m','1H'),('5m','5M')]:
        try:
            frames[key],m=yahoo(symbol,interval)
            if interval=='1d': meta=m
        except Exception as exc:
            errors.append({'provider':'Yahoo Finance chart','interval':interval,'error':str(exc)[:180]})
            frames[key]=unavailable(str(exc),'Yahoo Finance chart')
            if key=='1D' and os.environ.get('POLYGON_KEY'):
                try: frames[key]=polygon_daily(symbol)
                except Exception as ex: errors.append({'provider':'Polygon','error':str(ex)[:180]})
            if frames[key]['status']=='UNAVAILABLE' and old.get('timeframes',{}).get(key,{}).get('bars'):
                frames[key]={**old['timeframes'][key],'status':'STALE','fallback_used':True,'fallback_from':'Previously saved snapshot','latest_attempt_at':iso(),'latest_attempt_error':str(exc)[:180]}
    for tf,base in [('15M','5M'),('30M','5M'),('4H','1H'),('1W','1D'),('1M','1D')]:
        frames[tf]=resample(frames[base],tf)
    price=number(meta.get('regularMarketPrice'));qt=number(meta.get('regularMarketTime'))
    quote={'classification':'SOURCE FACT' if price and qt else 'UNAVAILABLE','provider':'Yahoo Finance chart metadata','price':price,'as_of':qt,'fetched_at':iso(),'currency':meta.get('currency'),'delay':'UNSPECIFIED BY PROVIDER','status':'SNAPSHOT' if price and qt else 'UNAVAILABLE','session_date':datetime.fromtimestamp(qt,NY).date().isoformat() if qt else None,'volume':number(meta.get('regularMarketVolume')),'high':number(meta.get('regularMarketDayHigh')),'low':number(meta.get('regularMarketDayLow'))}
    try: fundamentals=sec_facts(symbol,old.get('fundamentals'))
    except Exception as exc:
        fundamentals=unavailable(str(exc),'SEC EDGAR companyfacts')
        if old.get('fundamentals',{}).get('metrics'):
            fundamentals={**old['fundamentals'],'status':'STALE','latest_attempt_error':str(exc)[:180]}
    result={'schema_version':5,'symbol':symbol,'name':meta.get('longName') or meta.get('shortName') or fundamentals.get('name') or symbol,'fetched_at':iso(),'quote':quote,'market':schedule_state(),'timeframes':frames,'fundamentals':fundamentals,'provider_errors':errors}
    result['content_sha256']=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
    save(old_path,result)
    print(f"{symbol}: daily={len(frames['1D']['bars'])} hourly={len(frames['1H']['bars'])} 5m={len(frames['5M']['bars'])} {frames['1D']['status']}",flush=True)
    return {'symbol':symbol,'name':result['name'],'daily_status':frames['1D']['status'],'daily_bars':len(frames['1D']['bars']),'provider':frames['1D'].get('provider')}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',default='data')
    parser.add_argument('--symbols',nargs='*')
    args=parser.parse_args()
    config=json.loads((ROOT/'config/watchlist.json').read_text())
    syms=args.symbols or config['symbols']
    if any(not s or len(s)>12 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-' for c in s) for s in syms):
        raise SystemExit('Invalid watchlist ticker')
    out=Path(args.output)
    summaries=[collect_symbol(s,out) for s in syms]
    save(out/'collection.json',{'generated_at':iso(),'market':schedule_state(),'symbols':summaries,'sources_configured':{'yahoo':True,'SEC':True,'polygon':bool(os.environ.get('POLYGON_KEY'))},'schedule':'Every 30 minutes at :17 and :47 during 13:00–21:59 UTC weekdays; daily 22:17 UTC. GitHub schedules are best effort.'})
    if not any(s['daily_bars'] for s in summaries):
        raise SystemExit('No daily bars: refusing to publish an empty market-data replacement')

if __name__=='__main__':
    main()
