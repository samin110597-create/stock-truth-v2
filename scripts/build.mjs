import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const commit=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const root=process.cwd(),out=path.join(root,'dist');fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
// Production ships one executable intelligence surface: Q-State Unified.
for(const dir of ['config','quant','v3'])fs.cpSync(dir,path.join(out,dir),{recursive:true});
fs.mkdirSync(path.join(out,'web'),{recursive:true});fs.copyFileSync('web/index.html',path.join(out,'web/index.html'));
const qApiBase=String(process.env.QSTATE_API_BASE||'https://stock-truth-v2.samin110597.deno.net').trim().replace(/\/$/,'');
fs.writeFileSync(path.join(out,'quant/runtime-config.json'),JSON.stringify({apiBase:qApiBase,mode:qApiBase?'on-demand-secure-api':'snapshot-fallback',generatedAt:new Date().toISOString()}));
if(!fs.existsSync('data/calendar.json'))throw new Error('Generate exchange calendar before building');
fs.mkdirSync(path.join(out,'data'),{recursive:true});fs.copyFileSync('data/calendar.json',path.join(out,'data/calendar.json'));
for(const name of ['raw','fundamentals','analysis','quant','index.json','ledger.json','collection.json'])if(fs.existsSync('data/'+name))fs.cpSync('data/'+name,path.join(out,'data',name),{recursive:true});
fs.mkdirSync(path.join(out,'vendor'));fs.copyFileSync('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs',path.join(out,'vendor/lightweight-charts.mjs'));
fs.mkdirSync(path.join(out,'licenses'));for(const name of ['LICENSE','NOTICE'])if(fs.existsSync('node_modules/lightweight-charts/'+name))fs.copyFileSync('node_modules/lightweight-charts/'+name,path.join(out,'licenses',name));
fs.copyFileSync('documentation/licenses/NOTICE',path.join(out,'licenses/NOTICE'));
fs.writeFileSync(path.join(out,'.nojekyll'),'');
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><script>location.replace("./quant/"+location.search+location.hash)</script><title>Q-State Unified</title></head><body><a href="./quant/">Open Q-State Unified</a></body></html>');
// Version the complete Q-State local module graph so a new document cannot reuse an old engine.
function versionModules(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())versionModules(file);else if(file.endsWith('.mjs')){const source=fs.readFileSync(file,'utf8').replace(/(["'])(\.\.?\/[^"'\s?]+\.mjs)\1/g,(_,quote,url)=>quote+url+'?release='+commit+quote).replaceAll("'../build.json'","'../build.json?release="+commit+"'");fs.writeFileSync(file,source);}}}
versionModules(path.join(out,'quant'));
const quantHtmlFile=path.join(out,'quant/index.html');fs.writeFileSync(quantHtmlFile,fs.readFileSync(quantHtmlFile,'utf8').replace(/(src|href)="(\.\/(?:app\.mjs|style\.css))"/g,(_,attribute,url)=>attribute+'="'+url+'?release='+commit+'"'));
const qModel=JSON.parse(fs.readFileSync('data/quant/model.json','utf8'));
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({model_version:qModel.model_version,canonical_model:qModel.canonical_model===true,commit,built_at:new Date().toISOString(),quant_data_mode:qApiBase?'on-demand-secure-api':'snapshot-fallback',quant_api_configured:!!qApiBase,production_modules:['quant/src/data.mjs','quant/src/model.mjs','quant/src/engine.mjs','quant/app.mjs'],legacy_web_deployed:false}));
console.log('Built GitHub Pages static artifact with canonical model '+qModel.model_version);
