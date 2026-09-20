import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const files=[];function visit(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())visit(p);else files.push(p);}}
for(const d of ['src','scripts','web','quant'])visit(d);
for(const file of files.filter(f=>f.endsWith('.mjs')))execFileSync(process.execPath,['--check',file]);
for(const file of files){const s=fs.readFileSync(file,'utf8');if(/vercel\.app|raw\.githubusercontent\.com.*eval|\beval\s*\(|new Function\s*\(/.test(s))throw Error('Forbidden runtime code/host in '+file);}
const html=fs.readFileSync('dist/web/index.html','utf8');if(!/analyze any ticker/i.test(html))throw Error('Classic arbitrary ticker UI missing');
const required=['dist/web/app.mjs','dist/web/worker.mjs','dist/quant/index.html','dist/quant/app.mjs','dist/quant/style.css','dist/quant/src/math.mjs','dist/quant/src/data.mjs','dist/quant/src/engine.mjs','dist/vendor/lightweight-charts.mjs','dist/data/calendar.json','dist/licenses/LICENSE','dist/licenses/NOTICE','dist/build.json'];
for(const file of required)if(!fs.existsSync(file))throw Error('Missing deploy file '+file);
if(fs.existsSync('dist/web/quant'))throw Error('Legacy reused web/quant implementation must not ship');
if(fs.existsSync('dist/src/quant'))throw Error('Legacy shared src/quant implementation must not ship');
console.log('Production syntax, host isolation and standalone artifact checks passed.');
const release=JSON.parse(fs.readFileSync('dist/build.json')).commit;
if(!html.includes('app.mjs?release='+release)||!html.includes('style.css?release='+release))throw Error('Unversioned classic entry asset');
const quantHtml=fs.readFileSync('dist/quant/index.html','utf8');if(!quantHtml.includes('app.mjs?release='+release)||!quantHtml.includes('style.css?release='+release))throw Error('Unversioned standalone quant entry asset');
for(const file of files.filter(f=>f.endsWith('.mjs')&&(f.startsWith('web/')||f.startsWith('src/')||f.startsWith('quant/')))){
  const built=fs.readFileSync('dist/'+file,'utf8');if(/(["'])(\.\.?\/[^"'\s?]+\.mjs)\1/.test(built))throw Error('Unversioned local module in '+file);
}
const classicSource=fs.readFileSync('web/index.html','utf8');if(/quant\//i.test(classicSource))throw Error('Classic HTML must not be modified to depend on or link the standalone quant page');
const quantBundle=fs.readFileSync('dist/quant/index.html','utf8')+fs.readFileSync('dist/quant/app.mjs','utf8')+fs.readFileSync('dist/quant/src/data.mjs','utf8')+fs.readFileSync('dist/quant/src/engine.mjs','utf8');
if(/localStorage|k-massive|k-fmp|k-finnhub|k-alpha|k-fred|apiKey=/.test(quantBundle))throw Error('Standalone quant must not contain browser-stored API credentials or API-key query construction');
if(/\.\.\/src\/(analysis|providers|technicals|structure|reversal|setups)\.mjs/.test(quantBundle))throw Error('Standalone quant must not import classic analysis/provider modules');
console.log('Standalone Quant isolation, release identity and secret handling checks passed.');
