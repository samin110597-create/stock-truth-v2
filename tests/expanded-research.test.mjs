import test from 'node:test';import assert from 'node:assert/strict';
import {technicals} from '../src/technicals.mjs';
import {wyckoff} from '../src/wyckoff.mjs';
import {impulseRules,elliott} from '../src/elliott.mjs';
import {forecastFeatures,fitAt,technicalForecast} from '../src/forecast.mjs';
import {parseStatements,combineFundamentals,retrieveFundamentals} from '../src/fundamentals.mjs';
// Synthetic fixtures are confined to tests and never published as market data.
const bars=Array.from({length:400},(_,i)=>{const c=100+i*.03+Math.sin(i/8)*4,ts=Date.UTC(2024,0,i+1)/1000;return {ts,end_ts:ts+20000,date:new Date(ts*1000).toISOString().slice(0,10),open:c-.2,close:c,high:c+1,low:c-1,volume:1000+(i%4)*100,complete:true};});
test('Wyckoff spring uses a previously established range; future extension does not rewrite the event',()=>{
  const b=bars.slice(0,90).map((b,i)=>({...b,open:100+Math.sin(i/3)*4,close:100+Math.sin(i/3)*4,high:101+Math.sin(i/3)*4,low:99+Math.sin(i/3)*4,volume:1000}));
  b[61]={...b[61],low:94,open:96,close:97,high:98,volume:2500};
  const prefix=b.slice(0,62),before=wyckoff(prefix,technicals(prefix)),after=wyckoff(b,technicals(b));
  const event=before.events.find(e=>e.type==='SPRING CANDIDATE'&&e.i===61);assert.ok(event);assert.ok(before.range.known_at<b[61].end_ts);
  assert.deepEqual(after.events.find(e=>e.type===event.type&&e.i===61),event);
  const failed=[...prefix,{...b[62],low:93,close:94,high:98}];assert.ok(wyckoff(failed,technicals(failed)).events.some(e=>e.type==='SPRING INVALIDATED'));
});
test('Elliott rejects total wave-2 retracement, wave-4 overlap and shortest wave-3; rules mirror for shorts',()=>{
  const points=values=>values.map((price,i)=>({price,type:i%2?'H':'L'}));
  const valid=points([100,120,110,150,135,160]);assert.equal(impulseRules(valid).valid,true);
  assert.equal(impulseRules(valid.map(p=>({price:300-p.price,type:p.type==='H'?'L':'H'}))).valid,true);
  for(const values of [[100,120,99],[100,120,110,150,119],[100,160,140,170,165,210]])assert.equal(impulseRules(points(values)).valid,false);
});
test('Elliott projection targets are anchored and a later invalidation retires that count',()=>{
  const prices=[100,120,110,150,135],p=prices.map((price,i)=>({price,type:i%2?'H':'L',i:5+i*8,ts:bars[5+i*8].ts,confirmed_ts:bars[8+i*8].end_ts,confirmed_at:8+i*8,quality:80}));
  const b=bars.slice(0,43).map(x=>({...x,open:139,close:140,high:141,low:138})),t={series:{atr:b.map(()=>2)}};
  const count=elliott(b,t,{pivots:p}).candidates.find(c=>c.anchors.length===5);assert.ok(count);assert.equal(count.targets[0].price,155);
  const updated=[...b,{...bars[43],open:145,close:146,high:147,low:144}];assert.deepEqual(elliott(updated,{series:{atr:updated.map(()=>2)}},{pivots:p}).candidates[0].targets,count.targets);
  updated.push({...bars[44],open:122,close:121,high:123,low:119});assert.ok(!elliott(updated,{series:{atr:updated.map(()=>2)}},{pivots:p}).candidates.some(c=>c.id===count.id));
});
test('Forecast fits are causal, embargo all labels and cannot use a changed future',()=>{
  const t=technicals(bars),f=forecastFeatures(bars,t),fit=fitAt(bars,f,220,21);assert.ok(fit);assert.ok(fit.label_end<220);
  const changed=bars.map((b,i)=>i>=220?{...b,close:b.close*2,high:b.high*2,low:b.low*2,open:b.open*2}:b);
  const unchangedOrigin=changed.map((b,i)=>i===220?bars[i]:b),nf=forecastFeatures(unchangedOrigin,technicals(unchangedOrigin));
  assert.deepEqual(fitAt(unchangedOrigin,nf,220,21),fit);
  assert.equal(fitAt(bars,f,100,63),null);
  const out=technicalForecast(bars,t);
  for(const h of out.horizons.filter(h=>h.validation)){assert.ok(h.base>0);for(let i=0;i<h.validation.folds.length;i++){const z=h.validation.folds[i];assert.ok(z.train_through<z.origin);if(i)assert.ok(h.validation.folds[i-1].through<z.origin);}}
  const short=technicalForecast(bars.slice(0,75),technicals(bars.slice(0,75)));assert.ok(short.horizons.every(h=>h.status==='INSUFFICIENT DATA'));
});
test('Filing values preserve zeros, dates, units and missingness; future facts and mismatched periods are excluded',()=>{
  const concepts=['revenue','operatingIncome','operatingCashFlow','capitalExpenditure'].map(key=>({key,unit:'USD'}));
  const row=(periodEnd,metrics,filed='2025-02-10')=>({periodStart:periodEnd.slice(0,4)+'-01-01',periodEnd,metrics,provenance:Object.fromEntries(Object.keys(metrics).map(k=>[k,{filed,tag:k,accn:'test-filing',form:'10-K'}]))});
  const statement={symbol:'TEST',period:'annual',concepts,rows:[row('2024-12-31',{revenue:100,operatingIncome:0,operatingCashFlow:30,capitalExpenditure:null}),row('2023-12-31',{revenue:80})]};
  const m=parseStatements('TEST',[statement],'2025-03-01T00:00:00Z');assert.equal(m.operating_income.latest.value,0);assert.equal(m.operating_margin.latest.value,0);assert.equal(m.revenue_growth.latest.value,.25);assert.equal(m.free_cash_flow,undefined);assert.equal(m.revenue.latest.basis,'annual');
  assert.deepEqual(parseStatements('OTHER',[statement]),{});
  assert.deepEqual(parseStatements('TEST',[{...statement,rows:[row('2026-12-31',{revenue:300},'2027-02-01')]}],'2025-03-01'),{});
  assert.equal(combineFundamentals('TEST',{symbol:'OTHER'},[],['No coverage']).status,'UNAVAILABLE');
});
test('Financial requests allow an unseen symbol, reject mismatched identity and degrade individual statements',async()=>{
  const original=globalThis.fetch,calls=[];globalThis.fetch=async url=>{calls.push(String(url));return String(url).includes('/summary/')?{ok:true,json:async()=>({symbol:'UNSEEN',name:'Fixture company',price:{marketCap:100}})}:{ok:false,status:404};};
  try{const r=await retrieveFundamentals('UNSEEN',undefined,{storage:null});assert.equal(r.status,'PARTIAL');assert.equal(r.summary.name,'Fixture company');assert.equal(Object.keys(r.metrics).length,0);assert.ok(calls.some(x=>x.includes('/summary/UNSEEN')));assert.ok(r.errors.length===3);}
  finally{globalThis.fetch=original;}
});
