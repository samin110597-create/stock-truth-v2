// GitHub Actions only. Secrets are sent directly to Cloudflare, never to the Pages build.
import fs from 'node:fs';
const env=process.env,account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
const summary=message=>{console.log(message);if(env.GITHUB_STEP_SUMMARY)fs.appendFileSync(env.GITHUB_STEP_SUMMARY,message+'\n');};
const output=base=>{if(env.GITHUB_ENV)fs.appendFileSync(env.GITHUB_ENV,'QSTATE_API_BASE='+base+'\n');};
output('');
if(!account||!token){summary('Cloudflare gateway NOT ACTIVATED. Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to repository Actions secrets, then run this workflow. Pages uses independent browser data meanwhile.');process.exit(0);}
if(!/^[a-f0-9]{32}$/i.test(account))throw Error('Invalid Cloudflare account ID');
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers',name='stock-truth-data';
async function api(path,method='GET',body){const r=await fetch(root+path,{method,headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const j=await r.json();if(!r.ok||!j.success)throw Error('Cloudflare deployment request failed: HTTP '+r.status+'; codes '+(j.errors||[]).map(e=>e.code).join(','));return j.result;}
try{
  // Existing workers.dev subdomain is required; do not accept account terms or buy resources.
  const sub=await api('/subdomain');if(!sub.subdomain)throw Error('Enable the free workers.dev subdomain in Cloudflare first');
  const bindings=['FINNHUB_KEY','FMP_KEY','MASSIVE_KEY'].filter(k=>env[k]).map(name=>({name,type:'secret_text',text:env[name]}));
  const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-09-01',bindings}));form.set('worker.mjs',new Blob([fs.readFileSync('gateway/worker.mjs')],{type:'application/javascript+module'}),'worker.mjs');
  await api('/scripts/'+name,'PUT',form);await api('/scripts/'+name+'/subdomain','POST',{enabled:true,previews_enabled:false});
  const base='https://'+name+'.'+sub.subdomain+'.workers.dev';
  const r=await fetch(base+'/health',{signal:AbortSignal.timeout(15000)});if(!r.ok||(await r.json()).status!=='OK')throw Error('Gateway health check failed');
  output(base);summary('Cloudflare gateway deployed and health verified: '+base+'. Pages remains on GitHub.');
}catch(e){summary('Gateway activation failed: '+e.message+'. Pages will continue using independent browser fallbacks.');process.exitCode=1;}
