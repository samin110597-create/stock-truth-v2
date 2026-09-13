import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {retrieveTicker} from '../src/providers.mjs';
// Optional scheduled enrichment. The application independently fetches any ticker.
const dir=process.env.DATA_DIR||'data',calendar=JSON.parse(fs.readFileSync(path.join(dir,'calendar.json')));
const files=fs.existsSync(path.join(dir,'raw'))?fs.readdirSync(path.join(dir,'raw')).filter(f=>f.endsWith('.json')):[];
let next=0,updated=0;
async function worker(){while(next<files.length){const file=files[next++],target=path.join(dir,'raw',file),cached=JSON.parse(fs.readFileSync(target));
  try{const result=await retrieveTicker(cached.symbol,calendar,undefined,{snapshot:cached});
    if(result.retrieval==='SCHEDULED SNAPSHOT FALLBACK'){console.log(cached.symbol+': direct daily supplement unavailable; existing sourced data retained');continue;}
    result.retrieval='SCHEDULED HTTP SUPPLEMENT';result.content_sha256=createHash('sha256').update(JSON.stringify(result)).digest('hex');
    fs.writeFileSync(target,JSON.stringify(result));updated++;console.log(cached.symbol+': '+result.timeframes['1D'].bars.length+' daily bars · '+result.timeframes['1D'].status);
  }catch(e){console.log(cached.symbol+': supplement unavailable: '+e.message);}
}}
await Promise.all([worker(),worker(),worker()]);console.log(`Refreshed ${updated}/${files.length} optional daily datasets. No arbitrary-ticker prerequisite.`);
