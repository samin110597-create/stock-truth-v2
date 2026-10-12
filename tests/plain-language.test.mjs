import test from 'node:test';import assert from 'node:assert/strict';
import {plainLanguage} from '../quant/src/plain-language.mjs';
const gate={allowed:true};
const q={timeframe:'1D',bars:[{high:98},{open:97,low:96,high:100,close:99}],quote:{price:99},state:{stage:'READY'},structure:{pattern:'HH + HL',resistance:[{price:110}]},plan:{entryZone:{low:97,high:102},stop:95,targets:[{price:110},{price:130}]}};
const v={dir:1,historyOK:true,resistance:110,support:95,horizon:10};
test('buy area is limited by nearest obstacle and 2-to-1 arithmetic',()=>{const p=plainLanguage(q,gate,v);assert.deepEqual(p.zone,{low:97,high:100});assert.equal(p.currentRR,11/4);assert.equal(p.action,'BUY CONDITIONS MET — CHECK YOUR FILL');});
test('latest quote above reward limit blocks an otherwise attractive assumed entry',()=>{const p=plainLanguage({...q,quote:{price:104}},gate,v);assert.equal(p.action,'WAIT FOR A BETTER PRICE');assert.equal(p.currentRR,6/9);});
test('near obstacle cannot be skipped in favor of distant targets',()=>{const p=plainLanguage({...q,structure:{...q.structure,resistance:[{price:99},{price:110}]}},gate,v);assert.equal(p.first,99);assert.equal(p.zone,null);assert.equal(p.action,'NO ATTRACTIVE BUY AREA YET');});
test('touch alone, stale data, conflicting periods and falling patterns never permit a buy',()=>{assert.equal(plainLanguage({...q,bars:[{high:101},q.bars[1]]},gate,v).action,'WAIT');assert.ok(!plainLanguage(q,{allowed:false},v).action.startsWith('BUY'));assert.equal(plainLanguage({...q,mtf:{rows:[{timeframe:'4H',bias:-1}]}},gate,v).action,'WAIT — DIRECTION UNCLEAR');assert.equal(plainLanguage(q,gate,{...v,dir:-1}).zone,null);});
test('price crossing loss level retires the buy plan before a candle closes',()=>{const p=plainLanguage({...q,quote:{price:94}},gate,v);assert.equal(p.action,'DO NOT USE THIS BUY PLAN');assert.equal(p.broken,true);});
test('rounding cannot overstate the permissible entry or invent an arrival date',()=>{const p=plainLanguage({...q,plan:{...q.plan,stop:95.013}},gate,v);assert.ok(p.zone.high<=p.cap);assert.match(p.timing,/not a promise/);assert.match(p.rule,/not a proven win rate/);});

test('stale quotes never populate reward labeled as current',()=>{assert.equal(plainLanguage(q,{allowed:false},v).currentRR,null);});
