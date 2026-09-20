import fs from 'node:fs';import path from 'node:path';
import {analyze} from '../src/analysis.mjs';import {setupIdentity} from '../src/setups.mjs';import {resolveSetup} from '../src/validation.mjs';
const dir=process.env.DATA_DIR||'data';fs.mkdirSync(path.join(dir,'analysis'),{recursive:true});
const files=fs.readdirSync(path.join(dir,'raw')).filter(x=>x.endsWith('.json')),raws=Object.fromEntries(files.map(f=>{const r=JSON.parse(fs.readFileSync(path.join(dir,'raw',f)));return [r.symbol,r];}));
let ledger=[];try{ledger=JSON.parse(fs.readFileSync(path.join(dir,'ledger.json'))).records||[];}catch{}
const symbols=[],reports=[];
for(const [symbol,raw] of Object.entries(raws)){
  try{const f=JSON.parse(fs.readFileSync(path.join(dir,'fundamentals',symbol+'.json')));if(f.symbol===symbol)raw.fundamentals=f;}catch{}
  const a=analyze(raw,{benchmarks:raws}),s=a.setups.Adaptive_SWING?.setup;
  const issues=[];
  function walk(x,p='root'){if(typeof x==='number'&&!Number.isFinite(x))issues.push(p+' is non-finite');else if(x&&typeof x==='object')for(const [k,v]of Object.entries(x))walk(v,p+'.'+k);}
  walk(a);
  for(const {setup:p} of Object.values(a.setups))if(p){
    const worst=p.dir>0?p.entry_zone.high:p.entry_zone.low;
    if(p.dir*(worst-p.stop)<=0||p.entry_zone.low>p.entry_zone.high||p.targets.some(t=>p.dir*(t.price-worst)<=0))issues.push('Invalid stop/target orientation');
    if(a.health.tradeable&&!p.live_check?.stop_tested&&!p.live_check?.target_tested){const id=setupIdentity(p);if(!ledger.some(x=>x.id===id))ledger.push({id,issued_at:new Date().toISOString(),data_sha256:raw.content_sha256||null,setup:structuredClone(p),events:[]});}
  }
  for(const record of ledger.filter(x=>x.setup.symbol===symbol)){
    const b=a.frames['1D'].bars,i=b.findIndex(b=>b.end_ts===record.setup.signal_ts);if(i<0)continue;
    const latest=resolveSetup(b,record.setup,i),fingerprint=JSON.stringify(latest);
    if(!record.events.some(x=>x.fingerprint===fingerprint))record.events.push({observed_at:new Date().toISOString(),result:latest,fingerprint});
  }
  if(issues.length)throw new Error(symbol+': '+issues.join('; '));
  fs.writeFileSync(path.join(dir,'analysis',symbol+'.json'),JSON.stringify(a));
  symbols.push({symbol,name:a.name,direction:s?.direction||null,action:s?.current_action||a.thesis.best_action,grade:s?.grade||null,score:s?.score||null,entry:s?.entry_zone||null,stop:s?.stop||null,tp1:s?.targets[0]?.price||null,health:a.health.status,source:a.frames['1D'].provenance?.provider,last_bar:a.frames['1D'].bars.at(-1)?.date});
  reports.push({symbol,daily_bars:a.frames['1D'].bars.length,timeframes:Object.fromEntries(Object.entries(a.frames).map(([k,v])=>[k,v.bars.length])),strict_n:a.validation.Strict_SWING?.n||0,adaptive_n:a.validation.Adaptive_SWING?.n||0,adaptive_metrics:a.validation.Adaptive_SWING?.metrics,status:a.validation.Adaptive_SWING?.status,issues});
  console.log(symbol+' analyzed; '+a.frames['1D'].bars.length+' daily bars; '+(a.validation.Adaptive_SWING?.n||0)+' non-overlapping Adaptive samples');
}
fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({generated_at:new Date().toISOString(),symbols}));
fs.writeFileSync(path.join(dir,'ledger.json'),JSON.stringify({schema_version:5,policy:'Append-only issued plans; resolution observations append without modifying the plan.',records:ledger}));
fs.writeFileSync(path.join(dir,'validation-report.json'),JSON.stringify({generated_at:new Date().toISOString(),method:'Retrospective causal replay; no verified OOS probability claims.',tickers:reports},null,2));
