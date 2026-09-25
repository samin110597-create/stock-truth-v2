import {finite} from '../src/numeric.mjs';
import {modelFeatures} from '../quant/src/model.mjs';
import {esc,fmt,pct,pill,metric} from './ui.mjs';

function dirFromText(value){
  const s=String(value||'').toUpperCase();
  if(s.includes('BULL')||s.includes('BUY')||s.includes('LONG'))return 1;
  if(s.includes('BEAR')||s.includes('SELL')||s.includes('SHORT'))return -1;
  return 0;
}
function directionLabel(v){return v>0?'BULLISH':v<0?'BEARISH':'NEUTRAL';}
function horizonFor(selection){return selection?.horizon==='POSITION'?63:21;}
function layaHorizonFor(selection){return selection?.horizon==='POSITION'?20:10;}
function matchingForecast(state,selection){
  const target=horizonFor(selection);
  const rows=state?.forecast?.horizons||[];
  return rows.find(x=>x.sessions===target)||rows.find(x=>x.sessions===21)||rows.at(-1)||null;
}
function validationFor(state,selection){return state?.validation?.[selection?.key]||null;}
function activePlan(state,selection){return state?.setups?.[selection?.key]?.setup||null;}

export function buildLayaQuestions(selection){
  const horizon=layaHorizonFor(selection);
  return {
    trade_action:{
      type:'choice',
      instructions:'Choose the best directional action for the next '+horizon+' bars using only the supplied causal market state. BUY means the +1 ATR barrier should be favored before the -1 ATR barrier; SELL means the reverse; WAIT means no reliable first-touch directional edge or an ambiguous path.',
      criteria:{
        BUY:'Favor a long directional setup.',
        WAIT:'Abstain because the directional edge is weak, unresolved, or ambiguous.',
        SELL:'Favor a short directional setup.',
      },
    },
    tradeable:{
      type:'noul',
      instructions:'Is there a directional edge strong enough to prefer BUY or SELL rather than WAIT over the next '+horizon+' bars?',
      criteria:{
        false:'No sufficiently resolved directional edge; abstain.',
        true:'A directional first-touch edge resolves to BUY or SELL.',
      },
    },
  };
}

export function buildLayaState(state,selection){
  if(!state)return null;
  const bars=state.frames?.['1D']?.bars||[];
  const features=modelFeatures(bars);
  const last=bars.at(-1);
  if(!features||!last)return null;
  return {
    schema:'stock-truth-laya-state-v1',
    asset_class:'EQUITY',
    timeframe:'1D',
    horizon_bars:layaHorizonFor(selection),
    timestamp:last.ts||last.end_ts||null,
    label_definition:'First unambiguous touch of +1 ATR or -1 ATR after the state; otherwise WAIT.',
    features:Object.fromEntries(Object.entries(features).map(([k,v])=>[k,finite(v)?Number(v.toFixed(8)):null])),
  };
}

