import {finite,mean} from './numeric.mjs';
import {anchoredVwap} from './technicals.mjs';
export function reversals(b,tech,st){
  const out=[];
  for(let i=0;i<b.length;i++){
    const x=b[i],a=tech.series.atr[i],s=st.states[i],rv=tech.series.rvol[i];
    const evidence=[];const span=x.high-x.low,lower=span?(Math.min(x.open,x.close)-x.low)/span:0,upper=span?(x.high-Math.max(x.open,x.close))/span:0;
    const recent=s.recentEvents,validSweep=e=>e.type==='LIQUIDITY SWEEP'&&b.slice(e.i+1,i+1).every(z=>e.dir>0?z.low>e.extreme:z.high<e.extreme),upSweep=recent.filter(e=>e.dir>0&&validSweep(e)).at(-1),downSweep=recent.filter(e=>e.dir<0&&validSweep(e)).at(-1);
    const proxies={absorption:null,distribution:null,capitulation:null,buying_climax:null};
    if(finite(a)&&a>0&&finite(rv)){
      const prior=b.slice(Math.max(0,i-20),i),priorLow=prior.length?Math.min(...prior.map(z=>z.low)):null,priorHigh=prior.length?Math.max(...prior.map(z=>z.high)):null;
      proxies.absorption=rv>=1.5&&lower>=.45&&x.close>(x.high+x.low)/2&&finite(priorLow)&&x.low<=priorLow+.35*a;
      proxies.distribution=rv>=1.5&&upper>=.45&&x.close<(x.high+x.low)/2&&finite(priorHigh)&&x.high>=priorHigh-.35*a;
      proxies.capitulation=i>=10&&rv>=2.5&&span>=1.5*a&&x.low<priorLow&&lower>=.35&&x.close<b[i-10].close;
      proxies.buying_climax=i>=10&&rv>=2.5&&span>=1.5*a&&x.high>priorHigh&&upper>=.35&&x.close>b[i-10].close;
      for(const [key,value] of Object.entries(proxies))if(value)evidence.push({family:'participation',dir:['absorption','capitulation'].includes(key)?1:-1,name:key+' proxy',detail:`RVOL ${rv.toFixed(2)}; rejection wick; position at prior range extreme.`,classification:'PROXY'});
    }
    for(const dir of [1,-1]){
      const ps=s.knownPivots.filter(p=>p.type===(dir>0?'L':'H'));
      const p=ps.at(-1),q=ps.at(-2);
      if(p&&q&&i-p.confirmed_at<=10&&finite(a)&&dir*(p.price-q.price)<-.1*a){
        for(const [name,series,band] of [['RSI',tech.series.rsi,3],['MACD',tech.series.macd,.05*a]])
          if(finite(series[p.i])&&finite(series[q.i])&&dir*(series[p.i]-series[q.i])>band)evidence.push({family:'momentum',dir,name:name+' divergence',classification:'PROXY',detected_at:p.confirmed_at,detail:'Price made a new pivot extreme while momentum weakened; both pivots are confirmed.'});
      }
      const sw=dir>0?upSweep:downSweep;
      if(sw)evidence.push({family:'structure',dir,name:'Swing failure / liquidity sweep',classification:'PROXY',detected_at:sw.i,detail:'Price crossed a previously confirmed swing, then closed back through its level.'});
      const change=recent.filter(e=>e.dir===dir&&['BOS','CHoCH'].includes(e.type)).at(-1);
      if(change)evidence.push({family:'structure',dir,name:change.type,classification:'CALCULATION',detected_at:change.i,detail:'Completed close beyond the confirmed structural level.'});
      if(finite(tech.series.rsi[i])&&i&&dir*(tech.series.rsi[i]-50)>0&&dir*(tech.series.rsi[i]-tech.series.rsi[i-1])>0)evidence.push({family:'momentum',dir,name:'Momentum recovery',classification:'CALCULATION'});
    }
    const sides=[1,-1].map(dir=>{
      const ev=evidence.filter(e=>e.dir===dir),sw=dir>0?upSweep:downSweep;
      const divergence=ev.some(e=>e.name.includes('divergence')),vol=ev.some(e=>e.family==='participation');
      const change=recent.some(e=>e.dir===dir&&['BOS','CHoCH'].includes(e.type)&&sw&&e.i>sw.i);
      const base=Boolean(sw||divergence||vol),families=new Set(ev.map(e=>e.family)).size;
      const stage=!base?'NO REVERSAL':sw&&change&&families>=2?'REVERSAL CONFIRMED':(sw&&divergence)||(base&&families>=2)?'REVERSAL DEVELOPING':'EARLY REVERSAL WATCH';
      return {dir,stage,families,evidence:ev,strict_reversal:Boolean(sw&&divergence&&change),sweep:sw||null};
    });
    const rank={'NO REVERSAL':0,'EARLY REVERSAL WATCH':1,'REVERSAL DEVELOPING':2,'REVERSAL CONFIRMED':3};
    sides.sort((a,z)=>rank[z.stage]-rank[a.stage]||z.families-a.families);
    const selected=sides[0],conflict=rank[sides[0].stage]>0&&rank[sides[0].stage]===rank[sides[1].stage];
    out.push({classification:'PROXY',...selected,stage:conflict?'CONFLICTING REVERSAL EVIDENCE':selected.stage,dir:conflict||selected.stage==='NO REVERSAL'?0:selected.dir,proxies,sides});
  }
  const last=out.at(-1),s=st.current;
  if(last&&s){const anchor=(last.dir>0?s.lastLow:s.lastHigh)?.i;if(Number.isInteger(anchor)){const vwap=anchoredVwap(b,anchor);last.avwap={value:vwap.at(-1),anchor_ts:b[anchor].ts,classification:'PROXY',method:'Typical-price OHLCV-weighted anchored average; not transaction VWAP.'};}}
  const events=out.flatMap((r,i)=>r.dir&&r.stage!=='NO REVERSAL'&&(i===0||r.stage!==out[i-1].stage||r.dir!==out[i-1].dir)?[{i,ts:b[i].ts,confirmed_ts:b[i].end_ts,dir:r.dir,stage:r.stage,evidence:r.evidence,classification:'PROXY'}]:[]);
  return {states:out,current:last||null,events};
}
