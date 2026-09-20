import fs from 'node:fs';import path from 'node:path';
import {retrieveFundamentals} from '../src/fundamentals.mjs';
// Optional daily cache. Any ticker still calls the same public API directly.
const dir=process.env.DATA_DIR||'data',out=path.join(dir,'fundamentals');fs.mkdirSync(out,{recursive:true});
const args=process.argv.slice(2),symbols=args.length?args:JSON.parse(fs.readFileSync('config/watchlist.json')).symbols;
let next=0;
async function worker(){while(next<symbols.length){const symbol=symbols[next++],file=path.join(out,symbol+'.json');let cached=null;
  try{cached=JSON.parse(fs.readFileSync(file));}catch{}
  if(cached&&Date.now()-Date.parse(cached.fetched_at)<24*3600000){console.log(symbol+': financial cache younger than 24h');continue;}
  try{const result=await retrieveFundamentals(symbol,undefined,{snapshot:cached||{symbol},storage:null});
    fs.writeFileSync(file,JSON.stringify(result));console.log(symbol+': '+result.status+' · '+Object.keys(result.metrics||{}).length+' filing metrics'+(result.summary?' + sourced ratios':''));
  }catch(e){console.log(symbol+': financial supplement unavailable: '+e.message);}
}}
await Promise.all([worker(),worker()]);