export async function requestLayaDecision(statePacket,selection,config={},signal){
  if(!statePacket||String(config.status||'').toUpperCase()!=='LIVE')return null;
  const base=String(config.runtime?.gateway_url||'').replace(/\/$/,'');
  const route=String(config.runtime?.decision_route||'/v1/decision');
  if(!/^https:\/\//.test(base))return null;
  const response=await fetch(base+route,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({state:statePacket,questions:buildLayaQuestions(selection)}),
    signal,
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.message||result.error||('Stock-Laya HTTP '+response.status));
  return result;
}

function engineVotes(state,selection){
  const plan=activePlan(state,selection),forecast=matchingForecast(state,selection);
  const votes=[
    {name:'Technical read',dir:dirFromText(state?.read?.label),detail:state?.read?.label||'Unavailable'},
    {name:'Confirmed setup',dir:dirFromText(plan?.direction),detail:plan?.direction||'WAIT'},
    {name:'Local forecast',dir:finite(forecast?.predicted_return)?Math.sign(forecast.predicted_return):0,detail:finite(forecast?.predicted_return)?((forecast.predicted_return>=0?'+':'')+fmt(forecast.predicted_return*100,1)+'%'):'Unavailable'},
  ];
  const mtf=Object.values(state?.alignment||{}).map(x=>dirFromText(x?.label));
  if(mtf.length)votes.push({name:'MTF alignment',dir:Math.sign(mtf.reduce((a,b)=>a+b,0)),detail:directionLabel(Math.sign(mtf.reduce((a,b)=>a+b,0)))});
  return votes;
}

function agreement(votes){
  const directional=votes.filter(v=>v.dir!==0);
  if(!directional.length)return {label:'NO DIRECTIONAL CONSENSUS',count:0,total:votes.length,dir:0};
  const pos=directional.filter(v=>v.dir>0).length,neg=directional.filter(v=>v.dir<0).length;
  const dir=pos===neg?0:(pos>neg?1:-1),count=Math.max(pos,neg);
  return {label:dir?directionLabel(dir):'MIXED',count,total:votes.length,dir};
}

function layaAnswer(state){
  const a=state?.laya?.answers?.trade_action;
  if(!a)return null;
  const choice=a.choice||null;
  const confidence=finite(a.answer_confidence)?a.answer_confidence:finite(a.confidence)?a.confidence:null;
  return {choice,confidence};
}

export function renderLayaCockpit(state,selection,config={}){
  const el=document.getElementById('laya-cockpit');if(!el||!state)return;
  const plan=activePlan(state,selection),votes=engineVotes(state,selection),a=agreement(votes),laya=layaAnswer(state);
  const packet=buildLayaState(state,selection);
  const status=laya?'STOCK-LAYA LIVE':String(config.status||'TRAINING REQUIRED').replaceAll('_',' ');
  const current=plan?.current_action||'WAIT — NO CONFIRMED SETUP';
  const layaDecision=laya?.choice||'WITHHELD';
  const layaConf=finite(laya?.confidence)?pct(laya.confidence):'WITHHELD';
  const voteRows=votes.map(v=>'<div class="engine-vote"><span>'+esc(v.name)+'</span><b class="'+(v.dir>0?'up':v.dir<0?'down':'muted')+'">'+esc(v.detail)+'</b></div>').join('');
  el.innerHTML=
    '<div class="cockpit-head"><div><h2>Decision cockpit <span class="tag">Q-STATE + STOCK-LAYA</span></h2>'+
    '<div class="cockpit-action">'+esc(current)+'</div><p class="note">Existing Stock Truth engines remain authoritative until the stock-specialized Laya checkpoint passes held-out promotion gates.</p></div>'+
    '<div class="cockpit-status">'+pill(status)+'</div></div>'+
    '<div class="cockpit-grid">'+
      '<article class="cockpit-card primary"><span class="eyebrow">Current executable plan</span><strong>'+esc(plan?.direction||'WAIT')+'</strong><small>'+esc(plan?.grade||'No confirmed setup')+'</small></article>'+
      '<article class="cockpit-card"><span class="eyebrow">Stock-Laya decision</span><strong>'+esc(layaDecision)+'</strong><small>Confidence '+esc(layaConf)+'</small></article>'+
      '<article class="cockpit-card"><span class="eyebrow">Engine agreement</span><strong>'+esc(a.label)+'</strong><small>'+a.count+' of '+a.total+' available engines align</small></article>'+
      '<article class="cockpit-card"><span class="eyebrow">Laya state readiness</span><strong>'+esc(packet?'READY':'INSUFFICIENT HISTORY')+'</strong><small>'+esc(packet?'Uses the same Q-State feature schema as training':'Needs 220+ usable daily bars')+'</small></article>'+
    '</div>'+
    '<details class="engine-detail"><summary>What the existing engines say</summary><div class="engine-votes">'+voteRows+'</div></details>';
}

export function renderLearningPanel(state,selection,config={}){
  const el=document.getElementById('learning');if(!el||!state)return;
  const v=validationFor(state,selection),forecast=matchingForecast(state,selection),plan=activePlan(state,selection);
  const gates=config.promotion_policy||{};
  const samples=v?.n||forecast?.validation?.n||0;
  const currentStatus=String(config.status||'TRAINING_REQUIRED').replaceAll('_',' ');
  const fixedPlan=plan?('Signal '+new Date((plan.signal_ts||0)*1000).toLocaleString()):'No active issued plan';
  el.innerHTML=
    '<h2>Learning & accountability <span class="tag">NO MOVING THE GOALPOSTS</span></h2>'+
    '<div class="learning-grid">'+
      '<div class="learning-step"><span>1</span><div><b>Issue</b><p>Save the state, decision, entry, stop and targets exactly as issued.</p></div></div>'+
      '<div class="learning-step"><span>2</span><div><b>Resolve</b><p>Later bars determine what actually happened. Losing decisions stay in the record.</p></div></div>'+
      '<div class="learning-step"><span>3</span><div><b>Retrain candidate</b><p>Resolved examples expand the next Stock-Laya training set; production is not changed trade-by-trade.</p></div></div>'+
      '<div class="learning-step"><span>4</span><div><b>Promote only if better</b><p>Chronological holdout must beat the current baseline before a new checkpoint goes live.</p></div></div>'+
    '</div>'+
    '<div class="metrics learning-metrics">'+
      metric('Stock-Laya',currentStatus,'Base: '+esc(config.base_model||'convaiinnovations/laya'))+
      metric('Current validation samples',String(samples),'Existing engine evidence; not Laya accuracy')+
      metric('Required Laya test cases',String(gates.minimum_test_cases||500),'Untouched chronological test')+
      metric('Balanced accuracy gate',finite(gates.minimum_balanced_accuracy)?fmt(gates.minimum_balanced_accuracy*100,1)+'%':'—','Plus probability-quality gates')+
      metric('Brier skill gate',finite(gates.minimum_brier_skill)?fmt(gates.minimum_brier_skill*100,1)+'%':'—','Must improve versus base-rate forecast')+
      metric('Issued plan integrity',fixedPlan,'Entry/stop/targets are immutable after issue')+
    '</div>'+
    '<p class="note">A model can improve after mistakes only through a new validated training run. The live system never edits an old prediction to make history look better.</p>';
}
