import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const command=process.argv[2],store=path.resolve('.snapshot-store'),branch='data-snapshots';
const git=(args,cwd=process.cwd())=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
if(command==='restore'){
  fs.mkdirSync('data',{recursive:true});
  try{git(['fetch','origin',branch,'--depth=1']);git(['worktree','add','--detach',store,'FETCH_HEAD']);for(const name of ['raw','analysis','quant','index.json','ledger.json','collection.json','validation-report.json'])if(fs.existsSync(path.join(store,name)))fs.cpSync(path.join(store,name),path.join('data',name),{recursive:true});console.log('Restored latest optional snapshots.');}
  catch{console.log('No snapshot branch available; direct browser ticker analysis does not require it.');}
}else if(command==='publish'){
  if(!fs.existsSync(path.join(store,'.git'))){
    git(['worktree','add','--detach',store,'HEAD']);git(['switch','--orphan',branch],store);
  }
  git(['config','user.name','stock-truth-data-bot'],store);git(['config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],store);
  for(const name of ['raw','analysis','quant','index.json','ledger.json','collection.json','validation-report.json'])if(fs.existsSync(path.join('data',name)))fs.cpSync(path.join('data',name),path.join(store,name),{recursive:true});
  git(['add','raw','analysis','quant','index.json','ledger.json','collection.json','validation-report.json'],store);
  if(git(['status','--porcelain'],store).trim()){git(['commit','-m','data: publish source-labelled snapshots and append setup observations'],store);git(['push','origin','HEAD:refs/heads/'+branch],store);console.log('Saved snapshots to '+branch);}
}else throw Error('Use restore or publish');
