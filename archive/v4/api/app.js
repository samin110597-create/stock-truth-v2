const SOURCE='https://raw.githubusercontent.com/samin110597-create/stock-truth/original-stock-truth/docs/index.html';

function section(text,start,end,replacement){
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  if(a<0||b<0)throw new Error(`Unable to patch original terminal: ${start}`);
  return text.slice(0,a)+replacement+'\n\n'+text.slice(b);
}

module.exports=async function handler(req,res){
  try{
    const r=await fetch(SOURCE,{headers:{'User-Agent':'StockTruthV2/4.2'}});
    if(!r.ok)throw new Error(`original terminal returned HTTP ${r.status}`);
    let h=await r.text();
    h=h.replace('<title>Stock Truth — analyst terminal</title>','<title>Stock Truth — Institutional Live Research Terminal</title>');
    h=h.replace('const BUILD_TAG="v2.4 · 2026-08-06";','const BUILD_TAG="v4.2 · INSTITUTIONAL LIVE · completed-bar analytics · source-traced data";');
    h=h.replace('</style>','\n#keybox{display:none!important} #tfbar button.tf:not([data-tf="1day"]){display:none!important}\n</style>');

    h=section(h,'async function boot(){','async function run(symRaw){',`async function boot(){
  const bad=selfTest();
  if(bad){
    $("#app").innerHTML=\`<div class="panel"><h2>Engine self-test failed <span class="tag bad">STOPPED</span></h2><p class="note err">\${esc(bad)}</p></div>\`;
    return;
  }
  const bt2=$("#buildTag");if(bt2){bt2.textContent="build "+BUILD_TAG+" · engine self-test ✓";bt2.classList.remove("dim");bt2.classList.add("up");}
  INDEX={tickers:[]};MODE="pipeline";TF="1day";
  $("#modeTag").textContent="INSTITUTIONAL LIVE RESEARCH · ANY TICKER";
  $("#modeTag").classList.remove("bad");
  $("#modeNote").textContent="Current provider fields are source-traced. Technicals, entries, stops, targets and forecasts are derived research outputs from completed bars; unavailable data stays unavailable and unverified edge stays unverified.";
  drawTickerBar();
  const first=recents()[0]||"AAPL";
  await run(first);
}`);

    h=section(h,'async function run(symRaw){','async function load(sym){',`async function run(symRaw){
  const sym=(symRaw||$("#sym").value||"").trim().toUpperCase();
  if(!sym)return;
  $("#sym").value=sym;TAB="verdict";
  return load(sym);
}`);

    h=section(h,'async function load(sym){','function drawTickerBar(){',`async function load(sym){
  $("#app").innerHTML=\`<div class="panel"><h2>Loading \${esc(sym)} <span class="tag pulse">LIVE SOURCES + COMPLETED-BAR MODEL</span></h2><p class="note">Loading market history, quote context, SEC/Yahoo fundamentals and current research inputs where the providers return them. Missing data remains unavailable.</p></div>\`;
  try{
    const r=await fetch(\`/api/stock-v5?symbol=\${encodeURIComponent(sym)}\`,{cache:"no-store"});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
    D=j;D.symbol=D.symbol||sym;D.direct=false;
  }catch(e){D={symbol:sym,load_error:String(e&&e.message||e)};}
  TAB="verdict";pushRecent(sym);compute();drawTickerBar();render();
  window.V2DATA=D;window.dispatchEvent(new CustomEvent("stocktruth:v2data",{detail:D}));
  startAutoRefresh();
}`);

    h=section(h,'function spliceForming(raw,q){','function compute(){',`function spliceForming(raw,q){
  return{bars:raw.slice(),forming:false};
}`);

    h=section(h,'async function refreshCandles(silent){','function startAutoRefresh(){',`async function refreshCandles(silent){
  if(!D||!D.symbol)return;
  const b=$("#btnRefresh");if(b&&!silent)b.textContent="Reloading…";
  try{await load(D.symbol);}catch(e){const n=$("#modeNote");if(n)n.innerHTML=\`<span class="err">Refresh failed — \${esc(e.message||e)}</span>\`;}
  finally{const b2=$("#btnRefresh");if(b2)b2.textContent="Refresh";}
}`);

    h=section(h,'async function setTF(tf){','function recents(){',`async function setTF(tf){
  TF="1day";localStorage.setItem("tf","1day");
  document.querySelectorAll("#tfbar button.tf").forEach(b=>b.classList[b.getAttribute("data-tf")==="1day"?"add":"remove"]("on"));
  const n=$("#modeNote");if(n)n.textContent="Primary signal calculations stay on completed daily bars. The institutional layers add completed weekly/monthly structure and separately sourced intraday context rather than mixing a live partial candle into the validated model.";
}`);

    h=h.replace('</body>','<script src="/v2-enhance.js"></script><script src="/v4-bootstrap.js"></script></body>');
    res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=180');res.end(h);
  }catch(e){
    res.statusCode=500;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Stock Truth institutional terminal failed to load: '+String(e?.message||e));
  }
};