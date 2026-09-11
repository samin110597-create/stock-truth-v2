import {finite,divide,mean,sum,rolling,ema,rma,sign,last,quantile} from './numeric.mjs';
export function rsi(c,n=14){
  const delta=c.map((x,i)=>i?x-c[i-1]:null),g=rma(delta.map(x=>finite(x)?Math.max(x,0):null),n),l=rma(delta.map(x=>finite(x)?Math.max(-x,0):null),n);
  return c.map((_,i)=>!finite(g[i])||!finite(l[i])?null:g[i]===0&&l[i]===0?50:l[i]===0?100:100-100/(1+g[i]/l[i]));
}
export function atr(b,n=14){
  return rma(b.map((x,i)=>i?Math.max(x.high-x.low,Math.abs(x.high-b[i-1].close),Math.abs(x.low-b[i-1].close)):null),n);
}
export function anchoredVwap(b,anchor){
  let pv=0,vol=0,missing=false;
  return b.map((x,i)=>{
    if(i<anchor)return null;
    if(!finite(x.volume))missing=true;
    if(missing)return null;
    pv+=(x.high+x.low+x.close)/3*x.volume;vol+=x.volume;return divide(pv,vol);
  });
}
export function technicals(b,timeframe='1D'){
  const c=b.map(x=>x.close),h=b.map(x=>x.high),l=b.map(x=>x.low),v=b.map(x=>x.volume),tp=b.map(x=>(x.high+x.low+x.close)/3),n=b.length;
  const a=atr(b),rs=rsi(c),E=Object.fromEntries([9,20,50,100,150,200].map(p=>[p,ema(c,p)])),S=Object.fromEntries([50,200].map(p=>[p,rolling(c,p)]));
  const e12=ema(c,12),e26=ema(c,26),macd=c.map((_,i)=>finite(e12[i])&&finite(e26[i])?e12[i]-e26[i]:null),signal=ema(macd,9),hist=macd.map((x,i)=>finite(x)&&finite(signal[i])?x-signal[i]:null);
  const tr=b.map((x,i)=>i?Math.max(x.high-x.low,Math.abs(x.high-c[i-1]),Math.abs(x.low-c[i-1])):null);
  const plus=rma(b.map((x,i)=>{if(!i)return null;const up=x.high-h[i-1],dn=l[i-1]-x.low;return up>dn&&up>0?up:0;}),14);
  const minus=rma(b.map((x,i)=>{if(!i)return null;const up=x.high-h[i-1],dn=l[i-1]-x.low;return dn>up&&dn>0?dn:0;}),14);
  const smtr=rma(tr,14),pdi=plus.map((x,i)=>smtr[i]===0?0:finite(divide(x,smtr[i]))?100*x/smtr[i]:null),mdi=minus.map((x,i)=>smtr[i]===0?0:finite(divide(x,smtr[i]))?100*x/smtr[i]:null);
  const dx=pdi.map((x,i)=>!finite(x)||!finite(mdi[i])?null:x+mdi[i]===0?0:100*Math.abs(x-mdi[i])/(x+mdi[i])),adx=rma(dx,14);
  const hh=rolling(h,14,x=>Math.max(...x)),ll=rolling(l,14,x=>Math.min(...x));
  const stoch=c.map((x,i)=>finite(hh[i])?hh[i]===ll[i]?50:100*(x-ll[i])/(hh[i]-ll[i]):null);
  const williams=stoch.map(x=>finite(x)?x-100:null);
  const cci=rolling(tp,20,x=>{const m=mean(x),dev=mean(x.map(z=>Math.abs(z-m)));return dev===0?0:(x.at(-1)-m)/(.015*dev);});
  const roc=c.map((x,i)=>i>=10?100*(x/c[i-10]-1):null);
  const logret=c.map((x,i)=>i?Math.log(x/c[i-1]):null),rv=rolling(logret,20,x=>{if(!x.every(finite))return null;const m=mean(x);return Math.sqrt(x.reduce((s,z)=>s+(z-m)**2,0)/(x.length-1));});
  const bbMid=rolling(c,20),bbStd=rolling(c,20,x=>{const m=mean(x);return Math.sqrt(mean(x.map(z=>(z-m)**2)));});
  const bbUpper=c.map((_,i)=>finite(bbMid[i])?bbMid[i]+2*bbStd[i]:null),bbLower=c.map((_,i)=>finite(bbMid[i])?bbMid[i]-2*bbStd[i]:null),bbWidth=c.map((_,i)=>finite(bbMid[i])?4*bbStd[i]/bbMid[i]:null);
  const vol20=v.map((_,i)=>i>=20?mean(v.slice(i-20,i)):null),rvol=v.map((x,i)=>divide(x,vol20[i]));
  let ob=0,volMissing=false;
  const obv=b.map((x,i)=>{if(!finite(x.volume))volMissing=true;if(volMissing)return null;if(i)ob+=Math.sign(c[i]-c[i-1])*x.volume;return ob;});
  const flow=tp.map((x,i)=>finite(v[i])?x*v[i]:null),pos=flow.map((x,i)=>i&&finite(x)?tp[i]>tp[i-1]?x:0:null),neg=flow.map((x,i)=>i&&finite(x)?tp[i]<tp[i-1]?x:0:null);
  const ps=rolling(pos,14,sum),ns=rolling(neg,14,sum),mfi=ps.map((x,i)=>!finite(x)||!finite(ns[i])?null:x===0&&ns[i]===0?50:ns[i]===0?100:100-100/(1+x/ns[i]));
  const mf=b.map(x=>!finite(x.volume)?null:x.high===x.low?0:((2*x.close-x.high-x.low)/(x.high-x.low))*x.volume),mfs=rolling(mf,20,sum),vs=rolling(v,20,sum),cmf=mfs.map((x,i)=>divide(x,vs[i]));
  const donHigh=h.map((_,i)=>i>=20?Math.max(...h.slice(i-20,i)):null),donLow=l.map((_,i)=>i>=20?Math.min(...l.slice(i-20,i)):null);
  const mid=p=>c.map((_,i)=>i>=p-1?(Math.max(...h.slice(i-p+1,i+1))+Math.min(...l.slice(i-p+1,i+1)))/2:null);
  const tenkan=mid(9),kijun=mid(26),senkouB=mid(52),cloudA=c.map((_,i)=>i>=26&&finite(tenkan[i-26])&&finite(kijun[i-26])?(tenkan[i-26]+kijun[i-26])/2:null),cloudB=c.map((_,i)=>i>=26?senkouB[i-26]:null);
  const sa=atr(b,10);let upper=null,lower=null,direction=1;
  const supertrend=b.map((x,i)=>{if(!finite(sa[i]))return null;const u=(x.high+x.low)/2+3*sa[i],d=(x.high+x.low)/2-3*sa[i];
    const pu=upper,pl=lower;upper=pu===null||u<pu||c[i-1]>pu?u:pu;lower=pl===null||d>pl||c[i-1]<pl?d:pl;
    if(pu!==null&&direction<0&&x.close>pu)direction=1;else if(pl!==null&&direction>0&&x.close<pl)direction=-1;
    return direction>0?lower:upper;});
  let session=null,pv=0,vv=0,missing=false;
  const intraday=['5M','15M','30M','1H','4H'].includes(timeframe);
  const vwap=b.map(x=>{if(!intraday)return null;if(x.session!==session){session=x.session;pv=0;vv=0;missing=false;}if(!finite(x.volume))missing=true;if(missing)return null;pv+=(x.high+x.low+x.close)/3*x.volume;vv+=x.volume;return divide(pv,vv);});
  const slotFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false});
  let sameSlot=null,sameSlotN=0;
  if(intraday&&b.length){const z=b.at(-1),slot=slotFmt.format(new Date(z.ts*1000)),prior=b.slice(0,-1).filter(x=>x.session!==z.session&&slotFmt.format(new Date(x.ts*1000))===slot&&finite(x.volume)).slice(-20);sameSlotN=prior.length;if(prior.length>=10)sameSlot=divide(z.volume,mean(prior.map(x=>x.volume)));}
  const i=n-1,snapshot={};
  for(const [key,series] of Object.entries({rsi:rs,atr:a,atr_pct:a.map((x,j)=>finite(x)?100*x/c[j]:null),macd,macd_signal:signal,macd_hist:hist,roc,stochastic:stoch,stochastic_d:rolling(stoch,3),williams,cci,adx,plus_di:pdi,minus_di:mdi,realized_volatility:rv,bb_mid:bbMid,bb_upper:bbUpper,bb_lower:bbLower,bb_width:bbWidth,rvol,volume_average20:vol20,obv,mfi,cmf,donchian_high:donHigh,donchian_low:donLow,supertrend,tenkan,kijun,cloud_a:cloudA,cloud_b:cloudB,vwap}))snapshot[key]=last(series);
  snapshot.ema=Object.fromEntries(Object.entries(E).map(([p,z])=>[p,last(z)]));snapshot.sma=Object.fromEntries(Object.entries(S).map(([p,z])=>[p,last(z)]));
  snapshot.ema_slopes=Object.fromEntries(Object.entries(E).map(([p,z])=>[p,i>=5&&finite(z[i])&&finite(z[i-5])?(z[i]-z[i-5])/5:null]));
  snapshot.sma_slopes=Object.fromEntries(Object.entries(S).map(([p,z])=>[p,i>=5&&finite(z[i])&&finite(z[i-5])?(z[i]-z[i-5])/5:null]));
  snapshot.price_vs_ema=Object.fromEntries(Object.entries(snapshot.ema).map(([p,x])=>[p,finite(x)?sign(c[i]-x):null]));
  snapshot.same_slot_rvol=sameSlot;snapshot.same_slot_samples=sameSlotN;
  snapshot.golden_death_context=finite(last(S[200]))?(last(S[50])>last(S[200])?'SMA50 ABOVE SMA200':'SMA50 BELOW SMA200'):'INSUFFICIENT DATA';
  snapshot.cross_event=i>0&&[S[50][i],S[200][i],S[50][i-1],S[200][i-1]].every(finite)&&Math.sign(S[50][i]-S[200][i])!==Math.sign(S[50][i-1]-S[200][i-1])?(S[50][i]>S[200][i]?'GOLDEN CROSS':'DEATH CROSS'):null;
  const widths=bbWidth.slice(-101,-1).filter(finite);snapshot.volatility_regime=widths.length<60?'INSUFFICIENT DATA':snapshot.bb_width>=quantile(widths,.8)?'EXPANSION':snapshot.bb_width<=quantile(widths,.2)?'CONTRACTION':'NORMAL';
  snapshot.volume_state=!finite(snapshot.rvol)?'UNAVAILABLE':snapshot.rvol>=1.5?'EXPANSION':snapshot.rvol<=.7?'CONTRACTION':'NORMAL';
  const trendAt=(p,q)=>finite(E[p][i])&&finite(E[q][i])?sign(c[i]-E[p][i],(a[i]||0)*.1)+sign(E[p][i]-E[q][i],(a[i]||0)*.1):null;
  const label=x=>x===null?'INSUFFICIENT DATA':x>=1?'BULLISH':x<=-1?'BEARISH':'MIXED';
  snapshot.short_trend=label(trendAt(9,20));snapshot.intermediate_trend=label(trendAt(20,50));snapshot.long_trend=label(trendAt(50,200));
  snapshot.classification='CALCULATION';snapshot.vwap_classification='PROXY';snapshot.realized_volatility_note='20-bar standard deviation of log returns; not annualized.';
  return {snapshot,series:{close:c,atr:a,rsi:rs,ema:E,sma:S,macd,hist,adx,rvol,cmf,obv,bbWidth,vwap},bars:n};
}
