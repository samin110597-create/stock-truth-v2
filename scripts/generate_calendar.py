import json
from pathlib import Path
import exchange_calendars as xcals
c=xcals.get_calendar('XNYS',start='1990-01-01',end='2028-12-31')
p=Path('data/calendar.json');p.parent.mkdir(exist_ok=True)
p.write_text(json.dumps({'provider':'exchange_calendars 4.13.2 XNYS','classification':'CALCULATION','timezone':'America/New_York','sessions':{str(x.date()):[int(c.session_open(x).timestamp()),int(c.session_close(x).timestamp())] for x in c.sessions}},separators=(',',':')))
