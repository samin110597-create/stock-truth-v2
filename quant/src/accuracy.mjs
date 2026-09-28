const HORIZONS=[5,10,20];
const DB_NAME='qstate-forward-accuracy';
const DB_VERSION=1;

const finite=Number.isFinite;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

function dirNum(direction){return direction==='BULLISH'||direction==='LONG'?1:direction==='BEARISH'||direction==='SHORT'?-1:0;}
function cleanProjection(q){
  const p=q?.forecast?.projection?.primary||{};
  return {5:finite(p.bar5)?p.bar5:null,10:finite(p.bar10)?p.bar10:null,20:finite(p.bar20)?p.bar20:null};
}
export function forecastRecord(q){
  const b=q?.bars?.at?.(-1);if(!b)return null;
  const signalEndTs=Number(b.end_ts||0),signalTs=Number(b.ts||0),entry=Number(b.close);
  if(!finite(signalEndTs)||!finite(entry)||entry<=0)return null;
  const id=[String(q.model||'Q-STATE'),String(q.symbol||''),String(q.timeframe||''),String(signalEndTs)].join('|');
  return {
    schema_version:1,id,
    modelVersion:String(q.trained?.modelVersion||q.model||'Q-STATE UNIFIED 3.0'),
    model:String(q.model||'Q-STATE UNIFIED 3.0'),
    symbol:String(q.symbol||'').toUpperCase(),
    sourceSymbol:String(q.sourceSymbol||q.symbol||'').toUpperCase(),
    asset:String(q.asset||'UNKNOWN'),
    timeframe:String(q.timeframe||''),
    issuedAt:String(q.generatedAt||new Date().toISOString()),
    signalTs,signalEndTs,signalDate:b.date||null,
    entryPrice:entry,
    direction:String(q.state?.direction||'NEUTRAL'),
    directionSign:dirNum(q.state?.direction),
    stage:String(q.state?.stage||'NO EDGE'),
    regime:String(q.state?.regime||'UNKNOWN'),
    quality:String(q.state?.quality||'—'),
    probabilityStatus:String(q.state?.probabilityStatus||'WITHHELD'),
    probabilityUp:finite(q.state?.calibratedProbabilityUp)?q.state.calibratedProbabilityUp:null,
    probabilityDirection:finite(q.state?.calibratedProbabilityDirection)?q.state.calibratedProbabilityDirection:null,
    probabilityHorizon:finite(q.state?.calibratedProbabilityHorizon)?Number(q.state.calibratedProbabilityHorizon):null,
    atr:finite(q.math?.atr)?q.math.atr:null,
    projection:cleanProjection(q),
    plan:q.plan?{
      direction:String(q.plan.direction||''),
      trigger:finite(q.plan.trigger)?q.plan.trigger:null,
      stop:finite(q.plan.stop)?q.plan.stop:null,
      targets:(q.plan.targets||[]).filter(x=>finite(x?.price)).map(x=>({name:String(x.name||''),price:Number(x.price)}))
    }:null,
    provider:String(q.provider||'unknown')
  };
}

function eventLabel(record,path){
  const atr=record.atr,entry=record.entryPrice;
  if(!finite(atr)||atr<=0||!finite(entry))return {label:null,status:'NO_ATR'};
  const up=entry+atr,down=entry-atr;
  for(let i=0;i<path.length;i++){
    const b=path[i],hu=finite(b.high)&&b.high>=up,hd=finite(b.low)&&b.low<=down;
    if(hu&&hd)return {label:null,status:'AMBIGUOUS_SAME_BAR',bar:i+1};
    if(hu)return {label:1,status:'UP_FIRST',bar:i+1};
    if(hd)return {label:0,status:'DOWN_FIRST',bar:i+1};
  }
  return {label:null,status:'UNRESOLVED'};
}

