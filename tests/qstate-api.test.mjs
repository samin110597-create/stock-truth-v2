import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('main.ts','utf8');
const data=fs.readFileSync('quant/src/data.mjs','utf8');
const deno=JSON.parse(fs.readFileSync('deno.json','utf8'));

test('Deno backend exposes health and arbitrary-symbol REST routes',()=>{
  assert.match(app,/u\.pathname==="\/health"/);
  assert.match(app,/u\.pathname==="\/v1\/market"/);
  assert.match(app,/MASSIVE_KEY/);
  assert.match(app,/FMP_API_KEY/);
  assert.match(app,/FINNHUB_API_KEY/);
  assert.match(app,/ALPHA_VANTAGE_KEY/);
  assert.match(app,/Yahoo server fallback/);
});

test('Deno backend supports stock ETFs and metal aliases',()=>{
  assert.match(app,/GOLD:"GC=F"/);
  assert.match(app,/SILVER:"SI=F"/);
  assert.match(app,/equityBundle/);
  assert.match(app,/futureBundle/);
});

test('Deno deployment config is dynamic and root-based',()=>{
  assert.equal(deno.deploy.runtime.type,'dynamic');
  assert.equal(deno.deploy.runtime.entrypoint,'./main.ts');
});

test('Quant routes all symbols through Deno backend first',()=>{
  assert.match(data,/async function backendMarket/);
  assert.match(data,/try\{core=await backendMarket\(s,timeframe,signal\);\}/);
  assert.match(data,/Deno on-demand API/);
  assert.match(data,/\/v1\/market/);
  assert.ok(!fs.existsSync('backend/hf-space/app.py'));
});
