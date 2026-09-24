import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('backend/hf-space/app.py','utf8');
const data=fs.readFileSync('quant/src/data.mjs','utf8');

test('Hugging Face backend exposes health and arbitrary-symbol market routes',()=>{
  assert.match(app,/@app\.get\("\/health"\)/);
  assert.match(app,/@app\.get\("\/v1\/market"\)/);
  assert.match(app,/MASSIVE_KEY/);
  assert.match(app,/FMP_API_KEY/);
  assert.match(app,/FINNHUB_API_KEY/);
  assert.match(app,/ALPHA_VANTAGE_KEY/);
  assert.match(app,/Yahoo server fallback/);
});

test('Hugging Face backend supports stock ETFs and metal aliases',()=>{
  assert.match(app,/"GOLD":"GC=F"/);
  assert.match(app,/"SILVER":"SI=F"/);
  assert.match(app,/async def equity_bundle/);
  assert.match(app,/async def future_bundle/);
});

test('Quant routes all symbols through the request-time backend first',()=>{
  assert.match(data,/async function backendMarket/);
  assert.match(data,/try\{core=await backendMarket\(s,timeframe,signal\);\}/);
  assert.match(data,/Hugging Face on-demand API/);
  assert.ok(!fs.existsSync('backend/qstate-api/wrangler.jsonc'));
});
