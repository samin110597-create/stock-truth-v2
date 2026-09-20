import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const files=[];function visit(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())visit(p);else files.push(p);}}
for(const d of ['src','scripts','web'])visit(d);
for(const file of files.filter(f=>f.endsWith('.mjs')))execFileSync(process.execPath,['--check',file]);
for(const file of files){const s=fs.readFileSync(file,'utf8');if(/vercel\.app|raw\.githubusercontent\.com.*eval|\beval\s*\(|new Function\s*\(/.test(s))throw Error('Forbidden runtime code/host in '+file);}
const html=fs.readFileSync('dist/web/index.html','utf8');if(!/analyze any ticker/i.test(html))throw Error('Arbitrary ticker UI missing');
for(const file of ['dist/web/app.mjs','dist/web/worker.mjs','dist/web/quant/index.html','dist/web/quant/app.mjs','dist/web/quant/style.css','dist/src/quant/math.mjs','dist/src/quant/engine.mjs','dist/src/quant/providers.mjs','dist/vendor/lightweight-charts.mjs','dist/data/calendar.json','dist/licenses/LICENSE','dist/licenses/NOTICE','dist/build.json'])if(!fs.existsSync(file))throw Error('Missing deploy file '+file);
console.log('Production syntax, host isolation and static artifact checks passed.');

const release=JSON.parse(fs.readFileSync('dist/build.json')).commit;
if(!html.includes('app.mjs?release='+release)||!html.includes('style.css?release='+release))throw Error('Unversioned entry asset');
const quantHtml=fs.readFileSync('dist/web/quant/index.html','utf8');if(!quantHtml.includes('app.mjs?release='+release)||!quantHtml.includes('style.css?release='+release))throw Error('Unversioned Quant Lab entry asset');
for(const file of files.filter(f=>f.endsWith('.mjs')&&(f.startsWith('web/')||f.startsWith('src/')))){
  const built=fs.readFileSync('dist/'+file,'utf8');
  if(/(["'])(\.\.?\/[^"'\s?]+\.mjs)\1/.test(built))throw Error('Unversioned local module in '+file);
}
console.log('Release identity is pinned across HTML, CSS, Worker, and nested module imports.');
