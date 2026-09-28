import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastRecord,evaluateRecord,summarizeLedger} from '../quant/src/accuracy.mjs';

function bars(n=30){
  const out=[];for(let i=0;i<n;i++){const p=100+i;out.push({ts:i*60,end_ts:(i+1)*60,date:'2026-01-'+String(i+1).padStart(2,'0'),open:p,high:p+.6,low:p-.6,close:p,volume:1000,complete:true});}return out;
}
function q(){
  const b=bars(10);return {model:'Q-STATE UNIFIED 3.0',symbol:'TEST',sourceSymbol:'TEST',asset:'STOCK',timeframe:'1D',generatedAt:'2026-01-10T00:00:00Z',provider:'fixture',bars:b,trained:{modelVersion:'QSTATE-UNIFIED-3.0'},state:{direction:'BULLISH',stage:'READY',regime:'TREND',quality:'A',probabilityStatus:'WALK_FORWARD_VALIDATED',calibratedProbabilityUp:.7,calibratedProbabilityDirection:.7,calibratedProbabilityHorizon:5},math:{atr:2},forecast:{projection:{primary:{bar5:115,bar10:120,bar20:130}}},plan:{direction:'LONG',trigger:110,stop:107,targets:[{name:'TP1',price:113}]}};}
test('issued forecast record is deterministic for the same completed bar',()=>{const a=forecastRecord(q()),b=forecastRecord(q());assert.equal(a.id,b.id);assert.equal(a.entryPrice,109);assert.equal(a.atr,2);});
test('ATR-first Brier outcome uses the exact probability label',()=>{const r=forecastRecord(q()),b=bars(30);b[10]={...b[10],high:112,low:109.2,close:111};const o=evaluateRecord(r,b);assert.equal(o.horizons[5].atrEventLabel,1);assert.ok(Math.abs(o.horizons[5].brier-.09)<1e-12);});
test('same-bar upper and lower ATR touch is ambiguous and excluded from Brier',()=>{const r=forecastRecord(q()),b=bars(30);b[10]={...b[10],high:112,low:106,close:109};const o=evaluateRecord(r,b);assert.equal(o.horizons[5].atrEventStatus,'AMBIGUOUS_SAME_BAR');assert.equal(o.horizons[5].brier,null);});
test('trade collision is conservative: stop wins same bar',()=>{const r=forecastRecord(q()),b=bars(30);b[10]={...b[10],open:110,high:114,low:106,close:111};const o=evaluateRecord(r,b),t=o.horizons[5].trade;assert.equal(t.stopBeforeTp1,true);assert.equal(t.tp1HitBeforeStop,false);assert.equal(t.falseBreakout,true);});
test('summary separates timeframes and horizons',()=>{const r=forecastRecord(q()),b=bars(30),o=evaluateRecord(r,b),s=summarizeLedger([r],[o]);assert.equal(s.forecastCount,1);assert.equal(s.timeframes['1D'][5].n,1);assert.equal(s.timeframes['15M'][5].n,0);});

test('WATCH setups do not count as executed trade statistics',()=>{const x=q();x.state.stage='WATCH';const r=forecastRecord(x),b=bars(30),o=evaluateRecord(r,b),s=summarizeLedger([r],[o]);assert.equal(s.timeframes['1D'][5].tradeN,0);assert.equal(s.timeframes['1D'][5].tp1HitRate,null);});
