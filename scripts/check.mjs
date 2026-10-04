import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const files=[];function visit(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())visit(p);else files.push(p);}}
for(const d of ['src','scripts','web','quant'])visit(d);files.push('main.ts','deno.json');
for(const file of files.filter(f=>f.endsWith('.mjs')))execFileSync(process.execPath,['--check',file]);
for(const file of files){const s=fs.readFileSync(file,'utf8');if(/vercel\.app|raw\.githubusercontent\.com.*eval/.test(s))throw Error('Forbidden runtime host/code in '+file);if(/\.(?:m?js|ts|html)$/.test(file)&&/\beval\s*\(|new Function\s*\(/.test(s))throw Error('Forbidden dynamic JavaScript execution in '+file);}
const webRedirect=fs.readFileSync('dist/web/index.html','utf8');
if(!/Q-State Unified/i.test(webRedirect)||!/\.\.\/quant\//.test(webRedirect))throw Error('Legacy web compatibility entry must redirect to Q-State Unified');
const rootRedirect=fs.readFileSync('dist/index.html','utf8');if(!/\.\/quant\//.test(rootRedirect))throw Error('Repository root must open Q-State Unified');
const required=['dist/v3/index.html','dist/web/index.html','dist/quant/index.html','dist/quant/app.mjs','dist/quant/style.css','dist/quant/src/math.mjs','dist/quant/src/data.mjs','dist/quant/src/engine.mjs','dist/quant/src/model.mjs','dist/quant/src/accuracy.mjs','dist/quant/runtime-config.json','dist/data/quant/model.json','dist/vendor/lightweight-charts.mjs','dist/data/calendar.json','dist/licenses/LICENSE','dist/licenses/NOTICE','dist/build.json'];
for(const file of required)if(!fs.existsSync(file))throw Error('Missing deploy file '+file);
if(fs.existsSync('dist/web/app.mjs')||fs.existsSync('dist/web/worker.mjs')||fs.existsSync('dist/src'))throw Error('Legacy Stock Truth execution engine must not ship; Q-State Unified is the only deployed model');
if(fs.existsSync('dist/web/quant'))throw Error('Legacy reused web/quant implementation must not ship');
console.log('Production artifact contains only the Q-State Unified executable intelligence surface.');
const release=JSON.parse(fs.readFileSync('dist/build.json','utf8')).commit;
const quantHtml=fs.readFileSync('dist/quant/index.html','utf8');if(!quantHtml.includes('app.mjs?release='+release)||!quantHtml.includes('style.css?release='+release))throw Error('Unversioned Q-State entry asset');
for(const file of files.filter(f=>f.endsWith('.mjs')&&f.startsWith('quant/'))){const built=fs.readFileSync('dist/'+file,'utf8');if(/(["'])(\.\.?\/[^"'\s?]+\.mjs)\1/.test(built))throw Error('Unversioned local module in '+file);}
const quantBundle=fs.readFileSync('dist/quant/index.html','utf8')+fs.readFileSync('dist/quant/app.mjs','utf8')+fs.readFileSync('dist/quant/src/data.mjs','utf8')+fs.readFileSync('dist/quant/src/engine.mjs','utf8')+fs.readFileSync('dist/quant/src/model.mjs','utf8')+fs.readFileSync('dist/quant/src/accuracy.mjs','utf8');
if(/localStorage|k-massive|k-fmp|k-finnhub|k-alpha|k-fred|apiKey=/.test(quantBundle))throw Error('Q-State must not contain browser-stored API credentials or API-key query construction');
if(/\.\.\/src\/(analysis|providers|technicals|structure|reversal|setups)\.mjs/.test(quantBundle))throw Error('Q-State must not import legacy analysis/provider modules');
console.log('Q-State isolation, release identity and secret handling checks passed.');
const qModel=JSON.parse(fs.readFileSync('dist/data/quant/model.json','utf8'));
if(qModel.schema_version!==3||qModel.model_version!=='QSTATE-UNIFIED-3.0'||qModel.canonical_model!==true||!Array.isArray(qModel.features)||!qModel.timeframes)throw Error('Invalid Q-State Unified canonical model artifact');
for(const tf of ['15M','1H','4H','1D'])for(const h of ['5','10','20']){const m=qModel.timeframes?.[tf]?.[h];if(!m)throw Error('Missing Q-State Unified model block '+tf+' h'+h);if(m.validated&&(!(m.oos_samples>=500)||!(m.folds>=3)||!(m.metrics?.brier_skill>=0.005)||!(m.metrics?.positive_folds>=m.metrics?.required_positive_folds)||!(m.metrics?.median_fold_skill>0)||m.metrics?.untouched_holdout?.passed!==true||!(m.metrics?.untouched_holdout?.n>=120)))throw Error('Promoted Q-State Unified head does not satisfy walk-forward + untouched-holdout promotion metadata '+tf+' h'+h);}
console.log('Q-State Unified canonical artifact and promotion gates passed.');
const qRuntime=JSON.parse(fs.readFileSync('dist/quant/runtime-config.json','utf8'));if(typeof qRuntime.apiBase!=='string')throw Error('Invalid Q-State runtime API config');if(qRuntime.apiBase&&!/^https:\/\//.test(qRuntime.apiBase))throw Error('Q-State on-demand API must use HTTPS');
const buildMeta=JSON.parse(fs.readFileSync('dist/build.json','utf8'));if(Boolean(qRuntime.apiBase)!==Boolean(buildMeta.quant_api_configured))throw Error('Q-State runtime API config disagrees with build metadata');if(buildMeta.model_version!=='QSTATE-UNIFIED-3.0'||buildMeta.canonical_model!==true||buildMeta.legacy_web_deployed!==false)throw Error('Production build identity must expose Q-State Unified as the only deployed model');
console.log('Q-State on-demand API and one-model build identity passed.');

const legacyV3=fs.readFileSync('dist/v3/index.html','utf8');
if(!/Q-State Unified/i.test(legacyV3)||!/\.\.\/quant\//.test(legacyV3))throw Error('Legacy V3 compatibility entry must redirect to Q-State Unified');
if(/\/api\/stock|vercel\.app|eval\s*\(/i.test(legacyV3))throw Error('Legacy V3 compatibility entry must not contain serverless/Vercel runtime dependencies');
console.log('Legacy V3 compatibility route is GitHub-only and points to Q-State Unified.');
