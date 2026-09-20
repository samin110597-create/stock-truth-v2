import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {MODEL_VERSION} from '../src/setups.mjs';
const commit=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const root=process.cwd(),out=path.join(root,'dist');fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const dir of ['web','src','config'])fs.cpSync(dir,path.join(out,dir),{recursive:true});
if(!fs.existsSync('data/calendar.json'))throw new Error('Generate exchange calendar before building');
fs.mkdirSync(path.join(out,'data'),{recursive:true});fs.copyFileSync('data/calendar.json',path.join(out,'data/calendar.json'));
for(const name of ['raw','analysis','quant','index.json','ledger.json','collection.json'])if(fs.existsSync('data/'+name))fs.cpSync('data/'+name,path.join(out,'data',name),{recursive:true});
fs.mkdirSync(path.join(out,'vendor'));fs.copyFileSync('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs',path.join(out,'vendor/lightweight-charts.mjs'));
fs.mkdirSync(path.join(out,'licenses'));for(const name of ['LICENSE','NOTICE'])if(fs.existsSync('node_modules/lightweight-charts/'+name))fs.copyFileSync('node_modules/lightweight-charts/'+name,path.join(out,'licenses',name));
fs.copyFileSync('documentation/licenses/NOTICE',path.join(out,'licenses/NOTICE'));
fs.writeFileSync(path.join(out,'.nojekyll'),'');
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><script>location.replace("./web/"+location.search+location.hash)</script><title>Stock Truth</title></head><body><a href="./web/">Open Stock Truth research terminal</a></body></html>');
// Version the complete local module graph, including Worker and nested imports.
// A newly deployed HTML document must never reuse an older calculation engine.
function versionModules(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,item.name);if(item.isDirectory())versionModules(file);
  else if(file.endsWith('.mjs')){
    const source=fs.readFileSync(file,'utf8').replace(/(["'])(\.\.?\/[^"'\s?]+\.mjs)\1/g,(_,quote,url)=>quote+url+'?release='+commit+quote)
      .replaceAll("'../build.json'","'../build.json?release="+commit+"'")
      .replaceAll("'../config/watchlist.json'","'../config/watchlist.json?release="+commit+"'");
    fs.writeFileSync(file,source);
  }
}}
for(const dir of ['web','src'])versionModules(path.join(out,dir));
for(const rel of ['web/index.html','web/quant/index.html']){const htmlFile=path.join(out,rel);if(fs.existsSync(htmlFile))fs.writeFileSync(htmlFile,fs.readFileSync(htmlFile,'utf8').replace(/(src|href)="(\.\/(?:app\.mjs|style\.css))"/g,(_,attribute,url)=>attribute+'="'+url+'?release='+commit+'"'));}
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({model_version:MODEL_VERSION,commit,built_at:new Date().toISOString(),production_modules:JSON.parse(fs.readFileSync('config/model.json')).production}));
console.log('Built GitHub Pages static artifact with model '+MODEL_VERSION);
