export const finite = x => typeof x === 'number' && Number.isFinite(x);
export const divide = (a,b) => finite(a) && finite(b) && b !== 0 ? a/b : null;
export const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
export const mean = a => a.length && a.every(finite) ? a.reduce((s,x)=>s+x,0)/a.length : null;
export const sum = a => a.length && a.every(finite) ? a.reduce((s,x)=>s+x,0) : null;
export function quantile(a,p) {
  const z=a.filter(finite).sort((x,y)=>x-y); if(!z.length)return null;
  const i=(z.length-1)*p, j=Math.floor(i); return z[j]+(z[Math.ceil(i)]-z[j])*(i-j);
}
export function wilson(k,n,z=1.96) {
  if(!n)return {low:null,high:null};
  const p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;
  return {low:c-m,high:c+m};
}
export const sign = (x,band=0) => !finite(x)?0:x>band?1:x < -band?-1:0;
export const last = a => a?.at(-1) ?? null;
export function rolling(v,n,fn=mean) { return v.map((_,i)=>i<n-1?null:fn(v.slice(i-n+1,i+1))); }
export function smooth(v,n,alpha=2/(n+1)) {
  let previous=null,run=[];
  return v.map(x=>{
    if(!finite(x)){previous=null;run=[];return null;}
    if(!finite(previous)){run.push(x);if(run.length<n)return null;previous=mean(run);}
    else previous=alpha*x+(1-alpha)*previous;
    return previous;
  });
}
export const ema=(v,n)=>smooth(v,n);
export const rma=(v,n)=>smooth(v,n,1/n);
