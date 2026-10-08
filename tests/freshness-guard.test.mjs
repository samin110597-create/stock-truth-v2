import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteGate,freshnessGate,gateAnalysis} from '../quant/src/freshness-guard.mjs';
import {forecastRecord} from '../quant/src/accuracy.mjs';
const open=Date.parse('2026-10-08T13:30:00Z')/1000,close=open+23400;
const calendar={sessions:{'2026-10-07':[open-86400,close-86400],'2026-10-08':[open,close],'2026-10-09':[open+86400,close+86400]}};
const bar=(ts,end,date)=>({ts,end_ts:end,date,open:100,high:102,low:99,close:101,volume:100,complete:true});
const quote=(time)=>({symbol:'NEW',price:101,as_of:time,fetched_at:new Date().toISOString()});
const daily={symbol:'NEW',timeframe:'1D',calendar,dataStatus:'COMPLETED BAR',bars:[bar(open-86400,close-86400,'2026-10-07')]};
test('900-second boundary uses exact market time; fetch time cannot revive a stale quote',()=>{
 const now=open+3600;
 assert.equal(quoteGate('NEW',quote(now-900),now).allowed,true);
 assert.equal(quoteGate('NEW',quote(now-900.001),now).allowed,false);
 assert.equal(quoteGate('NEW',quote(now+1),now).allowed,false);
 assert.equal(quoteGate('OTHER',quote(now),now).allowed,false);
 assert.equal(quoteGate('NEW',null,now).allowed,false);
});
test('current quote plus previous completed daily candle is valid during regular session',()=>{
 const now=open+3600,g=freshnessGate({...daily,quote:quote(now-30)},now);
 assert.equal(g.allowed,true);assert.equal(g.market.state,'OPEN');
});
test('fresh quote cannot hide missing intraday candles',()=>{
 const now=open+3600;
 const d={...daily,timeframe:'15M',quote:quote(now-10),bars:[bar(open,open+900,'2026-10-08')]};
 assert.equal(freshnessGate(d,now).allowed,false);
 d.bars=Array.from({length:3},(_,i)=>bar(open+i*900,open+(i+1)*900,'2026-10-08'));
 assert.equal(freshnessGate(d,now).allowed,true);
 assert.equal(freshnessGate(d,now+61).allowed,false);
});
test('closed market is labeled but never exempts an old price from the strict limit',()=>{
 const d={...daily,bars:[...daily.bars,bar(open,close,'2026-10-08')],quote:quote(close)};
 const g=freshnessGate(d,close+901);
 assert.equal(g.market.state,'CLOSED');assert.equal(g.allowed,false);
});
test('expiry removes actionable plan and prevents new forecast records without mutating published inputs',()=>{
 const now=open+3600,q={...daily,quote:quote(now-900),state:{stage:'READY',quality:'A'},plan:{stop:90},forecast:{projection:{primary:{bar5:110}},monteCarlo:[1]}};
 assert.equal(gateAnalysis(q,now).plan.stop,90);
 const expired=gateAnalysis(q,now+1);
 assert.equal(expired.plan,null);assert.equal(expired.state.quality,'WITHHELD');assert.equal(expired.forecast.projection,null);assert.equal(forecastRecord(expired),null);assert.equal(q.plan.stop,90);
});
test('missing or expired exchange calendar cannot certify history',()=>{
 assert.equal(freshnessGate({...daily,calendar:null,quote:quote(open)},open).allowed,false);
 assert.equal(freshnessGate({...daily,quote:quote(close+7*86400)},close+7*86400).historyStatus,'UNKNOWN');
});
