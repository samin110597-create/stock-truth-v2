import {finite} from '../src/numeric.mjs';
import {esc,fmt,money,pct,pill,metric} from './ui.mjs';

function dirFromText(value){
  const s=String(value||'').toUpperCase();
  if(s.includes('BULL')||s.includes('BUY')||s.includes('LONG'))return 1;
  if(s.includes('BEAR')||s.includes('SELL')||s.includes('SHORT'))return -1;
  return 0;
}
function directionLabel(v){return v>0?'BULLISH':v<0?'BEARISH':'NEUTRAL';}
function horizonFor(selection){return selection?.horizon==='POSITION'?63:21;}
function matchingForecast(state,selection){
  const target=horizonFor(selection);
  const rows=state?.forecast?.horizons||[];
  return rows.find(x=>x.sessions===target)||rows.find(x=>x.sessions===21)||rows.at(-1)||null;
}
function validationFor(state,selection){return state?.validation?.[selection?.key]||null;}
function activePlan(state,selection){return state?.setups?.[selection?.key]?.setup||null;}

export function buildLayaState(state,selection){
  if(!state)return null;
  const frame=state.frames?.['1D']||{};
  const t=frame.technicals||{},s=frame.structure||{},r=frame.reversal||{};
  const forecast=matchingForecast(state,selection),plan=activePlan(state,selection);
  return {
    schema:'stock-truth-live-state-v1',
    symbol:state.symbol,
    generated_at:state.generated_at,
    mode:selection?.mode,
    holding_horizon:selection?.horizon,
    health:state.health?.status||'UNAVAILABLE',
    technical_read:{
      label:state.read?.label||null,
      signed_score:finite(state.read?.signed_score)?state.read.signed_score:null,
      evidence_coverage:finite(state.read?.coverage)?state.read.coverage:null,
    },
    market_structure:{
      pattern:s.pattern||null,
      support:s.support?.[0]?.price??null,
      resistance:s.resistance?.[0]?.price??null,
      reversal_stage:r.stage||null,
      reversal_direction:r.dir??null,
    },
    technicals:{
      trend:t.intermediate_trend||null,
      rsi:t.rsi??null,
      atr:t.atr??null,
      relative_volume:t.rvol??null,
      volatility_regime:t.volatility_regime||null,
    },
    existing_forecast:forecast?{
      sessions:forecast.sessions,
      status:forecast.status,
      predicted_return:forecast.predicted_return,
      base:forecast.base,
      bear:forecast.bear,
      bull:forecast.bull,
      validation_n:forecast.validation?.n??null,
      mae_skill:forecast.validation?.mae_skill??null,
      directional_accuracy:forecast.validation?.directional_accuracy??null,
    }:null,
    current_plan:plan?{
      direction:plan.direction,
      grade:plan.grade,
      score:plan.score,
      entry_zone:plan.entry_zone,
      stop:plan.stop,
      targets:plan.targets,
      action:plan.current_action,
      signal_ts:plan.signal_ts,
    }:null,
    mtf:Object.fromEntries(Object.entries(state.alignment||{}).map(([k,v])=>[k,v?.label||null])),
  };
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
  const probabilities=a.probabilities||a.distribution||null;
  const confidence=finite(a.answer_confidence)?a.answer_confidence:finite(a.confidence)?a.confidence:null;
  return {choice,probabilities,confidence};
}

export function renderLayaCockpit(state,selection,config={}){
  const el=document.getElementById('laya-cockpit');if(!el||!state)return;
  const plan=activePlan(state,selection),votes=engineVotes(state,selection),a=agreement(votes),laya=layaAnswer(state);
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
      '<article class="cockpit-card"><span class="eyebrow">Stock probability</span><strong>'+esc(laya?'CALIBRATED MODEL':'WITHHELD')+'</strong><small>'+esc(laya?'Use held-out calibrated Laya output only':'No unvalidated percentage is shown')+'</small></article>'+
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