function tradeOutcome(record,path){
  const p=record.plan,dir=dirNum(p?.direction);if(!p||!dir||!path.length)return null;
  const tp=p.targets?.[0]?.price,stop=p.stop,trigger=p.trigger;
  let triggered=!finite(trigger),triggerBar=triggered?0:null,targetBar=null,stopBar=null;
  for(let i=0;i<path.length;i++){
    const b=path[i];
    if(!triggered&&finite(trigger)){
      const ok=dir>0?b.close>=trigger:b.close<=trigger;
      if(ok){triggered=true;triggerBar=i+1;}
    }
    if(!triggered)continue;
    const targetHit=finite(tp)&&(dir>0?b.high>=tp:b.low<=tp);
    const stopHit=finite(stop)&&(dir>0?b.low<=stop:b.high>=stop);
    if(targetHit&&stopHit){stopBar=i+1;break;}
    if(stopHit){stopBar=i+1;break;}
    if(targetHit){targetBar=i+1;break;}
  }
  return {
    triggered,triggerBar,
    tp1HitBeforeStop:targetBar!==null,
    stopBeforeTp1:stopBar!==null,
    falseBreakout:triggered&&stopBar!==null&&targetBar===null,
    targetBar,stopBar
  };
}

export function evaluateRecord(record,bars){
  if(!record||!Array.isArray(bars)||!bars.length)return null;
  let i=bars.findIndex(b=>Number(b.end_ts)===Number(record.signalEndTs));
  if(i<0&&record.signalDate)i=bars.findIndex(b=>b.date===record.signalDate&&Math.abs(Number(b.close)-Number(record.entryPrice))/record.entryPrice<.000001);
  if(i<0)return null;
  const out={id:record.id,observedAt:new Date().toISOString(),horizons:{}};
  for(const h of HORIZONS){
    if(i+h>=bars.length)continue;
    const path=bars.slice(i+1,i+h+1),end=bars[i+h],dir=record.directionSign||0,ret=end.close/record.entryPrice-1;
    const adverse=dir>0?Math.min(...path.map(b=>b.low/record.entryPrice-1)):dir<0?Math.min(...path.map(b=>1-b.high/record.entryPrice)):null;
    const favorable=dir>0?Math.max(...path.map(b=>b.high/record.entryPrice-1)):dir<0?Math.max(...path.map(b=>1-b.low/record.entryPrice)):null;
    const e=eventLabel(record,path),p=record.probabilityUp;
    const projection=record.projection?.[h];
    const primaryProbability=h===Number(record.probabilityHorizon)&&record.probabilityStatus==='WALK_FORWARD_VALIDATED'&&finite(p)&&e.label!==null;
    out.horizons[h]={
      horizon:h,endTs:end.end_ts||null,endDate:end.date||null,endPrice:end.close,
      returnPct:ret,
      directionCorrect:dir?dir*ret>0:null,
      maePct:finite(adverse)?Math.max(0,-adverse):null,
      mfePct:finite(favorable)?Math.max(0,favorable):null,
      projectedMedian:finite(projection)?projection:null,
      projectionAbsErrorPct:finite(projection)?Math.abs(end.close-projection)/record.entryPrice:null,
      atrEventStatus:e.status,
      atrEventLabel:e.label,
      brier:primaryProbability?(p-e.label)**2:null,
      probabilityUp:primaryProbability?p:null,
      trade:tradeOutcome(record,path)
    };
  }
  return out;
}

