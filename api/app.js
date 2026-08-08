const SOURCE='https://raw.githubusercontent.com/samin110597-create/stock-truth/original-stock-truth/docs/index.html';

function section(text,start,end,replacement){
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  if(a<0||b<0)throw new Error(`Unable to patch original terminal: ${start}`);
  return text.slice(0,a)+replacement+'\n\n'+text.slice(b);
}

module.exports=async function handler(req,res){
  try{
    const r=await fetch(SOURCE,{headers:{'User-Agent':'StockTruthV2/3.0'}});
    if(!r.ok)throw new Error(`original terminal returned HTTP ${r.status}`);
    let h=await r.text();
    h=h.replace('<title>Stock Truth — analyst terminal</title>','<title>Stock Truth v2 — analyst terminal</title>');
    h=h.replace('const BUILD_TAG="v2.4 · 2026-08-06";','const BUILD_TAG="v2.4 ORIGINAL TERMINAL · secure any-ticker v2 backend · 2026-08-08";');
    h=h.replace('</style>','\n#keybox{display:none!important} #tfbar button.tf:not([data-tf="1day"]){display:none!important}\n</style>');

    h=section(h,'async function boot(){','async function run(symRaw){',`async function boot(){
  const bad=selfTest();
  if(bad){
    $("#app").innerHTML=\`<div class="panel"><h2>Engine self-test failed <span class="tag bad">STOPPED</span></h2><p class="note err">\${esc(bad)}</p></div>\`;
    return;
  }
  const bt2=$("#buildTag");if(bt2){bt2.textContent="build "+BUILD_TAG+" · engine self-test ✓";bt2.classList.remove("dim");bt2.classList.add("up");}
  INDEX={tickers:[]};MODE="pipeline";TF="1day";
  $("#modeTag").textContent="V2 SECURE ANY-TICKER MODE — NO BROWSER API KEYS";
  $("#modeTag").classList.remove("bad");
  $("#modeNote").textContent="The original Stock Truth terminal is restored. Any valid ticker is fetched by the secure Vercel backend; missing data is shown as unavailable, never invented.";
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
  $("#app").innerHTML=\`<div class="panel"><h2>Loading \${esc(sym)} <span class="tag pulse">SECURE ANY-TICKER DATA</span></h2><p class="note">Pulling adjusted closed-bar history plus all fundamentals/earnings/analyst context the secure sources actually return.</p></div>\`;
  try{
    const r=await fetch(\`/api/stock?symbol=\${encodeURIComponent(sym)}\`,{cache:"no-store"});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||("HTTP "+r.status));
    D=j;D.symbol=D.symbol||sym;D.direct=false;
  }catch(e){D={symbol:sym,load_error:String(e&&e.message||e)};}
  TAB="verdict";pushRecent(sym);compute();drawTickerBar();render();
  window.V2DATA=D;window.dispatchEvent(new CustomEvent("stocktruth:v2data",{detail:D}));
  startAutoRefresh();
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
  const n=$("#modeNote");if(n)n.textContent="The restored terminal uses completed daily bars for all primary signals. Weekly/monthly MA/EMA structure is added by the v2 precision layer below the original analysis.";
}`);

    h=h.replace('</body>','<script src="/v2-enhance.js"></script></body>');
    res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');res.end(h);
  }catch(e){
    res.statusCode=500;res.setHeader('Content-Type','text/plain; charset=utf-8');res.end('Stock Truth v2 terminal failed to load: '+String(e?.message||e));
  }
};