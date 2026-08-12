(()=>{'use strict';
function patchDetails(){
  try{
    if(typeof T==='undefined'||!T?.precision||typeof ENG==='undefined')return;
    const b=T.precision.bars,c=b.map(x=>Number(x.close)),i=c.length-1;
    const stc=ENG.stoch(b),wr=ENG.williamsR(b),cci=ENG.cci(b),bb=ENG.bollinger(c),roc=ENG.roc(c),atrA=ENG.atr(b),mac=ENG.macd(c),ax=ENG.adx(b);
    T.stochK=stc.k[i];T.stochD=stc.d[i];T.wr=wr[i];T.cci=cci[i];T.roc=roc[i];
    T.bbU=bb.upper[i];T.bbL=bb.lower[i];T.bbMid=bb.mid[i];T.bbW=bb.bandwidth[i];T.pctB=bb.percentB[i];
    try{T.vol=ENG.realizedVol(c,252,T.M?.ppy||252);T.cone=ENG.volCone(T.price,T.vol,21);T.reg=ENG.regression(c,Math.min(120,c.length));}catch{}
    try{T.fvg=ENG.fvgs(b,T.price);T.ob=ENG.orderBlocks(b,T.price,atrA[i]);T.fib=ENG.fib(T.hi52,T.lo52);T.pivots=ENG.pivots(b[i]);}catch{}
    T.chart=b.slice(-200).map((x,k,a)=>{const gi=b.length-a.length+k;return{date:x.date,close:x.close,volume:x.volume,ema20:T.e20[gi],ema50:T.e50[gi],ema200:T.e200[gi],bbU:bb.upper[gi],bbL:bb.lower[gi]};});
    if(typeof PAT_ENG!=='undefined'){
      try{PAT={chart:PAT_ENG.chartPatterns(b,T.price,atrA[i]),candles:PAT_ENG.candlePatterns(b,6),volume:PAT_ENG.volumeEvents(b),wyckoff:PAT_ENG.wyckoffProxy(b)};}catch{}
      try{SIG=PAT_ENG.triggeredSignals({bars:b,c,e20:T.e20,e50:T.e50,e200:T.e200,s50:T.s50,s200:T.s200,rsiArr:ENG.rsi(c),macdObj:mac,adxObj:ax,bbObj:bb,atrArr:atrA,price:T.price,hi52:T.hi52,lo52:T.lo52});}catch{}
    }
  }catch(e){console.warn('V4 detail sync',e);}
}
async function boot(){
  try{
    const r=await fetch('https://raw.githubusercontent.com/samin110597-create/stock-truth-v2/main/v3-upgrade-precision.js?v='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('precision layer HTTP '+r.status);
    let code=await r.text();
    if(window.__ST_V4_LOCAL_BUILD){
      const from='(0,eval)(code);applyPatch();';
      const to="if(window.__ST_V4_LOCAL_BUILD){code=code.replace('if(s)loadHM(s);','if(s){}');}(0,eval)(code);if(window.__ST_V4_LOCAL_INSTALL)window.__ST_V4_LOCAL_INSTALL();applyPatch();";
      if(!code.includes(from))throw new Error('local V4 hook point not found in precision loader');
      code=code.replace(from,to);
    }else throw new Error('V4 local model engine is not loaded');
    (0,eval)(code);
  }catch(e){console.warn('V4 precision bootstrap',e);return;}
  let tries=0;
  const t=setInterval(()=>{
    tries++;
    if(window.__ST_V31&&typeof compute==='function'&&typeof render==='function'){
      clearInterval(t);
      const baseCompute=compute,baseRender=render;
      compute=function(){baseCompute();patchDetails();};
      render=function(){patchDetails();baseRender();};
      patchDetails();
      try{if(typeof D!=='undefined'&&D)render();}catch{}
    }else if(tries>200)clearInterval(t);
  },25);
}
boot();
})();