function aggregate(rows){
  const dir=rows.filter(x=>typeof x.directionCorrect==='boolean');
  const brier=rows.filter(x=>finite(x.brier));
  const mae=rows.filter(x=>finite(x.maePct));
  const proj=rows.filter(x=>finite(x.projectionAbsErrorPct));
  const trades=rows.map(x=>x.trade).filter(Boolean).filter(x=>x.triggered);
  const resolvedTrades=trades.filter(x=>x.tp1HitBeforeStop||x.stopBeforeTp1);
  return {
    n:rows.length,
    directionN:dir.length,
    directionalAccuracy:dir.length?dir.filter(x=>x.directionCorrect).length/dir.length:null,
    brierN:brier.length,
    brier:brier.length?mean(brier.map(x=>x.brier)):null,
    calibrationPredicted:brier.length?mean(brier.map(x=>x.probabilityUp)):null,
    calibrationActual:brier.length?mean(brier.map(x=>x.atrEventLabel)):null,
    calibrationGap:brier.length?Math.abs(mean(brier.map(x=>x.probabilityUp))-mean(brier.map(x=>x.atrEventLabel))):null,
    avgMaePct:mae.length?mean(mae.map(x=>x.maePct)):null,
    projectionN:proj.length,
    avgProjectionAbsErrorPct:proj.length?mean(proj.map(x=>x.projectionAbsErrorPct)):null,
    tradeN:resolvedTrades.length,
    tp1HitRate:resolvedTrades.length?resolvedTrades.filter(x=>x.tp1HitBeforeStop).length/resolvedTrades.length:null,
    stopBeforeTp1Rate:resolvedTrades.length?resolvedTrades.filter(x=>x.stopBeforeTp1).length/resolvedTrades.length:null,
    falseBreakoutRate:trades.length?trades.filter(x=>x.falseBreakout).length/trades.length:null
  };
}

export function summarizeLedger(forecasts,outcomes){
  const byId=new Map((outcomes||[]).map(x=>[x.id,x])),joined=[];
  for(const f of forecasts||[]){
    const o=byId.get(f.id);if(!o)continue;
    for(const [h,v] of Object.entries(o.horizons||{}))joined.push({...v,horizon:Number(h),timeframe:f.timeframe,regime:f.regime,stage:f.stage,symbol:f.symbol});
  }
  const timeframes={};
  for(const tf of ['15M','1H','4H','1D']){
    const r=joined.filter(x=>x.timeframe===tf);
    timeframes[tf]={};
    for(const h of HORIZONS)timeframes[tf][h]=aggregate(r.filter(x=>x.horizon===h));
  }
  const regimes={};
  for(const name of [...new Set(joined.map(x=>x.regime).filter(Boolean))]){
    const r=joined.filter(x=>x.regime===name);
    regimes[name]=aggregate(r.filter(x=>x.horizon===10));
  }
  const pending=(forecasts||[]).filter(f=>!byId.has(f.id)).length;
  return {forecastCount:(forecasts||[]).length,pending,resolvedForecasts:(forecasts||[]).length-pending,timeframes,regimes,joined};
}

let dbPromise=null;
function openDb(){
  if(typeof indexedDB==='undefined')return Promise.resolve(null);
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('forecasts'))db.createObjectStore('forecasts',{keyPath:'id'});if(!db.objectStoreNames.contains('outcomes'))db.createObjectStore('outcomes',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
async function storeAdd(name,value){
  const db=await openDb();if(!db)return false;
  return await new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite'),s=tx.objectStore(name),r=s.add(value);r.onsuccess=()=>resolve(true);r.onerror=()=>{if(r.error?.name==='ConstraintError'){r.preventDefault?.();resolve(false);}else reject(r.error);};});
}
async function storePut(name,value){
  const db=await openDb();if(!db)return false;
  return await new Promise((resolve,reject)=>{const tx=db.transaction(name,'readwrite'),r=tx.objectStore(name).put(value);r.onsuccess=()=>resolve(true);r.onerror=()=>reject(r.error);});
}
async function storeAll(name){
  const db=await openDb();if(!db)return [];
  return await new Promise((resolve,reject)=>{const tx=db.transaction(name,'readonly'),r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
}
export async function recordIssuedForecast(q){const r=forecastRecord(q);if(!r)return null;await storeAdd('forecasts',r);return r;}
export async function settleForCurrentSeries(q){
  const forecasts=await storeAll('forecasts'),matching=forecasts.filter(f=>f.symbol===String(q.symbol||'').toUpperCase()&&f.timeframe===q.timeframe);
  for(const f of matching){const outcome=evaluateRecord(f,q.bars);if(outcome&&Object.keys(outcome.horizons).length)await storePut('outcomes',outcome);}
  return await accuracySnapshot();
}
export async function accuracySnapshot(){const [forecasts,outcomes]=await Promise.all([storeAll('forecasts'),storeAll('outcomes')]);return {...summarizeLedger(forecasts,outcomes),forecasts,outcomes};}
