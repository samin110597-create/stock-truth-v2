// A conservative explanation of the existing engine, not another forecast model.
const finite=Number.isFinite;
const money=x=>finite(x)?'$'+x.toFixed(2):'unavailable';
export function plainLanguage(q,gate,v){
 const p=q.plan,b=q.bars.at(-1),previous=q.bars.at(-2),dir=v.dir;
 const fresh=gate.allowed&&finite(q.quote?.price),price=fresh?q.quote.price:b.close;
 const time={'1D':'daily close','4H':'completed 4-hour period','1H':'completed hour','15M':'completed 15-minute period'}[q.timeframe]||'completed period';
 const opposite=(q.mtf?.rows||[]).filter(x=>x.timeframe!==q.timeframe&&x.bias*dir<0);
 const mixed=dir!==0&&opposite.length>0;
 const direction=!v.historyOK?'Direction unavailable until price history is updated':!dir||mixed?'The direction is unclear':dir>0?'The recent price pattern points upward':'The recent price pattern points downward';
 const pattern=q.structure.pattern;
 const why=mixed?'The available time periods disagree, so a confident up-or-down call is not justified.':pattern==='HH + HL'?'Recent rises and dips have ended at higher prices.':pattern==='LH + LL'?'Recent rises and dips have ended at lower prices.':'The latest completed prices give only a tentative direction.';
 const nearest=dir>0?v.resistance:dir<0?v.support:null;
 const destination=finite(nearest)?'The first area to watch is '+money(nearest)+', where the move may stall or reverse.':'There is no reliable nearby destination yet.';
 const timing=q.timeframe==='1D'?'Use this as a plan for the next '+v.horizon+' trading days, not a promise that a target will be reached by then.':'This view covers the next '+v.horizon+' completed '+({'15M':'15-minute','1H':'hourly','4H':'4-hour'}[q.timeframe]||q.timeframe)+' periods. Closed-market hours do not count.';
 // Use the closest known obstacle, never a distant TP selected to improve the ratio.
 const low=p?.entryZone?.low,high=p?.entryZone?.high,stop=p?.stop;
 const candidates=[...(p?.targets||[]).map(x=>x.price),...(q.structure.resistance||[]).map(x=>x.price)].filter(x=>finite(x)&&finite(low)&&x>low);
 const first=candidates.length?Math.min(...candidates):null;
 const cap=finite(first)&&finite(stop)?(first+2*stop)/3:null;
 const top=finite(cap)&&finite(high)?Math.floor(Math.min(cap,high)*100)/100:null;
 const bottom=finite(low)?Math.ceil(low*100)/100:null;
 const zone=dir>0&&finite(bottom)&&finite(top)&&finite(stop)&&bottom>stop&&top>=bottom?{low:bottom,high:top}:null;
 const gain=finite(first)?first-price:null,loss=finite(stop)?price-stop:null;
 const currentRR=finite(gain)&&finite(loss)&&gain>0&&loss>0?gain/loss:null;
 // A bounce must overlap the proposed zone, close up, and clear the prior high.
 const bounce=!!(zone&&previous&&b.low<=zone.high&&b.high>=zone.low&&b.close>b.open&&b.close>previous.high&&b.low>stop);
 const broken=!!(p&&dir&&((finite(price)&&dir*(price-stop)<=0)||(finite(b.low)&&dir>0&&b.low<=stop)||(finite(b.high)&&dir<0&&b.high>=stop)));
 let action='WAIT',buy='There is no supported buy area yet. Wait for a clearer price pattern.';
 if(dir<0){action='WAIT BEFORE BUYING';buy='The recent pattern is falling. A cheaper price is not enough: wait for a new rising pattern and a newly calculated buy area.';}
 else if(dir>0&&zone){
  buy='Watch '+money(zone.low)+' to '+money(zone.high)+'. Buy only after a '+time+' shows a rebound: it overlaps this area, ends above its opening price and above the previous period’s high. The actual purchase must still be in this area.';
  if(fresh&&bounce&&price>=zone.low&&price<=zone.high&&currentRR>=2&&q.state.stage==='READY'&&!mixed&&!broken){action='BUY CONDITIONS MET — CHECK YOUR FILL';buy+=' These conditions are met in the available data; a higher fill may remove the advantage.';}
  else if(price>zone.high){action='WAIT FOR A BETTER PRICE';buy+=' At the latest '+(fresh?'quote':'completed price')+', buying now does not meet this lower-price plan. Do not chase a rebound above the area.';}
 }else if(dir>0){action='NO ATTRACTIVE BUY AREA YET';buy='The existing buy area does not offer $2 of potential gain for each $1 of planned loss before the nearest obstacle. Do not move the target farther away just to make the trade look better.';}
 if(!v.historyOK||broken||v.chased){action=!v.historyOK?'WAIT FOR UPDATED DATA':broken?'DO NOT USE THIS BUY PLAN':'DO NOT CHASE';buy=broken?'Price has reached or crossed the planned loss level. A new completed price pattern is needed before another buy plan.':!v.historyOK?'Price history is incomplete or stale. Treat the displayed levels as historical references.':'The first planned destination has already been reached. Wait for a new plan.';}
 else if(mixed||!dir){action='WAIT — DIRECTION UNCLEAR';buy='Do not buy solely because price touches the displayed area. The price evidence needs to agree first.';}
 if(!fresh){if(action.startsWith('BUY CONDITIONS'))action='WAIT FOR A FRESH PRICE';buy+=' No current buy signal: a quote no more than 15 minutes old is required.';}
 const risk=dir>0&&finite(stop)?'If buying, the planned exit if wrong is '+money(stop)+'. Do not wait for the daily close to manage that loss. A gap or fast move can produce a worse exit.':dir<0?'This is a falling-price view, not a recommendation to buy the dip.':'No buy or loss limit is established.';
 const reward=dir>0&&finite(first)&&finite(stop)?'First possible selling area: '+money(first)+'. '+(fresh&&currentRR!==null?'At '+money(price)+', potential gain is '+money(gain)+' versus '+money(loss)+' of planned loss per share ('+currentRR.toFixed(2)+' to 1).':'The gain-to-loss comparison will update when a fresh price is available.'):'No reliable buy-side reward comparison is available.';
 return {direction,why,destination,timing,action,buy,risk,reward,zone,first,cap,currentRR,bounce,mixed,broken,rule:'The 2-to-1 screen is a planning rule, not a proven win rate. It does not identify the exact bottom or guarantee a profit.'};
}
