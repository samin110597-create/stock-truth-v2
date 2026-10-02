import test from 'node:test';import assert from 'node:assert/strict';
import {freshestQuote,dataUsed} from '../src/quote-freshness.mjs';
const q=(as_of,extra={})=>({symbol:'NVDA',price:100,as_of,currency:'USD',...extra});
test('Newest market timestamp wins; fetched time never makes old data fresh',()=>{
 const newer=q(100,{high:105,provider:'secured'}),older=q(90,{high:900,fetched_at:'2099-01-01'});
 assert.equal(freshestQuote('NVDA',[older,newer],110),newer);
 assert.equal(freshestQuote('NVDA',[newer,older],110).high,105);
});
test('Reject wrong ticker, future, missing timestamp, invalid price and foreign currency',()=>{
 assert.equal(freshestQuote('NVDA',[q(100,{symbol:'MU'}),q(9999),q(null),q(100,{price:0}),q(100,{currency:'EUR'})],110),null);
});
test('Report calculation, quote and completed-bar clocks separately',()=>{
 const u=dataUsed({quote:q(100),generated_at:'2026-09-21',frames:{'1D':{bars:[{end_ts:80}]},'1H':{bars:[{end_ts:95}]}}},'1H');
 assert.equal(u.quote.as_of,100);assert.equal(u.technical_bar_end,95);assert.equal(u.forecast_daily_bar_end,80);assert.equal(u.calculated_at,'2026-09-21');
});
