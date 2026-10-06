import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFreshness} from '../quant/src/freshness.mjs';
import {normalizeHistory,parsePublicHistory} from '../quant/src/public-data.mjs';
import worker from '../gateway/worker.mjs';
const now=Date.now()/1000;
test('quote status is tied to market time, never retrieval time',()=>{
 assert.equal(quoteFreshness({as_of:now-3600,fetched_at:new Date().toISOString()},now).status,'OLDER QUOTE');
 assert.equal(quoteFreshness({as_of:now-30},now).status,'RECENT');
 assert.equal(quoteFreshness(null,now).status,'UNAVAILABLE');
});
test('forming daily bars and null OHLC do not enter technical history',()=>{
 const day='2026-10-06',start=1791293400,end=start+23400,calendar={sessions:{[day]:[start,end]}};
 const row={t:start*1000,o:10,h:12,l:9,c:11,v:100};
 const j={format:'massive',payload:{results:[row]}};
 assert.equal(normalizeHistory(j,'1D',calendar,end-10).bars.length,0);
 assert.equal(normalizeHistory(j,'1D',calendar,end+1000).bars.length,1);
 assert.equal(normalizeHistory({...j,payload:{results:[{...row,o:null}]}},'1D',calendar,end+1000).bars.length,0);
});
test('gateway rejects arbitrary proxy URLs and invalid symbols before provider requests',async()=>{
 const ctx={waitUntil(){}};
 assert.equal((await worker.fetch(new Request('https://test.invalid/proxy?url=https://example.com'),{},ctx)).status,404);
 assert.equal((await worker.fetch(new Request('https://test.invalid/v1/quote?symbol=../../secret'),{},ctx)).status,400);
});
test('gateway coalesces simultaneous ticker quote requests without exposing credentials',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return Response.json({c:123.45,t:Math.floor(now)});};
 try{const req=new Request('https://test.invalid/v1/quote?symbol=NEWTEST'),ctx={waitUntil(){}};
 const rs=await Promise.all([worker.fetch(req,{FINNHUB_KEY:'private-test-key'},ctx),worker.fetch(req,{FINNHUB_KEY:'private-test-key'},ctx)]);
 assert.equal(calls,1);for(const r of rs){const body=await r.text();assert.ok(!body.includes('private-test-key'));assert.equal(JSON.parse(body).symbol,'NEWTEST');assert.equal(r.headers.get('Cache-Control'),'public, max-age=60');}
 }finally{globalThis.fetch=previous;}
});
test('an unseen ticker works without gateway or repository snapshot; requested intraday degrades to daily',async()=>{
 const previous=globalThis.fetch,dates={};const rows=[];
 for(let i=0;i<110;i++){const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),start=Date.parse(date+'T14:30:00Z')/1000;dates[date]=[start,start+23400];rows.push({t:date,o:100+i,h:103+i,l:99+i,c:102+i,v:10000});}
 globalThis.fetch=async input=>{const url=String(input);
 if(url.includes('runtime-config'))return Response.json({apiBase:''});
 if(url.includes('calendar.json'))return Response.json({sessions:dates});
 if(url.includes('/history'))return Response.json({data:rows});
 if(url.includes('/quotes/s/'))return Response.json({data:{symbol:'NEWTICKER',p:212,ts:Date.now()}});
 if(url.includes('tgmcharts'))return Response.json({symbol:'NEWTICKER',metrics:{marketCap:1000000}});
 return new Response('{}',{status:404});};
 try{const {loadMarketData}=await import('../quant/src/data.mjs?unseen-test');const result=await loadMarketData({symbol:'NEWTICKER',asset:'STOCK',timeframe:'15M'});
 assert.equal(result.symbol,'NEWTICKER');assert.equal(result.timeframe,'1D');assert.equal(result.bars.length,110);assert.equal(result.quote.price,212);assert.match(result.notice,/15M UNAVAILABLE/);assert.equal(result.research.fundamentals.status,'AVAILABLE');
 }finally{globalThis.fetch=previous;}
});

test('stale history cannot publish a trade-ready recommendation',async()=>{
 const {analyzeQuant}=await import('../quant/src/engine.mjs');
 const bars=Array.from({length:100},(_,i)=>({ts:1000+i*86400,end_ts:2000+i*86400,open:100+i,high:103+i,low:99+i,close:102+i,volume:1000,complete:true}));
 const result=analyzeQuant({symbol:'TEST',bars,dataStatus:'STALE'});
 assert.equal(result.state.stage,'DATA REVIEW');assert.match(result.state.action,/NO TRADE/);assert.equal(result.plan?.quality,'WITHHELD');
});
