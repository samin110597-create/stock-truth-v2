import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileDaily,refreshBlock,retrieveTicker,periodBars} from '../src/providers.mjs';
import {confirmsReaction,weeklyDirection,setupAt} from '../src/setups.mjs';
import {resolveSetup,activeSetup} from '../src/validation.mjs';
import {livePlanState,positionSize} from '../src/risk.mjs';
import {technicals} from '../src/technicals.mjs';import {structure} from '../src/structure.mjs';import {reversals} from '../src/reversal.mjs';import {analyze} from '../src/analysis.mjs';import {dataHealth} from '../src/bars.mjs';
// Deterministic fixtures only; these numbers never ship as market observations.
const calendar={sessions:{}};const bars=[];
for(let date=new Date('2025-01-02T14:30:00Z');bars.length<360;date.setUTCDate(date.getUTCDate()+1)){
  if([0,6].includes(date.getUTCDay()))continue;
  const i=bars.length,ts=date.getTime()/1000,day=date.toISOString().slice(0,10),price=100+i*.05+Math.sin(i/8)*8;
  calendar.sessions[day]=[ts,ts+23400];bars.push({ts,end_ts:ts+23400,date:day,session:day,complete:true,open:price,high:price+2,low:price-2,close:price+Math.sin(i),volume:1000+100*(i%5)});
}
const now=bars.at(-1).end_ts+1000;
const block=rows=>({bars:rows,quality:'PASS',status:'COMPLETED BAR',provider:'Fixture source',fetched_at:new Date(now*1000).toISOString()});
const deep=block(bars.slice(0,-1)),recent=block(bars.slice(-30));
test('cross-source history is extended only after OHLC agreement and explicit row provenance',()=>{
  const out=reconcileDaily(deep,recent,calendar,now);assert.equal(out.check.status,'PASS');assert.equal(out.block.bars.length,bars.length);assert.equal(out.block.bars.at(-1).source_provider,recent.provider);assert.deepEqual(out.block.bars.map(b=>b.close),bars.map(b=>b.close));
  const shifted=block(recent.bars.map(b=>({...b,open:b.open/2,high:b.high/2,low:b.low/2,close:b.close/2})));
  assert.equal(reconcileDaily(deep,shifted,calendar,now).check.status,'REJECTED');
  assert.equal(reconcileDaily(block(bars.slice(0,-6)),recent,calendar,now).check.status,'REJECTED');
});
test('a trailing rejected row is repairable, but an interior omission or split anomaly is not',()=>{
  const broken={...deep,quality:'REVIEW',rejected:[{ts:bars.at(-1).ts,reason:'Missing/invalid OHLC; not imputed'}],large_gaps:[],split_audit:[]};
  const fixed=reconcileDaily(broken,recent,calendar,now);assert.equal(fixed.check.status,'PASS');assert.equal(fixed.block.resolved_rejections.length,1);assert.equal(fixed.block.quality,'PASS');
  assert.equal(reconcileDaily({...broken,bars:broken.bars.filter((b,i)=>i!==40)},recent,calendar,now).check.status,'REJECTED');
  assert.equal(reconcileDaily({...broken,split_audit:[{status:'REVIEW'}]},recent,calendar,now).check.status,'REJECTED');
});
test('calendar recency, missing sessions and invalid candles suppress actions independently of fetch time',()=>{
  assert.equal(refreshBlock(deep,'1D',calendar,now).status,'STALE');
  assert.equal(refreshBlock(block(bars.filter((_,i)=>i!==100)),'1D',calendar,now).quality,'REVIEW');
  assert.equal(dataHealth({market:{state:'CLOSED'},timeframes:{'1D':block([{...bars[0],high:1}])}},now).tradeable,false);
  const missingFriday={sessions:Object.fromEntries(Object.entries(calendar.sessions).slice(0,7))};
  const periods=periodBars(bars.slice(0,6),'1W',missingFriday,now);assert.ok(periods.every(p=>p.date!==bars[2].date));
});
test('weekly evidence does not use the unfinished current week or future extension',()=>{
  const prefix=bars.slice(0,150);assert.equal(weeklyDirection(prefix,149),weeklyDirection(bars,149));
  const changed=prefix.map((b,i)=>i===149?{...b,close:b.close*100}:b);assert.equal(weeklyDirection(changed,149),weeklyDirection(prefix,149));
});
test('a wick near support alone cannot masquerade as a confirmed reaction',()=>{
  const b=[{open:100,high:102,low:99,close:101},{open:101,high:102,low:99,close:99.5}];assert.equal(confirmsReaction(b,1,100,1,2),false);
  b[1]={open:100,high:103,low:99.5,close:102.5};assert.equal(confirmsReaction(b,1,100,1,2),true);
  const mirrored=b.map(x=>({open:200-x.open,high:200-x.low,low:200-x.high,close:200-x.close}));assert.equal(confirmsReaction(mirrored,1,100,-1,2),true);
});
const plan={symbol:'TEST',dir:1,signal_i:0,signal_ts:100,entry_zone:{low:99,high:100},stop:95,targets:[{price:110}],entry_expiry_sessions:3,time_exit_sessions:21,current_action:'WAIT FOR RETEST'};
test('gaps outside a fixed entry band cancel; an unfilled target is not a new entry',()=>{
  const gap={open:98,low:97,high:103,close:101};assert.equal(resolveSetup([{},gap],plan).state,'CANCELLED GAP BEYOND ENTRY ZONE');
  assert.equal(resolveSetup([{},gap],{...plan,model_version:'5.0.0-causal-swing'}).entered,true);
  assert.equal(resolveSetup([{}, {open:105,high:111,low:103,close:110}],plan).state,'TARGET TESTED BEFORE ENTRY');
  assert.equal(resolveSetup([{}, {open:102,high:103,low:97,close:100}],{...plan,dir:-1,entry_zone:{low:100,high:101},stop:105,targets:[{price:90}]}).entered,false);
});
test('post-signal stop touches block entry; earlier or malformed session ranges do not invalidate a plan',()=>{
  const raw={market:{state:'CLOSED'},quote:{price:102,as_of:110,session_date:'1970-01-01',low:90,high:103},timeframes:{'1D':{forming_bars:[]}}};
  assert.equal(livePlanState(plan,{},raw,{tradeable:true},200).action,'PLAN FOR NEXT SESSION');
  raw.timeframes['1D'].forming_bars=[{ts:120,open:102,high:103,low:94,close:96}];assert.equal(livePlanState(plan,{},raw,{tradeable:true},200).stop_tested,true);
  raw.timeframes['1D'].forming_bars=[{ts:120,open:102,high:92,low:90,close:96}];assert.equal(livePlanState(plan,{},raw,{tradeable:true},200).stop_tested,undefined);
  raw.quote.price=111;assert.equal(livePlanState(plan,{},raw,{tradeable:true},200).target_tested,true);
});
test('risk sizing caps both fixed-stop loss and account allocation for long and short',()=>{
  const r=positionSize({capital:10000,riskPct:1,maxAllocationPct:20,entry:100,stop:95});assert.equal(r.shares,20);assert.equal(r.planned_loss,100);
  assert.equal(positionSize({capital:10000,riskPct:1,maxAllocationPct:10,entry:100,stop:105,dir:-1}).shares,10);
  assert.equal(positionSize({capital:10000,riskPct:1,entry:100,stop:105}).shares,null);
});
test('future bars cannot rewrite an already confirmed historical plan',()=>{
  let seed=1729,price=100;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const fixture=Array.from({length:700},(_,i)=>{const open=price;price=Math.max(10,open+(rnd()-.48)*6);const date=new Date(Date.UTC(2020,0,1+i));return {ts:date.getTime()/1000,end_ts:date.getTime()/1000+20000,date:date.toISOString().slice(0,10),open,high:Math.max(open,price)+rnd(),low:Math.min(open,price)-rnd(),close:price,volume:1000+rnd()*2000,complete:true};});
  const t=technicals(fixture),s=structure(fixture,t),r=reversals(fixture,t,s);let checked=0;
  for(let i=70;i<fixture.length-5;i++){
    const issued=setupAt(fixture,t,s,r,i,'Adaptive','SWING',{symbol:'TEST'}).setup;if(!issued)continue;
    const prefix=fixture.slice(0,i+1),pt=technicals(prefix),ps=structure(prefix,pt),pr=reversals(prefix,pt,ps);
    assert.deepEqual(issued,setupAt(prefix,pt,ps,pr,i,'Adaptive','SWING',{symbol:'TEST'}).setup);checked++;
    if(checked===3)break;
  }
  assert.equal(checked,3,'Fixture must exercise three actual issued setups');
  const active=activeSetup(fixture,t,s,r,'Adaptive','SWING','TEST');if(active.setup)assert.deepEqual(active.setup,setupAt(fixture,t,s,r,active.setup.signal_i,'Adaptive','SWING',{symbol:'TEST'}).setup);
});
test('a never-seen symbol with quote and cache failures still computes its own sourced history',async()=>{
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async input=>{const url=String(input);calls.push(url);
    if(url.includes('/history'))return {ok:true,json:async()=>({data:{data:bars.map(b=>({t:b.date,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}))}})};
    return {ok:false,status:404};
  };
  try{
    const r=await retrieveTicker('NEWTEST',calendar);assert.equal(r.symbol,'NEWTEST');assert.equal(r.quote.price,null);assert.equal(r.fundamentals.status,'UNAVAILABLE');assert.ok(calls.some(c=>c.includes('/NEWTEST/history')));
    const a=analyze(r,{validate:false});assert.equal(a.symbol,'NEWTEST');assert.equal(a.frames['1D'].bars.at(-1).close,bars.at(-1).close);assert.ok(a.thesis.current.startsWith('NEWTEST'));assert.ok(Number.isFinite(a.frames['1D'].technicals.rsi));assert.ok(a.frames['1D'].structure.support.length);assert.equal(a.frames['5M'].status,'UNAVAILABLE');
  }finally{globalThis.fetch=original;}
});
