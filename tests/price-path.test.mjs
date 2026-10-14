import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyLevels,pricePath,projectionEnd} from '../quant/src/price-path.mjs';
import {pricePathHTML} from '../quant/src/price-path-view.mjs';
import {rsi} from '../quant/src/math.mjs';
import {structureEngine} from '../quant/src/engine.mjs';
const q={symbol:'TEST',timeframe:'1D',bars:Array.from({length:300},(_,i)=>({close:100,end_ts:i,date:'2026-10-13'})),math:{atr:4},state:{direction:'BULLISH'},quote:{price:100,as_of:301},structure:{direction:1,allHighs:[{i:295,confirmedAt:299,price:105},{i:280,price:110},{i:100,price:115},{i:3,price:101}],allLows:[{i:295,price:95},{i:270,price:94.7},{i:200,price:90}]},forecast:{monteCarlo:[{step:5,p10:90,median:102,p90:110}]},priceStudy:[{tf:'1D',status:'COMPLETED BAR',direction:1},{tf:'1H',status:'STALE'}]};
const gate={allowed:true,quote:{allowed:true},historyStatus:'COMPLETED BAR'};
test('levels drop old pivots, merge near duplicates and remain ordered around the quote',()=>{
 const p=nearbyLevels(q,100);assert.deepEqual(p.above.map(x=>x.price),[105,110,115]);assert.deepEqual(p.below.map(x=>x.price),[95,90]);
 const moved=nearbyLevels(q,94);assert.equal(moved.above[0].price,94.7);assert.equal(moved.below[0].price,90);
});
test('fresh quote crossing a level retires old model paths and cannot reuse crossed support',()=>{
 const p=pricePath({...q,quote:{price:94}},gate);assert.equal(p.moved,true);assert.equal(p.rows[0].available,false);assert.equal(p.levels.below[0].price,90);assert.ok(p.levels.above.every(x=>x.price>94));
 assert.ok(!pricePathHTML(q,p).includes('<td>$102.00</td>'));
});
test('stale quote never relocates levels and unavailable history never produces current projections',()=>{
 const p=pricePath({...q,quote:{price:70}},{...gate,quote:{allowed:false}});assert.equal(p.price,100);assert.equal(p.moved,false);
 assert.ok(pricePath(q,{...gate,historyStatus:'STALE'}).rows.every(x=>!x.available));
});
test('conflicting completed periods prevent a clear lean; stale ones do not vote',()=>{
 assert.equal(pricePath(q,gate).disagreement,false);
 const p=pricePath({...q,priceStudy:[...q.priceStudy,{tf:'1W',status:'COMPLETED BAR',direction:-1}]},gate);assert.equal(p.disagreement,true);assert.match(p.bias,/MIXED/);assert.deepEqual(p.missing,['1H']);
});
test('projection dates count exchange sessions, including a short final intraday bar',()=>{
 const calendar={sessions:{'2026-10-14':[1000,24400],'2026-10-15':[87400,110800],'2026-10-19':[433000,456400]}};
 assert.equal(projectionEnd({...q,calendar},3),456400);
 const intraday={...q,timeframe:'4H',calendar,bars:[{ts:1000,end_ts:15400}]};assert.equal(projectionEnd(intraday,1),24400);assert.equal(projectionEnd(intraday,2),101800);assert.equal(projectionEnd(intraday,9),null);
});
test('unconfirmed pivots cannot enter a projection',()=>{
 const p=nearbyLevels({...q,structure:{...q.structure,allHighs:[{price:101,i:299,confirmedAt:303}]}},100);assert.deepEqual(p.above,[]);
});
test('RSI is neutral for a completely flat series and bounded for monotonic prices',()=>{
 assert.equal(rsi(Array(40).fill(100),14).at(-1),50);assert.equal(rsi(Array.from({length:40},(_,i)=>100+i),14).at(-1),100);assert.equal(rsi(Array.from({length:40},(_,i)=>100-i),14).at(-1),0);
});
test('a new completed breakdown overrides the preceding higher-high/higher-low pattern',()=>{
 const bars=Array.from({length:100},(_,i)=>{const c=100+i*.3+Math.sin(i*Math.PI/10)*5;return {open:c,high:c+1,low:c-1,close:c};});
 const old=structureEngine(bars,rsi(bars.map(x=>x.close)));assert.equal(old.pattern,'HH + HL');
 bars.push({open:125,high:126,low:80,close:81});const broken=structureEngine(bars,rsi(bars.map(x=>x.close)));assert.equal(broken.direction,-1);assert.equal(broken.events.at(-1).dir,-1);
});
test('projection text escapes symbols and does not invent a level in price discovery',()=>{
 const input={...q,symbol:'<script>',structure:{allHighs:[],allLows:[]}},html=pricePathHTML(input,pricePath(input,gate));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.match(html,/destination is withheld/);
});
