import {finite} from './numeric.mjs';
export function alternatingPivots(pivots,minQuality=40){
  const out=[];
  for(const p of pivots.filter(p=>p.quality>=minQuality)){
    const last=out.at(-1);
    if(last&&last.i===p.i)continue; // ambiguous outside-bar order cannot be known
    if(last?.type===p.type){if((p.type==='H'?1:-1)*(p.price-last.price)>0)out[out.length-1]=p;}
    else out.push(p);
  }
  return out;
}
export function impulseRules(points){
  if(points.length<3)return {valid:false,reasons:['At least 0–1–2 confirmed pivots are required.']};
  const d=points[0].type==='L'?1:-1,p=points.map(x=>x.price*d),reasons=[];
  if(points.some((x,i)=>i&&x.type===points[i-1].type))reasons.push('Pivots do not alternate.');
  if(!(p[1]>p[0]&&p[2]>p[0]&&p[2]<p[1]))reasons.push('Wave 2 must retrace part, but not all, of wave 1.');
  if(p.length>=4&&p[3]<=p[1])reasons.push('Wave 3 must move beyond the end of wave 1.');
  if(p.length>=5&&!(p[4]<p[3]&&p[4]>p[1]))reasons.push('Impulse wave 4 cannot overlap wave 1; diagonals are not modeled.');
  if(p.length>=6){
    if(p[5]<=p[3])reasons.push('Truncated fifth waves are not modeled.');
    if(p[3]-p[2]<Math.min(p[1]-p[0],p[5]-p[4]))reasons.push('Wave 3 cannot be the shortest motive wave.');
  }
  return {valid:!reasons.length,reasons,dir:d};
}
export function elliott(b,t,s){
  const candidates=[],last=b.at(-1),a=t.series.atr.at(-1);
  if(!last||!finite(a))return {status:'INSUFFICIENT DATA',candidates:[],classification:'MODEL ESTIMATE'};
  for(const degree of [65,40]){
    const z=alternatingPivots(s.pivots,degree);
    for(const count of [6,5,4,3]){
      const p=z.slice(-count);if(p.length!==count||last.ts-p.at(-1).ts>90*86400||p.at(-1).i-p[0].i<8)continue;
      const rules=impulseRules(p);if(!rules.valid)continue;
      const d=rules.dir,w1=Math.abs(p[1].price-p[0].price),anchor=p.at(-1),recent=b.slice(anchor.i+1);
      if(w1<2*(t.series.atr[p[1].i]||a))continue;
      let targets=[],invalidation,stage,projectionDir=d,confirmation;
      if(count===3){invalidation=p[0].price;stage='WAVE 3 CANDIDATE';confirmation=p[1].price;targets=[1,1.618,2.618].map(r=>({price:p[2].price+d*w1*r,basis:r+' × wave 1 from wave 2'}));}
      else if(count===4){invalidation=p[1].price;stage='WAVE 4 PULLBACK CANDIDATE';projectionDir=-d;confirmation=null;const w3=Math.abs(p[3].price-p[2].price);targets=[.236,.382,.5].map(r=>({price:p[3].price-d*w3*r,basis:r+' retracement of wave 3'})).filter(x=>d*(x.price-invalidation)>0);}
      else if(count===5){invalidation=p[1].price;stage='WAVE 5 CANDIDATE';confirmation=p[3].price;targets=[{price:p[4].price+d*w1,basis:'Wave 5 equals wave 1'},{price:p[4].price+d*.618*Math.abs(p[3].price-p[0].price),basis:'0.618 × waves 0–3 from wave 4'}];}
      else {invalidation=p[5].price;stage='COMPLETED IMPULSE / CORRECTION WATCH';projectionDir=-d;confirmation=p[4].price;targets=[.382,.5,.618].map(r=>({price:p[5].price-d*r*Math.abs(p[5].price-p[0].price),basis:r+' retracement of the completed candidate impulse'}));}
      // Evaluate the hypothesis against every bar after its anchor, not only the
      // latest close. A breached invalidation never returns as an active count.
      const invalidationDir=count===6?-d:d;
      if(recent.some(x=>invalidationDir>0?x.low<=invalidation:x.high>=invalidation))continue;
      const filtered=targets.filter(x=>finite(x.price)&&x.price>0&&(count===4?d:projectionDir)*(x.price-invalidation)>0).sort((x,y)=>projectionDir*(x.price-y.price));
      if(!filtered.length)continue;
      const mapped=filtered.map((x,i)=>({...x,name:'Projection '+(i+1),status:recent.some(v=>projectionDir>0?v.high>=x.price:v.low<=x.price)?'ALREADY TOUCHED':'CONDITIONAL'}));
      const id=degree+':'+p.map(x=>x.ts).join(':');
      if(candidates.some(c=>c.anchors.map(x=>x.ts).join()===p.map(x=>x.ts).join()))continue;
      candidates.push({id,degree:degree===65?'MAJOR SWINGS':'INTERMEDIATE SWINGS',stage,dir:projectionDir,impulse_dir:d,anchors:p.map((x,i)=>({...x,wave:String(i)})),known_at:Math.max(...p.map(x=>x.confirmed_ts)),invalidation,confirmation,targets:mapped,
        retracement_2:Math.abs(p[2].price-p[1].price)/w1,status:'CANDIDATE · SUBDIVISIONS UNVERIFIED',rules:['Wave 2 holds the origin of wave 1',...(count>=4?['Wave 3 exceeds wave 1']:[]),...(count>=5?['Wave 4 remains outside wave 1 territory']:[]),...(count===6?['Wave 3 is not the shortest motive wave']:[])],
        note:'Confirmed swing geometry passes the stated rules. Lower-degree 5–3–5 subdivisions are not established. Fibonacci relationships are scenarios, not odds or trade orders.'});
      break; // one most-developed candidate per swing degree
    }
  }
  return {classification:'MODEL ESTIMATE',status:candidates.length?'CONDITIONAL COUNTS':'NO VALID IMPULSE CANDIDATE',candidates:candidates.slice(0,2),note:'Primary and alternative counts use distinct swing degrees. No forced wave count, diagonal, truncation or complete ABC labeling. Projection levels remain fixed to their displayed anchors; a new count is a new hypothesis. Published trade-plan targets do not change.'};
}
